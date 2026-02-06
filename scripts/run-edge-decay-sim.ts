/**
 * CLI: Run edge decay curve simulations.
 *
 * Usage: tsx scripts/run-edge-decay-sim.ts [--output path] [--csv]
 *
 * Options:
 *   --output    Output directory for results (default: benchmark-results)
 *   --csv       Also export CSV for plotting
 *   --models    Comma-separated model IDs to compare (default: all presets)
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  PRESET_MODELS,
  getPresetModel,
  compareModels,
  generateComparisonTable,
  generateMilestonesTable,
  generateAUCTable,
  exportCurvesCSV,
  MS_PER_DAY,
  type SimulationParams,
} from '../src/eval/experiments/edge-decay/index.js';

function parseArgs(): {
  outputDir: string;
  exportCsv: boolean;
  modelIds: string[];
} {
  const args = process.argv.slice(2);
  let outputDir = 'benchmark-results';
  let exportCsv = false;
  let modelIds: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1]) {
      outputDir = args[++i];
    } else if (args[i] === '--csv') {
      exportCsv = true;
    } else if (args[i] === '--models' && args[i + 1]) {
      modelIds = args[++i].split(',');
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Edge Decay Curve Simulation

Usage: npm run edge-decay-sim [options]

Options:
  --output <path>    Output directory for results (default: benchmark-results)
  --csv              Also export CSV for plotting
  --models <ids>     Comma-separated model IDs (default: all presets)
  --help, -h         Show this help message

Available models:
${PRESET_MODELS.map((m) => `  - ${m.id}: ${m.description}`).join('\n')}
`);
      process.exit(0);
    }
  }

  // Default to all presets if none specified
  if (modelIds.length === 0) {
    modelIds = PRESET_MODELS.map((m) => m.id);
  }

  return { outputDir, exportCsv, modelIds };
}

async function main(): Promise<void> {
  const { outputDir, exportCsv, modelIds } = parseArgs();

  console.log('Edge Decay Curve Simulation\n');
  console.log(`Output directory: ${outputDir}`);
  console.log(`Models: ${modelIds.join(', ')}\n`);

  // Get model configs
  const models = modelIds
    .map((id) => getPresetModel(id))
    .filter((m): m is NonNullable<typeof m> => m !== undefined);

  if (models.length === 0) {
    console.error('No valid models found');
    process.exit(1);
  }

  // Run simulation
  const params: SimulationParams = {
    maxTimeMs: 7 * MS_PER_DAY,
    numPoints: 500,
    logScale: false,
  };

  console.log('Running simulation...\n');
  const comparison = compareModels(models, params);

  // Print results
  console.log(generateComparisonTable(comparison));
  console.log('\n');
  console.log(generateMilestonesTable(models));
  console.log('\n');
  console.log(generateAUCTable(comparison));

  // Save results
  await mkdir(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // JSON report
  const reportPath = join(outputDir, `edge-decay-sim-${timestamp}.json`);
  await writeFile(reportPath, JSON.stringify(comparison, null, 2));
  console.log(`\nJSON report: ${reportPath}`);

  // CSV export
  if (exportCsv) {
    const csvPath = join(outputDir, `edge-decay-curves-${timestamp}.csv`);
    await writeFile(csvPath, exportCurvesCSV(comparison));
    console.log(`CSV export: ${csvPath}`);
  }

  // Print ASCII visualization of first 24 hours
  console.log('\n');
  printAsciiChart(comparison);
}

/**
 * Print a simple ASCII chart of the decay curves.
 */
function printAsciiChart(comparison: ReturnType<typeof compareModels>): void {
  const width = 80;
  const height = 20;
  const maxTime = 24 * 60 * 60 * 1000; // 24 hours in ms

  console.log('='.repeat(width + 10));
  console.log('  DECAY CURVES (First 24 hours)');
  console.log('='.repeat(width + 10));

  // Find max weight for scaling
  const maxWeight = Math.max(...comparison.curves.map((c) => c.peakWeight));

  // Create grid
  const grid: string[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ' '),
  );

  // Plot each curve with different characters
  const chars = ['*', '+', 'o', '#', '@', '~', '^', '=', '-'];

  for (let curveIdx = 0; curveIdx < comparison.curves.length; curveIdx++) {
    const curve = comparison.curves[curveIdx];
    const char = chars[curveIdx % chars.length];

    for (const point of curve.points) {
      if (point.timeMs > maxTime) break;

      const x = Math.floor((point.timeMs / maxTime) * (width - 1));
      const y = height - 1 - Math.floor((point.weight / maxWeight) * (height - 1));

      if (y >= 0 && y < height && x >= 0 && x < width) {
        grid[y][x] = char;
      }
    }
  }

  // Print grid with Y axis
  for (let y = 0; y < height; y++) {
    const weightLabel = ((height - 1 - y) / (height - 1) * maxWeight).toFixed(1);
    console.log(`${weightLabel.padStart(5)} |${grid[y].join('')}|`);
  }

  // X axis
  console.log('      +' + '-'.repeat(width) + '+');
  console.log('       0h' + ' '.repeat(width - 20) + '12h' + ' '.repeat(8) + '24h');

  // Legend
  console.log('\nLegend:');
  for (let i = 0; i < comparison.curves.length; i++) {
    console.log(`  ${chars[i % chars.length]} = ${comparison.curves[i].config.name}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
