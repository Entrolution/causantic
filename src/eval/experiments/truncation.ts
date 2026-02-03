/**
 * Experiment 1: Same-Model Truncation Test
 *
 * Question: How much does jina-small's 8K context actually help vs 512-token truncation?
 *
 * Embeds the existing corpus with jina-small at full context (baseline, reuses cached embeddings)
 * and with chunk text hard-truncated to ~512 tokens (~1,792 chars). Compares ROC AUC,
 * silhouette, and cluster membership overlap.
 */

import type { Chunk } from '../../parser/types.js';
import type { LabeledPair } from '../annotation-schema.js';
import {
  singleModelRun,
  embedTextsAndScore,
  toSnapshot,
  type SingleModelResult,
} from './single-model-run.js';
import { computeDelta, type ExperimentResult } from './types.js';

const MODEL_ID = 'jina-small';

/** ~512 tokens at 3.5 chars/token */
const TRUNCATION_CHARS = 1792;

/**
 * Run the truncation experiment.
 *
 * If baselineResult is provided (from a prior run), reuses it to avoid
 * re-embedding the full corpus.
 */
export async function runTruncationExperiment(
  chunks: Chunk[],
  pairs: LabeledPair[],
  baselineResult?: SingleModelResult,
): Promise<ExperimentResult> {
  console.log('\n=== Experiment 1: Same-Model Truncation Test ===');

  // Baseline: full context
  let baseline: SingleModelResult;
  if (baselineResult) {
    console.log('  Reusing cached baseline embeddings');
    baseline = baselineResult;
  } else {
    console.log('  Running baseline (full context)...');
    baseline = await singleModelRun(MODEL_ID, chunks, pairs);
  }

  // Variant: truncated to ~512 tokens
  console.log('  Running variant (truncated to ~512 tokens)...');
  const truncatedTexts = chunks.map((c) => ({
    id: c.id,
    text: c.text.slice(0, TRUNCATION_CHARS),
  }));

  const variant = await embedTextsAndScore(MODEL_ID, truncatedTexts, pairs);

  // Count how many chunks were actually truncated
  const truncatedCount = chunks.filter((c) => c.text.length > TRUNCATION_CHARS).length;
  console.log(
    `  ${truncatedCount}/${chunks.length} chunks were truncated ` +
    `(${((truncatedCount / chunks.length) * 100).toFixed(1)}%)`,
  );

  const baselineSnap = toSnapshot(baseline, chunks.length);
  const variantSnap = toSnapshot(variant, chunks.length);
  const delta = computeDelta(baselineSnap, variantSnap);

  console.log(`  Baseline ROC AUC: ${baselineSnap.rocAuc.toFixed(3)}`);
  console.log(`  Truncated ROC AUC: ${variantSnap.rocAuc.toFixed(3)} (delta: ${delta.rocAuc >= 0 ? '+' : ''}${delta.rocAuc.toFixed(3)})`);
  console.log(`  Baseline Silhouette: ${baselineSnap.silhouetteScore.toFixed(3)}`);
  console.log(`  Truncated Silhouette: ${variantSnap.silhouetteScore.toFixed(3)} (delta: ${delta.silhouetteScore >= 0 ? '+' : ''}${delta.silhouetteScore.toFixed(3)})`);

  return {
    name: 'truncation',
    description: `jina-small full context vs ${TRUNCATION_CHARS}-char (~512 token) truncation. ${truncatedCount}/${chunks.length} chunks affected.`,
    baseline: baselineSnap,
    variant: variantSnap,
    delta,
  };
}
