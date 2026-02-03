/**
 * Experiment 4: Thinking Block Ablation
 *
 * Question: Do thinking blocks help or hurt embedding quality?
 *
 * Re-chunks the corpus with includeThinking:false (default is true),
 * re-embeds with jina-small, and compares ROC AUC and silhouette
 * against the default (thinking included).
 */

import type { Chunk } from '../../parser/types.js';
import type { LabeledPair } from '../annotation-schema.js';
import type { Corpus } from '../corpus-builder.js';
import { buildCorpus } from '../corpus-builder.js';
import { generateLabeledPairs } from '../annotation-schema.js';
import {
  singleModelRun,
  toSnapshot,
  type SingleModelResult,
} from './single-model-run.js';
import { computeDelta, type ExperimentResult } from './types.js';

const MODEL_ID = 'jina-small';

/**
 * Run the thinking ablation experiment.
 *
 * Requires the original corpus config to rebuild with different settings.
 * The original corpus should have been built with includeThinking:true.
 */
export async function runThinkingAblation(
  originalCorpus: Corpus,
  originalPairs: LabeledPair[],
  baselineResult?: SingleModelResult,
): Promise<ExperimentResult> {
  console.log('\n=== Experiment 4: Thinking Block Ablation ===');

  // Baseline: thinking included (original corpus)
  let baseline: SingleModelResult;
  if (baselineResult) {
    console.log('  Reusing cached baseline embeddings');
    baseline = baselineResult;
  } else {
    console.log('  Running baseline (thinking included)...');
    baseline = await singleModelRun(MODEL_ID, originalCorpus.chunks, originalPairs);
  }

  // Variant: rebuild corpus without thinking blocks
  console.log('  Rebuilding corpus with includeThinking=false...');
  const variantCorpus = await buildCorpus({
    ...originalCorpus.config,
    includeThinking: false,
  });

  console.log(
    `  Variant corpus: ${variantCorpus.chunks.length} chunks ` +
    `(original: ${originalCorpus.chunks.length})`,
  );

  // Generate new labeled pairs for the variant corpus
  // (chunk IDs will differ, so we need fresh pairs)
  const variantAnnotations = generateLabeledPairs(variantCorpus.chunks, {
    adjacentPairs: 60,
    crossSessionPairs: 40,
    crossProjectPairs: 80,
    codeNLPairs: 20,
  });

  console.log(`  Variant pairs: ${variantAnnotations.pairs.length}`);

  // Embed and score variant
  console.log('  Running variant (no thinking)...');
  const variant = await singleModelRun(MODEL_ID, variantCorpus.chunks, variantAnnotations.pairs);

  const baselineSnap = toSnapshot(baseline, originalCorpus.chunks.length);
  const variantSnap = toSnapshot(variant, variantCorpus.chunks.length);
  const delta = computeDelta(baselineSnap, variantSnap);

  console.log(`  Baseline ROC AUC: ${baselineSnap.rocAuc.toFixed(3)} (${baselineSnap.chunkCount} chunks)`);
  console.log(`  No-thinking ROC AUC: ${variantSnap.rocAuc.toFixed(3)} (${variantSnap.chunkCount} chunks) (delta: ${delta.rocAuc >= 0 ? '+' : ''}${delta.rocAuc.toFixed(3)})`);
  console.log(`  Baseline Silhouette: ${baselineSnap.silhouetteScore.toFixed(3)}`);
  console.log(`  No-thinking Silhouette: ${variantSnap.silhouetteScore.toFixed(3)} (delta: ${delta.silhouetteScore >= 0 ? '+' : ''}${delta.silhouetteScore.toFixed(3)})`);

  return {
    name: 'thinking-ablation',
    description: `Rebuilt corpus with includeThinking=false. Baseline: ${originalCorpus.chunks.length} chunks, variant: ${variantCorpus.chunks.length} chunks.`,
    baseline: baselineSnap,
    variant: variantSnap,
    delta,
  };
}
