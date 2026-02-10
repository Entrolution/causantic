import type { Command } from '../types.js';

export const ingestCommand: Command = {
  name: 'ingest',
  description: 'Ingest a session or project',
  usage: 'ecm ingest <path> [--force]',
  handler: async (args) => {
    if (args.length === 0) {
      console.error('Error: Path required');
      console.log('Usage: ecm ingest <path>');
      process.exit(2);
    }
    const { ingestSession } = await import('../../ingest/ingest-session.js');
    await ingestSession(args[0]);
    console.log('Ingestion complete.');
  },
};

export const batchIngestCommand: Command = {
  name: 'batch-ingest',
  description: 'Ingest all sessions from a directory',
  usage: 'ecm batch-ingest <directory> [--parallel <n>]',
  handler: async (args) => {
    if (args.length === 0) {
      console.error('Error: Directory required');
      console.log('Usage: ecm batch-ingest <directory>');
      process.exit(2);
    }
    const { batchIngestDirectory } = await import('../../ingest/batch-ingest.js');
    const result = await batchIngestDirectory(args[0], {});
    console.log(`Batch ingestion complete: ${result.successCount} sessions processed.`);
  },
};
