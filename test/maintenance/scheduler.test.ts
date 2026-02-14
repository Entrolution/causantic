/**
 * Tests for maintenance/scheduler.ts — task definitions, lookup, execution, and daemon lifecycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock heavy dependencies so importing scheduler doesn't pull in the whole system.
// The scheduler uses dynamic imports inside handler functions, but also has static
// imports for the task handler modules and config/logger. We mock the config module
// to avoid touching the real filesystem for state persistence.
vi.mock('../../src/config/memory-config.js', () => ({
  resolvePath: vi.fn((p: string) => p.replace('~', '/tmp/test-causantic')),
}));

vi.mock('../../src/config/loader.js', () => ({
  loadConfig: vi.fn(() => ({ maintenance: { clusterHour: 2 } })),
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock node:fs so loadState/saveState don't touch disk
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock all static task handler imports so they don't pull in real dependencies
vi.mock('../../src/maintenance/tasks/scan-projects.js', () => ({
  scanProjects: vi.fn(),
}));
vi.mock('../../src/maintenance/tasks/update-clusters.js', () => ({
  updateClusters: vi.fn(),
}));
vi.mock('../../src/maintenance/tasks/vacuum.js', () => ({
  vacuum: vi.fn(),
}));
vi.mock('../../src/maintenance/tasks/cleanup-vectors.js', () => ({
  cleanupVectors: vi.fn(),
}));

import {
  MAINTENANCE_TASKS,
  getTask,
  runTask,
  getStatus,
  runDaemon,
} from '../../src/maintenance/scheduler.js';

describe('MAINTENANCE_TASKS', () => {
  it('has exactly 4 tasks', () => {
    expect(MAINTENANCE_TASKS).toHaveLength(4);
  });

  it('contains all expected task names', () => {
    const names = MAINTENANCE_TASKS.map((t) => t.name);
    expect(names).toEqual(['scan-projects', 'update-clusters', 'cleanup-vectors', 'vacuum']);
  });

  it('all tasks have required fields: name, description, schedule, handler', () => {
    for (const task of MAINTENANCE_TASKS) {
      expect(task.name).toBeTypeOf('string');
      expect(task.name.length).toBeGreaterThan(0);

      expect(task.description).toBeTypeOf('string');
      expect(task.description.length).toBeGreaterThan(0);

      expect(task.schedule).toBeTypeOf('string');
      // Cron schedule should have 5 space-separated parts
      expect(task.schedule.split(' ')).toHaveLength(5);

      expect(task.requiresApiKey).toBeTypeOf('boolean');

      expect(task.handler).toBeTypeOf('function');
    }
  });

  it('no tasks require API key (label refresh is handled by update-clusters)', () => {
    for (const task of MAINTENANCE_TASKS) {
      expect(task.requiresApiKey).toBe(false);
    }
  });
});

describe('getTask', () => {
  it('returns correct task by name', () => {
    const task = getTask('scan-projects');
    expect(task).toBeDefined();
    expect(task!.name).toBe('scan-projects');
    expect(task!.description).toContain('sessions');
  });

  it('returns each task by its name', () => {
    for (const expected of MAINTENANCE_TASKS) {
      const task = getTask(expected.name);
      expect(task).toBeDefined();
      expect(task!.name).toBe(expected.name);
      expect(task!.handler).toBe(expected.handler);
    }
  });

  it('returns undefined for unknown task name', () => {
    const task = getTask('nonexistent-task');
    expect(task).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    const task = getTask('');
    expect(task).toBeUndefined();
  });
});

describe('runTask', () => {
  it('returns error for unknown task name', async () => {
    const result = await runTask('does-not-exist');

    expect(result.success).toBe(false);
    expect(result.duration).toBe(0);
    expect(result.message).toBe('Unknown task: does-not-exist');
  });

  it('returns error for empty task name', async () => {
    const result = await runTask('');

    expect(result.success).toBe(false);
    expect(result.message).toBe('Unknown task: ');
  });

  it('handles handler errors gracefully and returns success: false', async () => {
    // Replace one of the task handlers temporarily with one that throws
    const task = getTask('vacuum');
    expect(task).toBeDefined();

    const originalHandler = task!.handler;
    task!.handler = async () => {
      throw new Error('simulated handler failure');
    };

    try {
      const result = await runTask('vacuum');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Task failed: simulated handler failure');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    } finally {
      // Restore the original handler
      task!.handler = originalHandler;
    }
  });

  it('returns the handler result on success', async () => {
    const task = getTask('scan-projects');
    expect(task).toBeDefined();

    const originalHandler = task!.handler;
    task!.handler = async () => ({
      success: true,
      duration: 42,
      message: 'All good',
      details: { count: 5 },
    });

    try {
      const result = await runTask('scan-projects');

      expect(result.success).toBe(true);
      expect(result.message).toBe('All good');
      expect(result.duration).toBe(42);
      expect(result.details).toEqual({ count: 5 });
    } finally {
      task!.handler = originalHandler;
    }
  });
});

describe('getStatus', () => {
  it('returns status for all 4 tasks', () => {
    const status = getStatus();

    expect(status).toHaveLength(4);
  });

  it('each status entry has required fields', () => {
    const status = getStatus();

    for (const entry of status) {
      expect(entry.name).toBeTypeOf('string');
      expect(entry.description).toBeTypeOf('string');
      expect(entry.schedule).toBeTypeOf('string');
      // lastRun is null when no state file exists (mocked existsSync returns false)
      expect(entry.lastRun).toBeNull();
      // nextRun is a Date or null depending on schedule parsing
      expect(entry.nextRun === null || entry.nextRun instanceof Date).toBe(true);
    }
  });

  it('status task names match MAINTENANCE_TASKS order', () => {
    const status = getStatus();
    const names = status.map((s) => s.name);

    expect(names).toEqual(MAINTENANCE_TASKS.map((t) => t.name));
  });
});

describe('runDaemon', () => {
  beforeEach(() => {
    // Use minute 15 so no cron schedules match (all require minute 0 or 30),
    // avoiding handler execution with unmocked dynamic imports
    vi.useFakeTimers({ now: new Date('2024-01-15T10:15:00Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops when AbortSignal is aborted', async () => {
    const controller = new AbortController();

    // Start the daemon - it suspends at await checkAndRun()
    const daemonPromise = runDaemon(controller.signal);

    // Flush microtasks so runDaemon progresses past checkAndRun() and registers abort listeners
    await vi.advanceTimersByTimeAsync(0);

    // Now abort — listeners are registered, so they fire and resolve the keepalive promise
    controller.abort();

    // The daemon promise should resolve without hanging
    await daemonPromise;
  });

  it('does not hang when aborted before interval fires', async () => {
    const controller = new AbortController();

    const daemonPromise = runDaemon(controller.signal);

    // Advance time (also flushes microtasks so listeners get registered)
    await vi.advanceTimersByTimeAsync(5000);

    // Abort the daemon
    controller.abort();

    await daemonPromise;
  });
});
