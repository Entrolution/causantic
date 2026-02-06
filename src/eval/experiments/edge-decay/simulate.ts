/**
 * Decay curve simulation and comparison.
 */

import type {
  DecayModelConfig,
  DecayCurve,
  DecayCurvePoint,
  SimulationParams,
  DecayModelComparison,
} from './types.js';
import { formatTime, MS_PER_HOUR, MS_PER_DAY, MS_PER_WEEK } from './types.js';
import { calculateWeight, calculateDeathTime, peakWeight } from './decay-curves.js';

/**
 * Default simulation parameters.
 */
export const DEFAULT_SIMULATION_PARAMS: SimulationParams = {
  maxTimeMs: 7 * MS_PER_DAY, // 1 week
  numPoints: 500,
  logScale: false,
};

/**
 * Generate time points for simulation.
 */
function generateTimePoints(params: SimulationParams): number[] {
  const { maxTimeMs, numPoints, logScale } = params;
  const points: number[] = [];

  if (logScale) {
    // Logarithmic spacing (more detail at early times)
    const logMax = Math.log10(maxTimeMs);
    const logMin = 0; // Start at 1ms
    for (let i = 0; i < numPoints; i++) {
      const logT = logMin + (i / (numPoints - 1)) * (logMax - logMin);
      points.push(Math.pow(10, logT));
    }
  } else {
    // Linear spacing
    for (let i = 0; i < numPoints; i++) {
      points.push((i / (numPoints - 1)) * maxTimeMs);
    }
  }

  return points;
}

/**
 * Simulate a single decay model.
 */
export function simulateModel(
  config: DecayModelConfig,
  params: SimulationParams = DEFAULT_SIMULATION_PARAMS,
): DecayCurve {
  const timePoints = generateTimePoints(params);
  const points: DecayCurvePoint[] = [];

  for (const timeMs of timePoints) {
    const weight = calculateWeight(config, timeMs);
    points.push({
      timeMs,
      timeHuman: formatTime(timeMs),
      weight,
      alive: weight > 0,
    });
  }

  return {
    config,
    points,
    deathTimeMs: calculateDeathTime(config),
    peakWeight: peakWeight(config),
    weightAt1Hour: calculateWeight(config, MS_PER_HOUR),
    weightAt24Hours: calculateWeight(config, 24 * MS_PER_HOUR),
    weightAt7Days: calculateWeight(config, 7 * MS_PER_DAY),
  };
}

/**
 * Compare multiple decay models.
 */
export function compareModels(
  configs: DecayModelConfig[],
  params: SimulationParams = DEFAULT_SIMULATION_PARAMS,
): DecayModelComparison {
  const curves = configs.map((config) => simulateModel(config, params));

  return {
    models: configs,
    curves,
    params,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generate a comparison table for console output.
 */
export function generateComparisonTable(comparison: DecayModelComparison): string {
  const lines: string[] = [];

  lines.push('='.repeat(100));
  lines.push('  DECAY MODEL COMPARISON');
  lines.push('='.repeat(100));

  // Header
  const header = [
    pad('Model', 25),
    pad('Peak', 8),
    pad('@ 1h', 8),
    pad('@ 24h', 8),
    pad('@ 7d', 8),
    pad('Death Time', 15),
    pad('Type', 15),
  ];
  lines.push(header.join(' | '));
  lines.push('-'.repeat(100));

  // Rows
  for (const curve of comparison.curves) {
    const deathStr = curve.deathTimeMs !== null
      ? formatTime(curve.deathTimeMs)
      : 'asymptotic';

    const row = [
      pad(curve.config.name, 25),
      pad(curve.peakWeight.toFixed(3), 8),
      pad(curve.weightAt1Hour.toFixed(3), 8),
      pad(curve.weightAt24Hours.toFixed(3), 8),
      pad(curve.weightAt7Days.toFixed(3), 8),
      pad(deathStr, 15),
      pad(curve.config.type, 15),
    ];
    lines.push(row.join(' | '));
  }

  lines.push('='.repeat(100));

  return lines.join('\n');
}

function pad(str: string, width: number): string {
  return str.padEnd(width).slice(0, width);
}

/**
 * Export curves as CSV for plotting.
 */
export function exportCurvesCSV(comparison: DecayModelComparison): string {
  const lines: string[] = [];

  // Header
  const modelNames = comparison.models.map((m) => m.name);
  lines.push(['time_ms', 'time_human', ...modelNames].join(','));

  // Use the first curve's time points as reference
  const refCurve = comparison.curves[0];
  for (let i = 0; i < refCurve.points.length; i++) {
    const timeMs = refCurve.points[i].timeMs;
    const timeHuman = refCurve.points[i].timeHuman;
    const weights = comparison.curves.map((c) => c.points[i].weight.toFixed(6));
    lines.push([timeMs.toFixed(0), timeHuman, ...weights].join(','));
  }

  return lines.join('\n');
}

/**
 * Find the time at which a model reaches a specific weight threshold.
 */
export function findTimeAtWeight(
  config: DecayModelConfig,
  targetWeight: number,
  maxSearchMs: number = 30 * MS_PER_DAY,
  tolerance: number = 0.001,
): number | null {
  // Binary search for the time
  let low = 0;
  let high = maxSearchMs;

  const peakW = calculateWeight(config, 0);
  if (targetWeight > peakW) return null;

  // Check if we ever reach the target (for asymptotic models)
  const weightAtMax = calculateWeight(config, maxSearchMs);
  if (weightAtMax > targetWeight) {
    return null; // Never reaches target within search range
  }

  while (high - low > 1) {
    const mid = (low + high) / 2;
    const weight = calculateWeight(config, mid);

    if (weight > targetWeight) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return high;
}

/**
 * Generate milestones table (time to reach various weight thresholds).
 */
export function generateMilestonesTable(configs: DecayModelConfig[]): string {
  const lines: string[] = [];
  const thresholds = [0.75, 0.5, 0.25, 0.1, 0.01, 0];

  lines.push('='.repeat(90));
  lines.push('  TIME TO REACH WEIGHT THRESHOLDS');
  lines.push('='.repeat(90));

  // Header
  const header = [
    pad('Model', 25),
    ...thresholds.map((t) => pad(`w=${t}`, 10)),
  ];
  lines.push(header.join(' | '));
  lines.push('-'.repeat(90));

  // Rows
  for (const config of configs) {
    const peak = peakWeight(config);
    const times = thresholds.map((threshold) => {
      const targetWeight = threshold * peak;
      const time = findTimeAtWeight(config, targetWeight);
      return time !== null ? formatTime(time) : 'never';
    });

    const row = [
      pad(config.name, 25),
      ...times.map((t) => pad(t, 10)),
    ];
    lines.push(row.join(' | '));
  }

  lines.push('='.repeat(90));

  return lines.join('\n');
}

/**
 * Compute area under the decay curve (integral of weight over time).
 * Uses trapezoidal rule.
 */
export function computeAUC(curve: DecayCurve): number {
  let auc = 0;
  for (let i = 1; i < curve.points.length; i++) {
    const dt = curve.points[i].timeMs - curve.points[i - 1].timeMs;
    const avgWeight = (curve.points[i].weight + curve.points[i - 1].weight) / 2;
    auc += avgWeight * dt;
  }
  return auc;
}

/**
 * Generate AUC comparison.
 */
export function generateAUCTable(comparison: DecayModelComparison): string {
  const lines: string[] = [];

  lines.push('='.repeat(60));
  lines.push('  AREA UNDER CURVE (Total "memory" over time)');
  lines.push('='.repeat(60));

  const header = [pad('Model', 30), pad('AUC', 15), pad('Relative', 15)];
  lines.push(header.join(' | '));
  lines.push('-'.repeat(60));

  const aucs = comparison.curves.map((c) => ({ name: c.config.name, auc: computeAUC(c) }));
  const maxAuc = Math.max(...aucs.map((a) => a.auc));

  for (const { name, auc } of aucs) {
    const relative = (auc / maxAuc) * 100;
    const row = [
      pad(name, 30),
      pad(formatTime(auc), 15),
      pad(`${relative.toFixed(1)}%`, 15),
    ];
    lines.push(row.join(' | '));
  }

  lines.push('='.repeat(60));

  return lines.join('\n');
}
