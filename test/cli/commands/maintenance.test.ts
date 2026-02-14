/**
 * Tests for the maintenance CLI command handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the scheduler module before importing the command
vi.mock('../../../src/maintenance/scheduler.js', () => ({
  runTask: vi.fn(),
  runAllTasks: vi.fn(),
  getStatus: vi.fn(),
  runDaemon: vi.fn(),
}));

import { maintenanceCommand } from '../../../src/cli/commands/maintenance.js';
import { runTask, runAllTasks, getStatus, runDaemon } from '../../../src/maintenance/scheduler.js';

const mockRunTask = vi.mocked(runTask);
const mockRunAllTasks = vi.mocked(runAllTasks);
const mockGetStatus = vi.mocked(getStatus);
const mockRunDaemon = vi.mocked(runDaemon);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});

describe('maintenanceCommand', () => {
  it('has correct name and usage', () => {
    expect(maintenanceCommand.name).toBe('maintenance');
    expect(maintenanceCommand.usage).toContain('run');
    expect(maintenanceCommand.usage).toContain('status');
    expect(maintenanceCommand.usage).toContain('daemon');
  });

  describe('run subcommand', () => {
    it('runs all tasks when task name is "all"', async () => {
      const results = new Map<string, { success: boolean; duration: number; message: string }>();
      results.set('scan-projects', {
        success: true,
        duration: 100,
        message: '3 sessions ingested',
      });
      results.set('vacuum', { success: false, duration: 50, message: 'Database locked' });
      mockRunAllTasks.mockResolvedValue(results);

      await maintenanceCommand.handler(['run', 'all']);

      expect(mockRunAllTasks).toHaveBeenCalledOnce();
      expect(console.log).toHaveBeenCalledWith('Running all maintenance tasks...');
      expect(console.log).toHaveBeenCalledWith('  scan-projects: OK - 3 sessions ingested');
      expect(console.log).toHaveBeenCalledWith('  vacuum: FAILED - Database locked');
    });

    it('runs a specific task by name', async () => {
      mockRunTask.mockResolvedValue({ success: true, duration: 200, message: 'Pruned 5 edges' });

      await maintenanceCommand.handler(['run', 'prune-graph']);

      expect(mockRunTask).toHaveBeenCalledWith('prune-graph');
      expect(console.log).toHaveBeenCalledWith('prune-graph: OK - Pruned 5 edges');
    });

    it('reports failed task status', async () => {
      mockRunTask.mockResolvedValue({ success: false, duration: 10, message: 'No database' });

      await maintenanceCommand.handler(['run', 'vacuum']);

      expect(console.log).toHaveBeenCalledWith('vacuum: FAILED - No database');
    });

    it('exits with code 2 when no task name is provided', async () => {
      await maintenanceCommand.handler(['run']);

      expect(console.error).toHaveBeenCalledWith('Error: Task name required');
      expect(process.exit).toHaveBeenCalledWith(2);
    });
  });

  describe('status subcommand', () => {
    it('prints status for tasks that have never run', async () => {
      mockGetStatus.mockReturnValue([
        {
          name: 'scan-projects',
          description: 'Discover new sessions',
          schedule: '0 * * * *',
          lastRun: null,
          nextRun: new Date('2026-02-12T01:00:00Z'),
        },
      ]);

      await maintenanceCommand.handler(['status']);

      expect(console.log).toHaveBeenCalledWith('Maintenance Task Status:');
      expect(console.log).toHaveBeenCalledWith('scan-projects:');
      expect(console.log).toHaveBeenCalledWith('  Schedule: 0 * * * *');
      expect(console.log).toHaveBeenCalledWith('  Last run: Never');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Next run:'));
    });

    it('prints status for tasks that have run successfully', async () => {
      mockGetStatus.mockReturnValue([
        {
          name: 'vacuum',
          description: 'Optimize SQLite database',
          schedule: '0 5 * * 0',
          lastRun: {
            taskName: 'vacuum',
            startTime: '2026-02-10T05:00:00Z',
            endTime: '2026-02-10T05:00:02Z',
            success: true,
            message: 'Vacuumed successfully',
          },
          nextRun: new Date('2026-02-16T05:00:00Z'),
        },
      ]);

      await maintenanceCommand.handler(['status']);

      expect(console.log).toHaveBeenCalledWith('vacuum:');
      expect(console.log).toHaveBeenCalledWith('  Last run: 2026-02-10T05:00:02Z (OK)');
    });

    it('prints FAILED status for tasks that failed', async () => {
      mockGetStatus.mockReturnValue([
        {
          name: 'update-clusters',
          description: 'Re-run clustering',
          schedule: '0 2 * * *',
          lastRun: {
            taskName: 'update-clusters',
            startTime: '2026-02-10T02:00:00Z',
            endTime: '2026-02-10T02:00:05Z',
            success: false,
            message: 'Clustering failed',
          },
          nextRun: null,
        },
      ]);

      await maintenanceCommand.handler(['status']);

      expect(console.log).toHaveBeenCalledWith('  Last run: 2026-02-10T02:00:05Z (FAILED)');
    });

    it('handles tasks with no next run', async () => {
      mockGetStatus.mockReturnValue([
        {
          name: 'prune-graph',
          description: 'Remove dead edges',
          schedule: '0 3 * * *',
          lastRun: null,
          nextRun: null,
        },
      ]);

      await maintenanceCommand.handler(['status']);

      // Should not call console.log with "Next run:" for null nextRun
      const logCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
      const nextRunCalls = logCalls.filter(
        (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('Next run:'),
      );
      expect(nextRunCalls.length).toBe(0);
    });
  });

  describe('daemon subcommand', () => {
    it('calls runDaemon with an AbortSignal', async () => {
      mockRunDaemon.mockResolvedValue(undefined);

      await maintenanceCommand.handler(['daemon']);

      expect(mockRunDaemon).toHaveBeenCalledOnce();
      const signal = mockRunDaemon.mock.calls[0][0];
      expect(signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('unknown subcommand', () => {
    it('prints error and exits with code 2', async () => {
      await maintenanceCommand.handler(['unknown']);

      expect(console.error).toHaveBeenCalledWith('Error: Unknown subcommand');
      expect(process.exit).toHaveBeenCalledWith(2);
    });

    it('handles no subcommand provided', async () => {
      await maintenanceCommand.handler([]);

      expect(console.error).toHaveBeenCalledWith('Error: Unknown subcommand');
      expect(process.exit).toHaveBeenCalledWith(2);
    });
  });
});
