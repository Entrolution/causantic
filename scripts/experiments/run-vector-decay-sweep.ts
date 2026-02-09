/**
 * Run vector decay parameter sweep experiment.
 * Usage: npm run vector-decay-sweep
 */

import { runVectorDecaySweep, formatSweepResults } from '../src/eval/experiments/vector-decay-sweep/index.js';
import { closeDb } from '../src/storage/db.js';
import { writeFileSync } from 'fs';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  let outputFile: string | undefined;
  let maxQueries = Infinity;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1]) {
      outputFile = args[i + 1];
      i++;
    } else if (args[i] === '--max-queries' && args[i + 1]) {
      maxQueries = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--help') {
      console.log(`
Usage: npm run vector-decay-sweep -- [options]

Options:
  --output <path>      Write JSON results to file
  --max-queries <n>    Limit number of queries evaluated
  --help               Show this help message

Example:
  npm run vector-decay-sweep
  npm run vector-decay-sweep -- --output results/vector-sweep.json
      `);
      process.exit(0);
    }
  }

  try {
    const results = await runVectorDecaySweep({
      verbose: true,
      maxQueries,
    });

    // Write to file if requested
    if (outputFile) {
      writeFileSync(outputFile, JSON.stringify(results, null, 2));
      console.log(`\nResults written to: ${outputFile}`);
    }

    // Summary
    console.log('\n=== Summary ===');
    console.log(`Best weightPerHop: ${results.results.find(r => r.variantId === results.bestVariantId)?.weightPerHop}`);

  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  } finally {
    closeDb();
  }
}

main();
