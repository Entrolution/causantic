/**
 * Embedding pipeline wrapper around @huggingface/transformers.
 *
 * Loads models sequentially and provides a simple embed() interface.
 * Handles task prefixes for models that need them (nomic).
 * Tracks memory usage for benchmark reporting.
 */

import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import type { ModelConfig } from './model-registry.js';

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

export class Embedder {
  private pipe: FeatureExtractionPipeline | null = null;
  private config: ModelConfig | null = null;

  /**
   * Load a model. Disposes any previously loaded model first.
   */
  async load(config: ModelConfig): Promise<ModelStats> {
    await this.dispose();

    const heapBefore = process.memoryUsage().heapUsed;
    const start = performance.now();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.pipe = await (pipeline as any)('feature-extraction', config.hfId, {
      dtype: 'fp32',
    }) as FeatureExtractionPipeline;
    this.config = config;

    const loadTimeMs = performance.now() - start;
    const heapAfter = process.memoryUsage().heapUsed;
    const heapUsedMB = (heapAfter - heapBefore) / (1024 * 1024);

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
   * Dispose the current model to free memory.
   */
  async dispose(): Promise<void> {
    if (this.pipe) {
      await this.pipe.dispose();
      this.pipe = null;
      this.config = null;
      // Hint to GC
      if (global.gc) global.gc();
    }
  }

  get currentModel(): ModelConfig | null {
    return this.config;
  }
}
