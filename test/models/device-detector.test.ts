/**
 * Tests for ONNX runtime device detection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectDevice, type DeviceDetectionResult } from '../../src/models/device-detector.js';

describe('device-detector', () => {
  const originalPlatform = process.platform;
  const originalArch = process.arch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.CAUSANTIC_EMBEDDING_DEVICE;
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    Object.defineProperty(process, 'arch', { value: originalArch });
    process.env = { ...originalEnv };
  });

  describe('auto-detection', () => {
    it('defaults to CPU on macOS arm64 with CoreML available', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      Object.defineProperty(process, 'arch', { value: 'arm64' });

      const result = detectDevice();

      expect(result.device).toBe('cpu');
      expect(result.executionProviders).toEqual(['cpu']);
      expect(result.source).toBe('auto');
      expect(result.available).toContain('coreml');
    });

    it('defaults to CPU on macOS x64 with CoreML available', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      Object.defineProperty(process, 'arch', { value: 'x64' });

      const result = detectDevice();

      expect(result.device).toBe('cpu');
      expect(result.available).toContain('coreml');
    });

    it('defaults to CPU on Linux without nvidia-smi', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      Object.defineProperty(process, 'arch', { value: 'x64' });

      // nvidia-smi will fail in test environment, so falls back to CPU
      const result = detectDevice();

      // Could be cuda-available or just cpu depending on test environment
      expect(result.device).toBe('cpu');
      expect(result.source).toBe('auto');
    });
  });

  describe('manual override via argument', () => {
    it('respects explicit cpu override', () => {
      const result = detectDevice('cpu');

      expect(result.device).toBe('cpu');
      expect(result.executionProviders).toEqual(['cpu']);
      expect(result.source).toBe('override');
    });

    it('respects explicit coreml override', () => {
      const result = detectDevice('coreml');

      expect(result.device).toBe('coreml');
      expect(result.executionProviders).toEqual(['coreml', 'cpu']);
      expect(result.source).toBe('override');
    });

    it('respects explicit cuda override', () => {
      const result = detectDevice('cuda');

      expect(result.device).toBe('cuda');
      expect(result.executionProviders).toEqual(['cuda', 'cpu']);
      expect(result.source).toBe('override');
    });

    it('respects wasm override', () => {
      const result = detectDevice('wasm');

      expect(result.device).toBe('wasm');
      expect(result.executionProviders).toEqual([]);
      expect(result.source).toBe('override');
    });

    it('auto override falls through to auto-detection', () => {
      const result = detectDevice('auto');

      expect(result.source).toBe(
        process.env.CAUSANTIC_EMBEDDING_DEVICE ? 'env' : 'auto'
      );
    });
  });

  describe('environment variable override', () => {
    it('reads CAUSANTIC_EMBEDDING_DEVICE env var', () => {
      process.env.CAUSANTIC_EMBEDDING_DEVICE = 'cpu';

      const result = detectDevice();

      expect(result.device).toBe('cpu');
      expect(result.source).toBe('env');
    });

    it('explicit arg takes priority over env var', () => {
      process.env.CAUSANTIC_EMBEDDING_DEVICE = 'cpu';

      const result = detectDevice('coreml');

      expect(result.device).toBe('coreml');
      expect(result.source).toBe('override');
    });
  });

  describe('provider list safety', () => {
    it('accelerated devices always include cpu fallback', () => {
      const coreml = detectDevice('coreml');
      expect(coreml.executionProviders[coreml.executionProviders.length - 1]).toBe('cpu');

      const cuda = detectDevice('cuda');
      expect(cuda.executionProviders[cuda.executionProviders.length - 1]).toBe('cpu');
    });

    it('cpu device has single-element provider list', () => {
      const result = detectDevice('cpu');
      expect(result.executionProviders).toEqual(['cpu']);
    });

    it('wasm device has empty provider list', () => {
      const result = detectDevice('wasm');
      expect(result.executionProviders).toEqual([]);
    });
  });

  describe('unknown device handling', () => {
    it('falls back to cpu for unknown device name', () => {
      const result = detectDevice('tpu');

      expect(result.device).toBe('cpu');
      expect(result.executionProviders).toEqual(['cpu']);
    });
  });

  describe('label formatting', () => {
    it('returns human-readable labels', () => {
      expect(detectDevice('coreml').label).toBe('CoreML (Apple Silicon)');
      expect(detectDevice('cuda').label).toBe('CUDA (NVIDIA GPU)');
      expect(detectDevice('cpu').label).toBe('CPU (native)');
      expect(detectDevice('wasm').label).toBe('WASM (fallback)');
    });
  });

  describe('result structure', () => {
    it('always returns all required fields', () => {
      const result = detectDevice();

      expect(result).toHaveProperty('device');
      expect(result).toHaveProperty('executionProviders');
      expect(result).toHaveProperty('label');
      expect(result).toHaveProperty('source');
      expect(Array.isArray(result.executionProviders)).toBe(true);
    });
  });
});
