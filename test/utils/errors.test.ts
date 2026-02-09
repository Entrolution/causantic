/**
 * Tests for error types.
 */

import { describe, it, expect } from 'vitest';
import {
  EcmError,
  StorageError,
  IngestionError,
  RetrievalError,
  ConfigError,
  ClusterError,
  HookError,
  isErrorWithCode,
  isStorageError,
  isIngestionError,
  isRetrievalError,
  isConfigError,
  isClusterError,
  isHookError,
  wrapError,
} from '../../src/utils/errors.js';

describe('errors', () => {
  describe('EcmError', () => {
    it('has message, code, and name', () => {
      const error = new EcmError('Something failed', 'TEST_ERROR');

      expect(error.message).toBe('Something failed');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.name).toBe('EcmError');
    });

    it('captures cause from Error', () => {
      const cause = new Error('Original error');
      const error = new EcmError('Wrapped error', 'WRAPPED', cause);

      expect(error.cause).toBe(cause);
    });

    it('converts non-Error cause to Error', () => {
      const error = new EcmError('Wrapped error', 'WRAPPED', 'string cause');

      expect(error.cause).toBeInstanceOf(Error);
      expect(error.cause?.message).toBe('string cause');
    });

    it('has undefined cause when not provided', () => {
      const error = new EcmError('No cause', 'NO_CAUSE');

      expect(error.cause).toBeUndefined();
    });

    it('is instanceof Error', () => {
      const error = new EcmError('Test', 'TEST');

      expect(error instanceof Error).toBe(true);
      expect(error instanceof EcmError).toBe(true);
    });

    it('has stack trace', () => {
      const error = new EcmError('Test', 'TEST');

      expect(error.stack).toBeTruthy();
    });
  });

  describe('toDetailedString', () => {
    it('formats basic error', () => {
      const error = new EcmError('Something failed', 'TEST_ERROR');
      const str = error.toDetailedString();

      expect(str).toBe('EcmError [TEST_ERROR]: Something failed');
    });

    it('includes cause', () => {
      const cause = new Error('Original error');
      const error = new EcmError('Wrapped error', 'WRAPPED', cause);
      const str = error.toDetailedString();

      expect(str).toContain('Wrapped error');
      expect(str).toContain('Caused by: Original error');
    });

    it('includes EcmError cause code', () => {
      const cause = new StorageError('DB failed', 'DB_FAILED');
      const error = new IngestionError('Ingest failed', 'INGEST_FAILED', cause);
      const str = error.toDetailedString();

      expect(str).toContain('[INGEST_FAILED]');
      expect(str).toContain('[DB_FAILED]');
    });
  });

  describe('StorageError', () => {
    it('extends EcmError', () => {
      const error = new StorageError('DB failed', 'DB_CONNECTION_FAILED');

      expect(error instanceof EcmError).toBe(true);
      expect(error instanceof StorageError).toBe(true);
      expect(error.name).toBe('StorageError');
    });

    it('has correct code', () => {
      const error = new StorageError('Not found', 'CHUNK_NOT_FOUND');

      expect(error.code).toBe('CHUNK_NOT_FOUND');
    });
  });

  describe('IngestionError', () => {
    it('extends EcmError', () => {
      const error = new IngestionError('Parse failed', 'PARSE_FAILED');

      expect(error instanceof EcmError).toBe(true);
      expect(error instanceof IngestionError).toBe(true);
      expect(error.name).toBe('IngestionError');
    });
  });

  describe('RetrievalError', () => {
    it('extends EcmError', () => {
      const error = new RetrievalError('Traversal failed', 'TRAVERSAL_FAILED');

      expect(error instanceof EcmError).toBe(true);
      expect(error instanceof RetrievalError).toBe(true);
      expect(error.name).toBe('RetrievalError');
    });
  });

  describe('ConfigError', () => {
    it('extends EcmError', () => {
      const error = new ConfigError('Invalid config', 'CONFIG_INVALID');

      expect(error instanceof EcmError).toBe(true);
      expect(error instanceof ConfigError).toBe(true);
      expect(error.name).toBe('ConfigError');
    });
  });

  describe('ClusterError', () => {
    it('extends EcmError', () => {
      const error = new ClusterError('Clustering failed', 'CLUSTER_FAILED');

      expect(error instanceof EcmError).toBe(true);
      expect(error instanceof ClusterError).toBe(true);
      expect(error.name).toBe('ClusterError');
    });
  });

  describe('HookError', () => {
    it('extends EcmError', () => {
      const error = new HookError('Hook timeout', 'HOOK_TIMEOUT');

      expect(error instanceof EcmError).toBe(true);
      expect(error instanceof HookError).toBe(true);
      expect(error.name).toBe('HookError');
    });
  });

  describe('isErrorWithCode', () => {
    it('returns true for matching code', () => {
      const error = new StorageError('Test', 'TEST_CODE');

      expect(isErrorWithCode(error, 'TEST_CODE')).toBe(true);
    });

    it('returns false for non-matching code', () => {
      const error = new StorageError('Test', 'TEST_CODE');

      expect(isErrorWithCode(error, 'OTHER_CODE')).toBe(false);
    });

    it('returns false for non-EcmError', () => {
      const error = new Error('Test');

      expect(isErrorWithCode(error, 'TEST_CODE')).toBe(false);
    });

    it('returns false for non-error', () => {
      expect(isErrorWithCode('string', 'TEST_CODE')).toBe(false);
      expect(isErrorWithCode(null, 'TEST_CODE')).toBe(false);
    });
  });

  describe('type guards', () => {
    it('isStorageError', () => {
      expect(isStorageError(new StorageError('Test', 'TEST'))).toBe(true);
      expect(isStorageError(new IngestionError('Test', 'TEST'))).toBe(false);
      expect(isStorageError(new Error('Test'))).toBe(false);
    });

    it('isIngestionError', () => {
      expect(isIngestionError(new IngestionError('Test', 'TEST'))).toBe(true);
      expect(isIngestionError(new StorageError('Test', 'TEST'))).toBe(false);
    });

    it('isRetrievalError', () => {
      expect(isRetrievalError(new RetrievalError('Test', 'TEST'))).toBe(true);
      expect(isRetrievalError(new StorageError('Test', 'TEST'))).toBe(false);
    });

    it('isConfigError', () => {
      expect(isConfigError(new ConfigError('Test', 'TEST'))).toBe(true);
      expect(isConfigError(new StorageError('Test', 'TEST'))).toBe(false);
    });

    it('isClusterError', () => {
      expect(isClusterError(new ClusterError('Test', 'TEST'))).toBe(true);
      expect(isClusterError(new StorageError('Test', 'TEST'))).toBe(false);
    });

    it('isHookError', () => {
      expect(isHookError(new HookError('Test', 'TEST'))).toBe(true);
      expect(isHookError(new StorageError('Test', 'TEST'))).toBe(false);
    });
  });

  describe('wrapError', () => {
    it('returns EcmError unchanged', () => {
      const original = new StorageError('Original', 'ORIGINAL');
      const wrapped = wrapError(original);

      expect(wrapped).toBe(original);
    });

    it('wraps Error', () => {
      const original = new Error('Original message');
      const wrapped = wrapError(original);

      expect(wrapped).toBeInstanceOf(EcmError);
      expect(wrapped.message).toBe('Original message');
      expect(wrapped.code).toBe('UNKNOWN');
      expect(wrapped.cause).toBe(original);
    });

    it('wraps string', () => {
      const wrapped = wrapError('string error');

      expect(wrapped).toBeInstanceOf(EcmError);
      expect(wrapped.message).toBe('string error');
      expect(wrapped.code).toBe('UNKNOWN');
    });

    it('uses custom message', () => {
      const original = new Error('Original');
      const wrapped = wrapError(original, 'Custom message');

      expect(wrapped.message).toBe('Custom message');
      expect(wrapped.cause).toBe(original);
    });
  });

  describe('error chaining', () => {
    it('supports deep error chains', () => {
      const level1 = new Error('Database connection refused');
      const level2 = new StorageError('Failed to read chunk', 'CHUNK_READ_FAILED', level1);
      const level3 = new IngestionError('Session ingestion failed', 'INGEST_FAILED', level2);

      expect(level3.cause).toBe(level2);
      expect(level2.cause).toBe(level1);
    });

    it('preserves error hierarchy in detailed string', () => {
      const cause = new StorageError('DB error', 'DB_ERROR');
      const error = new IngestionError('Ingest error', 'INGEST_ERROR', cause);

      const detailed = error.toDetailedString();

      expect(detailed).toContain('IngestionError');
      expect(detailed).toContain('INGEST_ERROR');
      expect(detailed).toContain('DB error');
      expect(detailed).toContain('DB_ERROR');
    });
  });
});
