import type { Command } from '../types.js';

export const uninstallCommand: Command = {
  name: 'uninstall',
  description: 'Remove Causantic and all its artifacts',
  usage: 'causantic uninstall [--force] [--keep-data] [--dry-run]',
  handler: async (args) => {
    const { handleUninstall } = await import('../uninstall.js');
    await handleUninstall(args);
  },
};
