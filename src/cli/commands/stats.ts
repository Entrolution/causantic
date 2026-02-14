import type { Command } from '../types.js';
import { getChunkCount, getSessionIds } from '../../storage/chunk-store.js';
import { getEdgeCount } from '../../storage/edge-store.js';
import { getClusterCount } from '../../storage/cluster-store.js';
import { readHookStatus, formatHookStatus } from '../../hooks/hook-status.js';

export const statsCommand: Command = {
  name: 'stats',
  description: 'Show memory statistics',
  usage: 'causantic stats [--json]',
  handler: async (_args) => {
    const chunks = getChunkCount();
    const edges = getEdgeCount();
    const clusters = getClusterCount();
    const sessions = getSessionIds().length;

    console.log('Memory Statistics:');
    console.log(`  Sessions: ${sessions}`);
    console.log(`  Chunks: ${chunks}`);
    console.log(`  Edges: ${edges}`);
    console.log(`  Clusters: ${clusters}`);

    console.log('');

    const hookStatus = readHookStatus();
    console.log(formatHookStatus(hookStatus));
  },
};

export const healthCommand: Command = {
  name: 'health',
  description: 'Check system health',
  usage: 'causantic health [--verbose]',
  handler: async (_args) => {
    const { getDb } = await import('../../storage/db.js');
    console.log('Health Check:');

    try {
      const db = getDb();
      db.prepare('SELECT 1').get();
      console.log('  Database: OK');
    } catch (error) {
      console.log(`  Database: FAILED - ${(error as Error).message}`);
    }

    try {
      const { vectorStore } = await import('../../storage/vector-store.js');
      if (vectorStore && typeof vectorStore.count === 'function') {
        await vectorStore.count();
      }
      console.log('  Vector Store: OK');
    } catch (error) {
      console.log(`  Vector Store: FAILED - ${(error as Error).message}`);
    }

    console.log('');
    console.log('System ready.');
  },
};
