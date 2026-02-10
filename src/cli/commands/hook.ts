import type { Command } from '../types.js';

export const hookCommand: Command = {
  name: 'hook',
  description: 'Run a hook manually',
  usage: 'ecm hook <session-start|pre-compact|claudemd-generator> [path]',
  handler: async (args) => {
    const hookName = args[0];
    const path = args[1] ?? process.cwd();

    switch (hookName) {
      case 'session-start': {
        const { handleSessionStart } = await import('../../hooks/session-start.js');
        const result = await handleSessionStart(path, {});
        console.log('Session start hook executed.');
        console.log(`Summary: ${result.summary.substring(0, 200)}...`);
        break;
      }
      case 'pre-compact': {
        const { handlePreCompact } = await import('../../hooks/pre-compact.js');
        await handlePreCompact(path);
        console.log('Pre-compact hook executed.');
        break;
      }
      case 'claudemd-generator': {
        const { updateClaudeMd } = await import('../../hooks/claudemd-generator.js');
        await updateClaudeMd(path, {});
        console.log('CLAUDE.md updated.');
        break;
      }
      default:
        console.error('Error: Unknown hook');
        console.log('Usage: ecm hook <session-start|pre-compact|claudemd-generator> [path]');
        process.exit(2);
    }
  },
};
