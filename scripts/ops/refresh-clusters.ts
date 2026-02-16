/**
 * CLI script for refreshing cluster descriptions using LLM.
 * Usage: npm run refresh-clusters
 */

import { clusterRefresher } from '../src/clusters/cluster-refresh.js';
import { getAllClusters, getStaleClusters } from '../src/storage/cluster-store.js';
import { closeDb } from '../src/storage/db.js';
import { createSecretStore, getApiKey } from '../src/utils/secret-store.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let forceAll = false;
  let maxAge = 24 * 60 * 60 * 1000; // 24 hours default

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--all') {
      forceAll = true;
    } else if (args[i] === '--max-age' && args[i + 1]) {
      maxAge = parseInt(args[i + 1], 10) * 60 * 60 * 1000; // Hours to ms
      i++;
    } else if (args[i] === '--set-key' && args[i + 1]) {
      // Store API key in secret store
      const store = createSecretStore();
      await store.set('ANTHROPIC_API_KEY', args[i + 1]);
      console.log('API key stored in secret store');
      process.exit(0);
    } else if (args[i] === '--help') {
      console.log(`
Usage: npm run refresh-clusters -- [options]

Options:
  --all             Refresh all clusters (not just stale ones)
  --max-age <h>     Max age in hours before refresh (default: 24)
  --set-key <key>   Store Anthropic API key in secret store
  --help            Show this help message

API Key: Set via ANTHROPIC_API_KEY env var or store with --set-key

Example:
  npm run refresh-clusters -- --set-key sk-ant-...
  npm run refresh-clusters -- --all
  npm run refresh-clusters -- --max-age 12
      `);
      process.exit(0);
    }
  }

  // Check for API key (env var or secret store)
  const apiKey = await getApiKey('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY not found');
    console.error(
      'Set via environment variable or run: npm run refresh-clusters -- --set-key <your-key>',
    );
    process.exit(1);
  }

  // Set in process.env for the Anthropic SDK to pick up
  process.env.ANTHROPIC_API_KEY = apiKey;

  const allClusters = getAllClusters();
  const staleClusters = getStaleClusters(maxAge);

  console.log(`\nTotal clusters: ${allClusters.length}`);
  console.log(`Stale clusters: ${staleClusters.length}`);

  const toRefresh = forceAll ? allClusters : staleClusters;

  if (toRefresh.length === 0) {
    console.log('\nNo clusters to refresh.');
    closeDb();
    return;
  }

  console.log(`\nRefreshing ${toRefresh.length} clusters...`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < toRefresh.length; i++) {
    const cluster = toRefresh[i];
    process.stdout.write(`\r[${i + 1}/${toRefresh.length}] ${cluster.name || cluster.id}...`);

    try {
      const result = await clusterRefresher.refreshCluster(cluster.id);
      console.log(` -> ${result.name}`);
      success++;
    } catch (error) {
      console.log(` -> FAILED: ${error instanceof Error ? error.message : String(error)}`);
      failed++;
    }
  }

  console.log(`\n=== Refresh Complete ===`);
  console.log(`Success: ${success}`);
  console.log(`Failed:  ${failed}`);

  closeDb();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
