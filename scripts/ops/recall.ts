/**
 * CLI script for testing memory recall.
 * Usage: npm run recall -- "query text"
 */

import { recall, explain, predict, disposeRetrieval } from '../src/retrieval/context-assembler.js';
import { closeDb } from '../src/storage/db.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let query = '';
  let mode: 'recall' | 'explain' | 'predict' = 'recall';
  let maxTokens = 2000;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) {
      mode = args[i + 1] as 'recall' | 'explain' | 'predict';
      i++;
    } else if (args[i] === '--max-tokens' && args[i + 1]) {
      maxTokens = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--help') {
      console.log(`
Usage: npm run recall -- [options] "query text"

Options:
  --mode <mode>         recall, explain, or predict (default: recall)
  --max-tokens <n>      Maximum tokens in response (default: 2000)
  --help                Show this help message

Examples:
  npm run recall -- "authentication system"
  npm run recall -- --mode explain "why we chose React"
  npm run recall -- --mode predict "implementing user settings"
      `);
      process.exit(0);
    } else if (!args[i].startsWith('--')) {
      query = args[i];
    }
  }

  if (!query) {
    console.error('Error: Query text required');
    console.log('Usage: npm run recall -- "query text"');
    process.exit(1);
  }

  console.log(`\nMode: ${mode}`);
  console.log(`Query: "${query}"`);
  console.log(`Max tokens: ${maxTokens}`);
  console.log('\n--- Results ---\n');

  let result;
  switch (mode) {
    case 'recall':
      result = await recall(query, { maxTokens });
      break;
    case 'explain':
      result = await explain(query, { maxTokens });
      break;
    case 'predict':
      result = await predict(query, { maxTokens });
      break;
  }

  if (result.chunks.length === 0) {
    console.log('No relevant memory found.');
  } else {
    console.log(result.text);
    console.log('\n--- Stats ---');
    console.log(`Chunks returned:    ${result.chunks.length}`);
    console.log(`Total considered:   ${result.totalConsidered}`);
    console.log(`Token count:        ${result.tokenCount}`);
    console.log(`Duration:           ${result.durationMs}ms`);
  }

  await disposeRetrieval();
  closeDb();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
