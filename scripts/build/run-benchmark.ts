/**
 * CLI: Run full embedding model benchmark.
 *
 * Usage: tsx scripts/run-benchmark.ts [--corpus test/fixtures/corpus] [--models nomic-v1.5,bge-small]
 */

import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runBenchmark } from '../src/eval/benchmark-runner.js';
import { printComparisonTable, printClusterMembership, writeJsonReport } from '../src/report/reporter.js';
import type { Corpus } from '../src/eval/corpus-builder.js';
import type { AnnotationSet } from '../src/eval/annotation-schema.js';
import { getAllModelIds } from '../src/models/model-registry.js';

function parseArgs(): { corpusDir: string; modelIds: string[]; outputDir: string } {
  const args = process.argv.slice(2);
  let corpusDir = 'test/fixtures/corpus';
  let modelIds = getAllModelIds();
  let outputDir = 'benchmark-results';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--corpus' && args[i + 1]) {
      corpusDir = args[++i];
    } else if (args[i] === '--models' && args[i + 1]) {
      modelIds = args[++i].split(',');
    } else if (args[i] === '--output' && args[i + 1]) {
      outputDir = args[++i];
    }
  }

  return { corpusDir, modelIds, outputDir };
}

async function main(): Promise<void> {
  const { corpusDir, modelIds, outputDir } = parseArgs();

  console.log('Loading corpus...');
  const corpusJson = await readFile(join(corpusDir, 'corpus.json'), 'utf-8');
  const corpus: Corpus = JSON.parse(corpusJson);

  const pairsJson = await readFile(join(corpusDir, 'labeled-pairs.json'), 'utf-8');
  const annotations: AnnotationSet = JSON.parse(pairsJson);

  console.log(
    `Corpus: ${corpus.chunks.length} chunks, ${annotations.pairs.length} pairs`,
  );
  console.log(`Models: ${modelIds.join(', ')}\n`);

  // Run benchmark
  const result = await runBenchmark(corpus.chunks, annotations.pairs, {
    modelIds,
    minClusterSize: 3,
  });

  // Print results
  printComparisonTable(result);

  // Print cluster membership for each model
  for (const modelResult of result.models) {
    printClusterMembership(modelResult, corpus.chunks);
  }

  // Write JSON report
  await mkdir(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeJsonReport(
    result,
    join(outputDir, `benchmark-${timestamp}.json`),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
