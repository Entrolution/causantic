/**
 * Hop-based decay shape experiments.
 *
 * Tests different decay curve shapes using hop count (D-T-D cycles)
 * for both backward (retrieval) and forward (prediction) traversal.
 */

export * from './types.js';
export * from './hop-decay.js';
export * from './presets.js';
export { runHopDecayShapeExperiment, formatResults } from './run-experiment.js';
