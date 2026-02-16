/**
 * CLI: Run follow-up experiments on jina-small.
 *
 * Usage: tsx scripts/run-experiments.ts [--corpus path] [--experiments 1,2,3,4,5]
 *
 * Experiments:
 *   1. Truncation test (full context vs 512 tokens)
 *   2. HDBSCAN minClusterSize sweep (2-10)
 *   3. Boilerplate filtering
 *   4. Thinking block ablation (requires session files)
 *   5. Code-focused render mode (requires session files)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Corpus } from '../src/eval/corpus-builder.js';
import type { AnnotationSet } from '../src/eval/annotation-schema.js';
import {
  singleModelRun,
  type SingleModelResult,
} from '../src/eval/experiments/single-model-run.js';
import { runTruncationExperiment } from '../src/eval/experiments/truncation.js';
import { runHdbscanSweep } from '../src/eval/experiments/hdbscan-sweep.js';
import { runBoilerplateExperiment } from '../src/eval/experiments/boilerplate-filter.js';
import { runThinkingAblation } from '../src/eval/experiments/thinking-ablation.js';
import { runCodeFocusedExperiment } from '../src/eval/experiments/code-focused-mode.js';
import type { ExperimentResult, SweepResult } from '../src/eval/experiments/types.js';

const MODEL_ID = 'jina-small';
const ALL_EXPERIMENTS = [1, 2, 3, 4, 5];

function parseArgs(): {
  corpusDir: string;
  experiments: number[];
  outputDir: string;
} {
  const args = process.argv.slice(2);
  let corpusDir = 'test/fixtures/corpus';
  let experiments = ALL_EXPERIMENTS;
  let outputDir = 'benchmark-results';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--corpus' && args[i + 1]) {
      corpusDir = args[++i];
    } else if (args[i] === '--experiments' && args[i + 1]) {
      experiments = args[++i].split(',').map(Number);
    } else if (args[i] === '--output' && args[i + 1]) {
      outputDir = args[++i];
    }
  }

  return { corpusDir, experiments, outputDir };
}

function printSummaryTable(results: ExperimentResult[]): void {
  if (results.length === 0) return;

  console.log('\n' + '='.repeat(90));
  console.log('  EXPERIMENT COMPARISON SUMMARY');
  console.log('='.repeat(90));

  const header = [
    pad('Experiment', 22),
    pad('Base AUC', 10),
    pad('Var AUC', 10),
    pad('dAUC', 8),
    pad('Base Silh', 10),
    pad('Var Silh', 10),
    pad('dSilh', 8),
  ];
  console.log(header.join(' | '));
  console.log('-'.repeat(90));

  for (const r of results) {
    const row = [
      pad(r.name, 22),
      pad(r.baseline.rocAuc.toFixed(3), 10),
      pad(r.variant.rocAuc.toFixed(3), 10),
      pad(formatDelta(r.delta.rocAuc), 8),
      pad(r.baseline.silhouetteScore.toFixed(3), 10),
      pad(r.variant.silhouetteScore.toFixed(3), 10),
      pad(formatDelta(r.delta.silhouetteScore), 8),
    ];
    console.log(row.join(' | '));
  }

  console.log('='.repeat(90));
}

function formatDelta(d: number): string {
  const sign = d >= 0 ? '+' : '';
  return `${sign}${d.toFixed(3)}`;
}

function pad(str: string, width: number): string {
  return str.padEnd(width).slice(0, width);
}

async function main(): Promise<void> {
  const { corpusDir, experiments, outputDir } = parseArgs();

  console.log('Loading corpus...');
  const corpusJson = await readFile(join(corpusDir, 'corpus.json'), 'utf-8');
  const corpus: Corpus = JSON.parse(corpusJson);

  const pairsJson = await readFile(join(corpusDir, 'labeled-pairs.json'), 'utf-8');
  const annotations: AnnotationSet = JSON.parse(pairsJson);

  console.log(`Corpus: ${corpus.chunks.length} chunks, ${annotations.pairs.length} pairs`);
  console.log(`Experiments to run: ${experiments.join(', ')}\n`);

  // Experiments 1-3 share baseline embeddings — compute once
  const needsBaseline = experiments.some((e) => [1, 2, 3].includes(e));
  let baselineResult: SingleModelResult | undefined;

  if (needsBaseline) {
    console.log('--- Computing baseline jina-small embeddings ---');
    baselineResult = await singleModelRun(MODEL_ID, corpus.chunks, annotations.pairs);
    console.log(
      `  Baseline: ROC AUC=${baselineResult.rocAuc.toFixed(3)}, ` +
        `Silhouette=${baselineResult.silhouetteScore.toFixed(3)}, ` +
        `Clusters=${baselineResult.clusterCount}`,
    );
  }

  const experimentResults: ExperimentResult[] = [];
  let sweepResult: SweepResult | undefined;

  // Experiment 1: Truncation
  if (experiments.includes(1)) {
    const result = await runTruncationExperiment(corpus.chunks, annotations.pairs, baselineResult);
    experimentResults.push(result);
  }

  // Experiment 2: HDBSCAN sweep (different return type)
  if (experiments.includes(2)) {
    sweepResult = await runHdbscanSweep(corpus.chunks, annotations.pairs, baselineResult);
  }

  // Experiment 3: Boilerplate filter
  if (experiments.includes(3)) {
    const result = await runBoilerplateExperiment(corpus.chunks, annotations.pairs, baselineResult);
    experimentResults.push(result);
  }

  // Experiments 4 and 5 need session files to rebuild corpus.
  // They also share the baseline if we computed it, but need to re-embed anyway.
  const needsRebuild = experiments.some((e) => [4, 5].includes(e));

  if (needsRebuild && corpus.config.sessionPaths.length === 0) {
    console.warn('\nWARNING: Experiments 4 and 5 require session file paths in the corpus config.');
    console.warn('The loaded corpus may not have accessible sessionPaths. Attempting anyway...\n');
  }

  // For experiments 4 and 5, compute a fresh baseline from the original corpus
  // so the comparison is fair (same model load, same pair generation approach).
  let rechunkBaseline: SingleModelResult | undefined;
  if (needsRebuild) {
    rechunkBaseline = baselineResult;
    if (!rechunkBaseline) {
      console.log('--- Computing baseline for re-chunk experiments ---');
      rechunkBaseline = await singleModelRun(MODEL_ID, corpus.chunks, annotations.pairs);
    }
  }

  // Experiment 4: Thinking ablation
  if (experiments.includes(4)) {
    const result = await runThinkingAblation(corpus, annotations.pairs, rechunkBaseline);
    experimentResults.push(result);
  }

  // Experiment 5: Code-focused mode
  if (experiments.includes(5)) {
    const result = await runCodeFocusedExperiment(corpus, annotations.pairs, rechunkBaseline);
    experimentResults.push(result);
  }

  // Print summary table
  printSummaryTable(experimentResults);

  // Write JSON report
  await mkdir(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = join(outputDir, `experiments-${timestamp}.json`);

  const report = {
    experiments: experimentResults,
    sweep: sweepResult ?? null,
    corpus: {
      chunkCount: corpus.chunks.length,
      pairCount: annotations.pairs.length,
    },
    completedAt: new Date().toISOString(),
  };

  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
