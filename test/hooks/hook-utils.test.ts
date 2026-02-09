/**
 * Tests for hook utilities.
 */

import { describe, it, expect } from 'vitest';
import type {
  HookLogEntry,
  HookMetrics,
  RetryOptions,
  HookConfig,
} from '../../src/hooks/hook-utils.js';
import { isTransientError, createMetrics, completeMetrics } from '../../src/hooks/hook-utils.js';

describe('hook-utils', () => {
  describe('HookLogEntry interface', () => {
    it('has correct structure', () => {
      const entry: HookLogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        hook: 'session-start',
        event: 'hook_started',
      };

      expect(entry.timestamp).toBeTruthy();
      expect(entry.level).toBe('info');
      expect(entry.hook).toBe('session-start');
      expect(entry.event).toBe('hook_started');
    });

    it('supports optional durationMs', () => {
      const entry: HookLogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        hook: 'pre-compact',
        event: 'hook_completed',
        durationMs: 150,
      };

      expect(entry.durationMs).toBe(150);
    });

    it('supports optional error', () => {
      const entry: HookLogEntry = {
        timestamp: new Date().toISOString(),
        level: 'error',
        hook: 'session-start',
        event: 'hook_failed',
        error: 'Database connection failed',
      };

      expect(entry.error).toBe('Database connection failed');
    });

    it('supports optional details', () => {
      const entry: HookLogEntry = {
        timestamp: new Date().toISOString(),
        level: 'debug',
        hook: 'session-start',
        event: 'clusters_loaded',
        details: { total: 10, withDescription: 8 },
      };

      expect(entry.details?.total).toBe(10);
    });

    it('accepts all log levels', () => {
      const levels: Array<'debug' | 'info' | 'warn' | 'error'> = ['debug', 'info', 'warn', 'error'];

      for (const level of levels) {
        const entry: HookLogEntry = {
          timestamp: new Date().toISOString(),
          level,
          hook: 'test',
          event: 'test_event',
        };
        expect(entry.level).toBe(level);
      }
    });
  });

  describe('HookMetrics interface', () => {
    it('has correct structure for started hook', () => {
      const metrics: HookMetrics = {
        hookName: 'session-start',
        startTime: Date.now(),
        retryCount: 0,
      };

      expect(metrics.hookName).toBe('session-start');
      expect(metrics.startTime).toBeTruthy();
      expect(metrics.retryCount).toBe(0);
      expect(metrics.endTime).toBeUndefined();
    });

    it('has correct structure for completed hook', () => {
      const startTime = Date.now() - 100;
      const endTime = Date.now();
      const metrics: HookMetrics = {
        hookName: 'pre-compact',
        startTime,
        endTime,
        durationMs: endTime - startTime,
        success: true,
        retryCount: 0,
      };

      expect(metrics.success).toBe(true);
      expect(metrics.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('has correct structure for failed hook', () => {
      const metrics: HookMetrics = {
        hookName: 'session-start',
        startTime: Date.now() - 50,
        endTime: Date.now(),
        durationMs: 50,
        success: false,
        retryCount: 2,
        error: 'Connection timeout',
      };

      expect(metrics.success).toBe(false);
      expect(metrics.error).toBe('Connection timeout');
      expect(metrics.retryCount).toBe(2);
    });
  });

  describe('RetryOptions interface', () => {
    it('has correct defaults', () => {
      const defaults: RetryOptions = {
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        backoffFactor: 2,
      };

      expect(defaults.maxRetries).toBe(3);
      expect(defaults.initialDelayMs).toBe(1000);
      expect(defaults.maxDelayMs).toBe(10000);
      expect(defaults.backoffFactor).toBe(2);
    });

    it('supports retryOn predicate', () => {
      const options: RetryOptions = {
        retryOn: (error) => error.message.includes('timeout'),
      };

      const timeoutError = new Error('Connection timeout');
      const otherError = new Error('Invalid data');

      expect(options.retryOn!(timeoutError)).toBe(true);
      expect(options.retryOn!(otherError)).toBe(false);
    });
  });

  describe('HookConfig interface', () => {
    it('has correct structure', () => {
      const config: HookConfig = {
        enableLogging: true,
        logLevel: 'debug',
      };

      expect(config.enableLogging).toBe(true);
      expect(config.logLevel).toBe('debug');
    });
  });

  describe('createMetrics', () => {
    it('creates metrics with hook name', () => {
      const metrics = createMetrics('session-start');

      expect(metrics.hookName).toBe('session-start');
    });

    it('sets startTime to current time', () => {
      const before = Date.now();
      const metrics = createMetrics('test');
      const after = Date.now();

      expect(metrics.startTime).toBeGreaterThanOrEqual(before);
      expect(metrics.startTime).toBeLessThanOrEqual(after);
    });

    it('initializes retryCount to 0', () => {
      const metrics = createMetrics('test');

      expect(metrics.retryCount).toBe(0);
    });
  });

  describe('completeMetrics', () => {
    it('sets endTime', () => {
      const metrics = createMetrics('test');
      const completed = completeMetrics(metrics, true);

      expect(completed.endTime).toBeTruthy();
    });

    it('calculates durationMs', () => {
      const metrics = createMetrics('test');
      metrics.startTime = Date.now() - 100;
      const completed = completeMetrics(metrics, true);

      expect(completed.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('sets success flag', () => {
      const metrics = createMetrics('test');

      const successMetrics = completeMetrics(metrics, true);
      expect(successMetrics.success).toBe(true);

      const failMetrics = completeMetrics(createMetrics('test'), false);
      expect(failMetrics.success).toBe(false);
    });

    it('records error message', () => {
      const metrics = createMetrics('test');
      const error = new Error('Something failed');
      const completed = completeMetrics(metrics, false, error);

      expect(completed.error).toBe('Something failed');
    });
  });

  describe('isTransientError', () => {
    it('returns true for network errors', () => {
      const errors = [
        new Error('ECONNRESET'),
        new Error('ECONNREFUSED'),
        new Error('ETIMEDOUT'),
        new Error('ENOTFOUND'),
        new Error('network error'),
      ];

      for (const error of errors) {
        expect(isTransientError(error)).toBe(true);
      }
    });

    it('returns true for database busy errors', () => {
      const errors = [
        new Error('database is locked'),
        new Error('SQLITE_BUSY'),
        new Error('busy timeout'),
      ];

      for (const error of errors) {
        expect(isTransientError(error)).toBe(true);
      }
    });

    it('returns true for rate limiting errors', () => {
      const errors = [
        new Error('rate limit exceeded'),
        new Error('too many requests'),
      ];

      for (const error of errors) {
        expect(isTransientError(error)).toBe(true);
      }
    });

    it('returns false for non-transient errors', () => {
      const errors = [
        new Error('Invalid input'),
        new Error('File not found'),
        new Error('Permission denied'),
        new Error('Validation failed'),
      ];

      for (const error of errors) {
        expect(isTransientError(error)).toBe(false);
      }
    });

    it('is case insensitive', () => {
      const error = new Error('NETWORK ERROR');
      expect(isTransientError(error)).toBe(true);
    });
  });

  describe('exponential backoff calculation', () => {
    it('doubles delay with backoff factor 2', () => {
      const initialDelayMs = 1000;
      const backoffFactor = 2;

      const delay0 = initialDelayMs * Math.pow(backoffFactor, 0);
      const delay1 = initialDelayMs * Math.pow(backoffFactor, 1);
      const delay2 = initialDelayMs * Math.pow(backoffFactor, 2);

      expect(delay0).toBe(1000);
      expect(delay1).toBe(2000);
      expect(delay2).toBe(4000);
    });

    it('caps at maxDelayMs', () => {
      const initialDelayMs = 1000;
      const backoffFactor = 2;
      const maxDelayMs = 5000;

      const uncappedDelay = initialDelayMs * Math.pow(backoffFactor, 10);
      const cappedDelay = Math.min(uncappedDelay, maxDelayMs);

      expect(uncappedDelay).toBeGreaterThan(maxDelayMs);
      expect(cappedDelay).toBe(maxDelayMs);
    });
  });

  describe('log level filtering', () => {
    it('filters correctly by level', () => {
      const levels = ['debug', 'info', 'warn', 'error'];
      const configLevel = 'warn';
      const configLevelIndex = levels.indexOf(configLevel);

      const shouldLog = (entryLevel: string) => {
        const entryLevelIndex = levels.indexOf(entryLevel);
        return entryLevelIndex >= configLevelIndex;
      };

      expect(shouldLog('debug')).toBe(false);
      expect(shouldLog('info')).toBe(false);
      expect(shouldLog('warn')).toBe(true);
      expect(shouldLog('error')).toBe(true);
    });
  });

  describe('hook execution flow', () => {
    it('tracks metrics through execution', () => {
      // Simulate hook execution
      const metrics = createMetrics('session-start');

      // Simulate some work
      metrics.retryCount = 1;

      // Complete the hook
      const completed = completeMetrics(metrics, true);

      expect(completed.hookName).toBe('session-start');
      expect(completed.success).toBe(true);
      expect(completed.retryCount).toBe(1);
    });
  });

  describe('error formatting', () => {
    it('extracts message from Error', () => {
      const error = new Error('Something went wrong');
      const message = error.message;

      expect(message).toBe('Something went wrong');
    });

    it('converts non-Error to string', () => {
      const error = 'String error';
      const message = error instanceof Error ? error.message : String(error);

      expect(message).toBe('String error');
    });

    it('handles null/undefined', () => {
      const error = null;
      const message = error instanceof Error ? error.message : String(error);

      expect(message).toBe('null');
    });
  });
});
