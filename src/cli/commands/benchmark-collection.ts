/**
 * CLI command: causantic benchmark-collection
 *
 * Runs the collection benchmark suite and produces reports.
 */

import type { Command } from '../types.js';
import type { BenchmarkCategory, BenchmarkProfile } from '../../eval/collection-benchmark/types.js';

export const benchmarkCollectionCommand: Command = {
  name: 'benchmark-collection',
  description: 'Benchmark your memory collection',
  usage: `causantic benchmark-collection [options]

Options:
  --quick               Health only (~1 second)
  --standard            Health + retrieval (~30 seconds) [default]
  --full                All categories (~2-5 minutes)
  --categories <list>   Comma-separated: health,retrieval,graph,latency
  --sample-size <n>     Number of sample queries (default: 50)
  --seed <n>            Random seed for reproducibility
  --project <slug>      Limit to one project
  --output <path>       Output directory (default: ./causantic-benchmark/)
  --json                Output JSON only (no markdown)
  --no-tuning           Skip tuning recommendations
  --history             Show trend from past runs`,
  handler: async (args) => {
    // Parse arguments
    let profile: BenchmarkProfile = 'standard';
    let categories: BenchmarkCategory[] | undefined;
    let sampleSize = 50;
    let seed: number | undefined;
    let projectFilter: string | undefined;
    let outputDir = './causantic-benchmark';
    let jsonOnly = false;
    let includeTuning = true;
    let showHistory = false;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      switch (arg) {
        case '--quick':
          profile = 'quick';
          break;
        case '--standard':
          profile = 'standard';
          break;
        case '--full':
          profile = 'full';
          break;
        case '--categories':
          categories = (args[++i] ?? '').split(',') as BenchmarkCategory[];
          break;
        case '--sample-size':
          sampleSize = parseInt(args[++i], 10) || 50;
          break;
        case '--seed':
          seed = parseInt(args[++i], 10);
          break;
        case '--project':
          projectFilter = args[++i];
          break;
        case '--output':
          outputDir = args[++i] ?? outputDir;
          break;
        case '--json':
          jsonOnly = true;
          break;
        case '--no-tuning':
          includeTuning = false;
          break;
        case '--history':
          showHistory = true;
          break;
        case '--help':
        case '-h':
          console.log(benchmarkCollectionCommand.usage);
          return;
      }
    }

    // Ensure database is initialized
    const { getDb } = await import('../../storage/db.js');
    getDb();

    // Show history mode
    if (showHistory) {
      const { getBenchmarkHistory } = await import('../../eval/collection-benchmark/history.js');
      const history = getBenchmarkHistory(20);
      if (history.length === 0) {
        console.log('No benchmark history found. Run a benchmark first.');
        return;
      }
      console.log('Benchmark History:');
      console.log('');
      console.log('| # | Date | Profile | Score |');
      console.log('|---|------|---------|-------|');
      for (const run of history) {
        const date = new Date(run.timestamp).toLocaleDateString();
        console.log(`| ${run.id} | ${date} | ${run.profile} | ${run.overallScore}/100 |`);
      }
      return;
    }

    console.log(`Causantic Collection Benchmark (${profile} profile)`);
    console.log('');

    const { runCollectionBenchmark } = await import('../../eval/collection-benchmark/runner.js');

    const startTime = Date.now();

    const result = await runCollectionBenchmark({
      profile,
      categories,
      sampleSize,
      seed,
      projectFilter,
      includeTuning,
      onProgress: (msg) => {
        process.stdout.write(`\r  ${msg}`);
      },
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n\nCompleted in ${elapsed}s`);
    console.log(`\nOverall Score: ${result.overallScore}/100`);
    console.log('');

    // Print highlights
    if (result.highlights.length > 0) {
      for (const h of result.highlights) {
        console.log(`  - ${h}`);
      }
      console.log('');
    }

    // Write reports
    if (jsonOnly) {
      const { writeFile } = await import('node:fs/promises');
      const { mkdir } = await import('node:fs/promises');
      const { join } = await import('node:path');
      await mkdir(outputDir, { recursive: true });
      const jsonPath = join(outputDir, 'report.json');
      await writeFile(jsonPath, JSON.stringify(result, null, 2));
      console.log(`Report written to: ${jsonPath}`);
    } else {
      const { writeReports } = await import('../../eval/collection-benchmark/reporter.js');
      const { markdownPath, jsonPath } = await writeReports(result, outputDir);
      console.log('Report written to:');
      console.log(`  ${markdownPath}`);
      console.log(`  ${jsonPath}`);
    }

    // Suggest next steps
    if (profile !== 'full') {
      console.log(
        `\nRun with --full for ${profile === 'quick' ? 'retrieval, graph value, and latency' : 'graph value and latency'} benchmarks.`,
      );
    }
  },
};
