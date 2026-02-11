/**
 * Embedding pipeline wrapper around @huggingface/transformers.
 *
 * Loads models sequentially and provides a simple embed() interface.
 * Handles task prefixes for models that need them (nomic).
 * Tracks memory usage for benchmark reporting.
 * Supports true batch embedding for performance.
 */

import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import type { ModelConfig } from './model-registry.js';
import { detectDevice, type DeviceDetectionResult } from './device-detector.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('embedder');

/** Default batch size for true batch embedding to avoid OOM.
 *  Keep small: attention memory scales O(batch * seq_len²). */
const DEFAULT_BATCH_SIZE = 4;

export interface EmbedResult {
  /** The embedding vector. */
  embedding: number[];
  /** Inference time in ms. */
  inferenceMs: number;
}

export interface ModelStats {
  modelId: string;
  loadTimeMs: number;
  heapUsedMB: number;
}

export interface EmbedderLoadOptions {
  /** Override device selection ('auto' | 'coreml' | 'cuda' | 'cpu' | 'wasm'). */
  device?: string;
}

export class Embedder {
  private pipe: FeatureExtractionPipeline | null = null;
  private config: ModelConfig | null = null;
  private _device: DeviceDetectionResult | null = null;

  /**
   * Load a model. Disposes any previously loaded model first.
   */
  async load(config: ModelConfig, options: EmbedderLoadOptions = {}): Promise<ModelStats> {
    await this.dispose();

    const detection = detectDevice(options.device);
    this._device = detection;

    const heapBefore = process.memoryUsage().heapUsed;
    const start = performance.now();

    // Build pipeline options. All accelerated backends use onnxruntime-node
    // (device: 'cpu' in transformers.js) with execution providers overridden.
    // WASM uses device: undefined to let transformers.js pick its WASM backend.
    const isWasm = detection.device === 'wasm';
    const pipelineOptions: Record<string, unknown> = {
      dtype: 'fp32',
      ...(isWasm ? {} : { device: 'cpu' }),
    };

    // Inject execution providers for hardware acceleration
    if (detection.executionProviders.length > 0) {
      pipelineOptions.session_options = {
        executionProviders: detection.executionProviders,
      };
    }

    try {
       
      this.pipe = await (pipeline as any)(
        'feature-extraction', config.hfId, pipelineOptions,
      ) as FeatureExtractionPipeline;
    } catch (epError) {
      // If accelerated EP fails, retry with plain CPU (no execution providers)
      if (detection.device !== 'cpu' && detection.device !== 'wasm') {
        log.warn(`${detection.label} failed, falling back to CPU`, {
          error: (epError as Error).message,
        });
        this._device = {
          device: 'cpu',
          executionProviders: ['cpu'],
          label: 'CPU (native, fallback)',
          source: detection.source,
          notes: `${detection.label} failed: ${(epError as Error).message}`,
        };
         
        this.pipe = await (pipeline as any)(
          'feature-extraction', config.hfId, { dtype: 'fp32', device: 'cpu' },
        ) as FeatureExtractionPipeline;
      } else {
        throw epError;
      }
    }
    this.config = config;

    const loadTimeMs = performance.now() - start;
    const heapAfter = process.memoryUsage().heapUsed;
    const heapUsedMB = (heapAfter - heapBefore) / (1024 * 1024);

    log.info(`Loaded ${config.id} on ${this._device.label} in ${loadTimeMs.toFixed(0)}ms`);

    return {
      modelId: config.id,
      loadTimeMs,
      heapUsedMB: Math.max(0, heapUsedMB),
    };
  }

  /**
   * Embed a single text. Applies document prefix if the model needs it.
   */
  async embed(text: string, isQuery: boolean = false): Promise<EmbedResult> {
    if (!this.pipe || !this.config) {
      throw new Error('No model loaded. Call load() first.');
    }

    const prefixed = this.config.usesPrefix
      ? (isQuery ? this.config.queryPrefix : this.config.documentPrefix) + text
      : text;

    const start = performance.now();
    const output = await this.pipe(prefixed, {
      pooling: 'mean',
      normalize: true,
    });
    const inferenceMs = performance.now() - start;

    // Output is a Tensor — convert to number[]
    const embedding = Array.from(output.data as Float32Array).slice(
      0,
      this.config.dims,
    );

    return { embedding, inferenceMs };
  }

  /**
   * Embed multiple texts. Returns embeddings in the same order.
   * @deprecated Use embedBatchTrue() for better performance.
   */
  async embedBatch(
    texts: string[],
    isQuery: boolean = false,
  ): Promise<EmbedResult[]> {
    const results: EmbedResult[] = [];
    for (const text of texts) {
      results.push(await this.embed(text, isQuery));
    }
    return results;
  }

  /**
   * Embed multiple texts using true batch processing.
   * Passes arrays directly to the HuggingFace pipeline for better performance.
   * Processes in configurable batch sizes to avoid OOM on large batches.
   *
   * @param texts - Array of texts to embed
   * @param isQuery - Whether these are query texts (affects prefix for some models)
   * @param batchSize - Maximum texts per batch (default 32)
   */
  async embedBatchTrue(
    texts: string[],
    isQuery: boolean = false,
    batchSize: number = DEFAULT_BATCH_SIZE,
  ): Promise<EmbedResult[]> {
    if (!this.pipe || !this.config) {
      throw new Error('No model loaded. Call load() first.');
    }

    if (texts.length === 0) {
      return [];
    }

    const results: EmbedResult[] = [];
    const dims = this.config.dims;

    // Process in batches to avoid OOM
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const prefixed = batch.map((t) =>
        this.config!.usesPrefix
          ? (isQuery ? this.config!.queryPrefix : this.config!.documentPrefix) + t
          : t
      );

      const start = performance.now();
      const output = await this.pipe(prefixed, {
        pooling: 'mean',
        normalize: true,
      });
      const inferenceMs = performance.now() - start;

      // Extract embeddings from flattened tensor
      const data = output.data as Float32Array;
      for (let j = 0; j < batch.length; j++) {
        const embedding = Array.from(data.slice(j * dims, (j + 1) * dims));
        results.push({ embedding, inferenceMs: inferenceMs / batch.length });
      }

      // Free WASM tensor memory (not GC'd automatically)
      if (typeof output.dispose === 'function') {
        output.dispose();
      }
    }

    return results;
  }

  /**
   * Dispose the current model to free memory.
   */
  async dispose(): Promise<void> {
    if (this.pipe) {
      await this.pipe.dispose();
      this.pipe = null;
      this.config = null;
      this._device = null;
      // Hint to GC
      if (global.gc) global.gc();
    }
  }

  get currentModel(): ModelConfig | null {
    return this.config;
  }

  get currentDevice(): DeviceDetectionResult | null {
    return this._device;
  }
}
