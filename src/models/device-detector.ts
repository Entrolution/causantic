/**
 * Runtime detection of optimal ONNX execution provider for embedding inference.
 *
 * Detects hardware capabilities and returns the best execution provider chain.
 * All accelerated devices use onnxruntime-node (device: 'cpu' in transformers.js)
 * with execution providers overridden via session_options.
 */

import { execSync } from 'node:child_process';
import { createLogger } from '../utils/logger.js';

const log = createLogger('device-detector');

export type DeviceName = 'coreml' | 'cuda' | 'cpu' | 'wasm';

export interface DeviceDetectionResult {
  /** The detected/selected device name. */
  device: DeviceName;
  /** Ordered execution provider list for onnxruntime session_options. */
  executionProviders: string[];
  /** Human-readable label for CLI display (e.g. "CoreML (Apple Silicon)"). */
  label: string;
  /** How this device was selected. */
  source: 'override' | 'env' | 'auto';
  /** Optional notes (e.g. "coreml available — set CAUSANTIC_EMBEDDING_DEVICE to enable"). */
  notes?: string;
  /** Accelerators detected as available but not activated by default. */
  available?: AvailableAccelerator[];
}

/** Cached nvidia-smi result to avoid repeated subprocess spawns. */
let nvidiaSmiCache: boolean | null = null;

function hasNvidiaSmi(): boolean {
  if (nvidiaSmiCache !== null) return nvidiaSmiCache;
  try {
    execSync('nvidia-smi', { timeout: 2000, stdio: 'ignore' });
    nvidiaSmiCache = true;
  } catch {
    nvidiaSmiCache = false;
  }
  return nvidiaSmiCache;
}

function normalizeDevice(raw: string): DeviceName {
  const lower = raw.trim().toLowerCase();
  if (lower === 'coreml') return 'coreml';
  if (lower === 'cuda') return 'cuda';
  if (lower === 'wasm') return 'wasm';
  if (lower === 'cpu') return 'cpu';
  if (lower === 'auto') return 'auto' as DeviceName; // sentinel, resolved below
  return 'cpu'; // unknown → safe fallback
}

function buildProviderList(device: DeviceName): string[] {
  switch (device) {
    case 'coreml':
      return ['coreml', 'cpu'];
    case 'cuda':
      return ['cuda', 'cpu'];
    case 'cpu':
      return ['cpu'];
    case 'wasm':
      return []; // WASM uses transformers.js built-in, no onnxruntime providers
    default:
      return ['cpu'];
  }
}

function deviceLabel(device: DeviceName): string {
  switch (device) {
    case 'coreml':
      return 'CoreML (Apple Silicon)';
    case 'cuda':
      return 'CUDA (NVIDIA GPU)';
    case 'cpu':
      return 'CPU (native)';
    case 'wasm':
      return 'WASM (fallback)';
    default:
      return 'CPU (native)';
  }
}

/** Accelerators that are available but not defaulted (opt-in). */
export type AvailableAccelerator = 'coreml' | 'cuda';

function detectAvailableAccelerators(): AvailableAccelerator[] {
  const accelerators: AvailableAccelerator[] = [];

  if (process.platform === 'darwin') {
    accelerators.push('coreml');
  }

  if (process.platform === 'linux' && process.arch === 'x64' && hasNvidiaSmi()) {
    accelerators.push('cuda');
  }

  return accelerators;
}

function autoDetect(): { device: DeviceName; notes?: string; available?: AvailableAccelerator[] } {
  // Default to CPU — accelerated EPs are opt-in because:
  // - CoreML: partitions models with large vocab embeddings (>16384 dims),
  //   causing 30+ context switches per inference and OOM kills
  // - CUDA: requires compatible driver/runtime, untested model combinations
  const available = detectAvailableAccelerators();
  const hints =
    available.length > 0
      ? `${available.join(', ')} available — set CAUSANTIC_EMBEDDING_DEVICE to enable`
      : undefined;

  return { device: 'cpu', notes: hints, available };
}

/**
 * Detect the optimal ONNX execution provider for the current system.
 *
 * @param override - Explicit device selection (from config or CLI flag).
 *   Takes priority over env var and auto-detection.
 */
export function detectDevice(override?: string): DeviceDetectionResult {
  // 1. Explicit override from caller (config/CLI)
  if (override && override !== 'auto') {
    const device = normalizeDevice(override);
    const result: DeviceDetectionResult = {
      device,
      executionProviders: buildProviderList(device),
      label: deviceLabel(device),
      source: 'override',
    };
    log.info(`Device override: ${result.label}`);
    return result;
  }

  // 2. Environment variable
  const envDevice = process.env.CAUSANTIC_EMBEDDING_DEVICE;
  if (envDevice && envDevice !== 'auto') {
    const device = normalizeDevice(envDevice);
    const result: DeviceDetectionResult = {
      device,
      executionProviders: buildProviderList(device),
      label: deviceLabel(device),
      source: 'env',
    };
    log.info(`Device from env: ${result.label}`);
    return result;
  }

  // 3. Auto-detect from platform (defaults to CPU, accelerators are opt-in)
  const { device, notes, available } = autoDetect();
  const result: DeviceDetectionResult = {
    device,
    executionProviders: buildProviderList(device),
    label: deviceLabel(device),
    source: 'auto',
    notes,
    available,
  };
  log.info(`Device auto-detected: ${result.label}${notes ? ` (${notes})` : ''}`);
  return result;
}
