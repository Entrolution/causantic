import type { Command } from '../types.js';

export const recallCommand: Command = {
  name: 'recall',
  description: 'Query memory',
  usage: 'ecm recall <query> [--limit <n>] [--json]',
  handler: async (args) => {
    if (args.length === 0) {
      console.error('Error: Query required');
      console.log('Usage: ecm recall <query>');
      process.exit(2);
    }
    const { recall } = await import('../../retrieval/context-assembler.js');
    const results = await recall(args.join(' '), { vectorSearchLimit: 10 });
    console.log(JSON.stringify(results, null, 2));
  },
};
