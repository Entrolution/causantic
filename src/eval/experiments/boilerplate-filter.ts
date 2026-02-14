/**
 * Experiment 3: Boilerplate Filtering
 *
 * Question: Does stripping "This session is being continued..." boilerplate
 * improve embedding discrimination?
 *
 * Defines a boilerplate filter that strips known prefixes from chunk text
 * before embedding, then compares ROC AUC and cluster membership vs unfiltered.
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

/**
 * Known boilerplate patterns found in Claude Code session continuations.
 * These are matched at line boundaries within the chunk text.
 */
const BOILERPLATE_PATTERNS = [
  /This session is being continued from a previous conversation[^\n]*/g,
  /If you need specific details from before compaction[^\n]*/g,
  /Please continue the conversation from where we left it off[^\n]*/g,
  /Here is a summary of the conversation so far[^\n]*/g,
  /The conversation has been compacted[^\n]*/g,
];

/**
 * Strip known boilerplate text from a chunk.
 * Returns the filtered text and whether any boilerplate was found.
 */
export function stripBoilerplate(text: string): { text: string; stripped: boolean } {
  let filtered = text;
  let stripped = false;

  for (const pattern of BOILERPLATE_PATTERNS) {
    const before = filtered;
    filtered = filtered.replace(pattern, '');
    if (filtered !== before) stripped = true;
  }

  // Clean up resulting empty lines
  filtered = filtered.replace(/\n{3,}/g, '\n\n').trim();

  return { text: filtered, stripped };
}

/**
 * Run the boilerplate filtering experiment.
 */
export async function runBoilerplateExperiment(
  chunks: Chunk[],
  pairs: LabeledPair[],
  baselineResult?: SingleModelResult,
): Promise<ExperimentResult> {
  console.log('\n=== Experiment 3: Boilerplate Filtering ===');

  // Baseline: unfiltered
  let baseline: SingleModelResult;
  if (baselineResult) {
    console.log('  Reusing cached baseline embeddings');
    baseline = baselineResult;
  } else {
    console.log('  Running baseline (unfiltered)...');
    baseline = await singleModelRun(MODEL_ID, chunks, pairs);
  }

  // Filter boilerplate from chunk texts
  let affectedCount = 0;
  const filteredTexts = chunks.map((c) => {
    const { text, stripped } = stripBoilerplate(c.text);
    if (stripped) affectedCount++;
    return { id: c.id, text };
  });

  console.log(
    `  ${affectedCount}/${chunks.length} chunks contained boilerplate ` +
      `(${((affectedCount / chunks.length) * 100).toFixed(1)}%)`,
  );

  if (affectedCount === 0) {
    console.log('  No boilerplate found — variant identical to baseline');
    const snap = toSnapshot(baseline, chunks.length);
    return {
      name: 'boilerplate-filter',
      description: 'No boilerplate found in corpus. Variant identical to baseline.',
      baseline: snap,
      variant: snap,
      delta: computeDelta(snap, snap),
    };
  }

  // Variant: filtered text
  console.log('  Running variant (filtered)...');
  const variant = await embedTextsAndScore(MODEL_ID, filteredTexts, pairs);

  const baselineSnap = toSnapshot(baseline, chunks.length);
  const variantSnap = toSnapshot(variant, chunks.length);
  const delta = computeDelta(baselineSnap, variantSnap);

  console.log(`  Baseline ROC AUC: ${baselineSnap.rocAuc.toFixed(3)}`);
  console.log(
    `  Filtered ROC AUC: ${variantSnap.rocAuc.toFixed(3)} (delta: ${delta.rocAuc >= 0 ? '+' : ''}${delta.rocAuc.toFixed(3)})`,
  );
  console.log(`  Baseline Silhouette: ${baselineSnap.silhouetteScore.toFixed(3)}`);
  console.log(
    `  Filtered Silhouette: ${variantSnap.silhouetteScore.toFixed(3)} (delta: ${delta.silhouetteScore >= 0 ? '+' : ''}${delta.silhouetteScore.toFixed(3)})`,
  );

  return {
    name: 'boilerplate-filter',
    description: `Stripped boilerplate from ${affectedCount}/${chunks.length} chunks before embedding.`,
    baseline: baselineSnap,
    variant: variantSnap,
    delta,
  };
}
