/**
 * Tests for the uninstall CLI command handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/cli/uninstall.js', () => ({
  handleUninstall: vi.fn(),
}));

import { uninstallCommand } from '../../../src/cli/commands/uninstall.js';
import { handleUninstall } from '../../../src/cli/uninstall.js';

const mockHandleUninstall = vi.mocked(handleUninstall);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('uninstallCommand', () => {
  it('has correct name and description', () => {
    expect(uninstallCommand.name).toBe('uninstall');
    expect(uninstallCommand.description).toContain('Remove');
  });

  it('delegates to handleUninstall with args', async () => {
    mockHandleUninstall.mockResolvedValue(undefined);

    await uninstallCommand.handler(['--force', '--keep-data']);

    expect(mockHandleUninstall).toHaveBeenCalledWith(['--force', '--keep-data']);
  });

  it('delegates to handleUninstall with empty args', async () => {
    mockHandleUninstall.mockResolvedValue(undefined);

    await uninstallCommand.handler([]);

    expect(mockHandleUninstall).toHaveBeenCalledWith([]);
  });

  it('propagates errors from handleUninstall', async () => {
    mockHandleUninstall.mockRejectedValue(new Error('permission denied'));

    await expect(uninstallCommand.handler([])).rejects.toThrow('permission denied');
  });
});
