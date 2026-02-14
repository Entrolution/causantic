/**
 * Experiment 5: Code-Focused Render Mode
 *
 * Question: Does stripping NL commentary and keeping only code-related content help?
 *
 * Re-chunks with renderMode:'code-focused' (existing chunker support —
 * skips non-code tool results), re-embeds with jina-small,
 * and compares ROC AUC and silhouette.
 */

import type { LabeledPair } from '../annotation-schema.js';
import type { Corpus } from '../corpus-builder.js';
import { buildCorpus } from '../corpus-builder.js';
import { generateLabeledPairs } from '../annotation-schema.js';
import { singleModelRun, toSnapshot, type SingleModelResult } from './single-model-run.js';
import { computeDelta, type ExperimentResult } from './types.js';

const MODEL_ID = 'jina-small';

/**
 * Run the code-focused render mode experiment.
 *
 * Requires the original corpus config to rebuild with different settings.
 */
export async function runCodeFocusedExperiment(
  originalCorpus: Corpus,
  originalPairs: LabeledPair[],
  baselineResult?: SingleModelResult,
): Promise<ExperimentResult> {
  console.log('\n=== Experiment 5: Code-Focused Render Mode ===');

  // Baseline: full render mode (original corpus)
  let baseline: SingleModelResult;
  if (baselineResult) {
    console.log('  Reusing cached baseline embeddings');
    baseline = baselineResult;
  } else {
    console.log('  Running baseline (full render mode)...');
    baseline = await singleModelRun(MODEL_ID, originalCorpus.chunks, originalPairs);
  }

  // Variant: rebuild corpus with code-focused render mode
  console.log('  Rebuilding corpus with renderMode=code-focused...');
  const variantCorpus = await buildCorpus({
    ...originalCorpus.config,
    renderMode: 'code-focused',
  });

  console.log(
    `  Variant corpus: ${variantCorpus.chunks.length} chunks ` +
      `(original: ${originalCorpus.chunks.length})`,
  );

  // Generate new labeled pairs for the variant corpus
  const variantAnnotations = generateLabeledPairs(variantCorpus.chunks, {
    adjacentPairs: 60,
    crossSessionPairs: 40,
    crossProjectPairs: 80,
    codeNLPairs: 20,
  });

  console.log(`  Variant pairs: ${variantAnnotations.pairs.length}`);

  // Embed and score variant
  console.log('  Running variant (code-focused)...');
  const variant = await singleModelRun(MODEL_ID, variantCorpus.chunks, variantAnnotations.pairs);

  const baselineSnap = toSnapshot(baseline, originalCorpus.chunks.length);
  const variantSnap = toSnapshot(variant, variantCorpus.chunks.length);
  const delta = computeDelta(baselineSnap, variantSnap);

  console.log(
    `  Baseline ROC AUC: ${baselineSnap.rocAuc.toFixed(3)} (${baselineSnap.chunkCount} chunks)`,
  );
  console.log(
    `  Code-focused ROC AUC: ${variantSnap.rocAuc.toFixed(3)} (${variantSnap.chunkCount} chunks) (delta: ${delta.rocAuc >= 0 ? '+' : ''}${delta.rocAuc.toFixed(3)})`,
  );
  console.log(`  Baseline Silhouette: ${baselineSnap.silhouetteScore.toFixed(3)}`);
  console.log(
    `  Code-focused Silhouette: ${variantSnap.silhouetteScore.toFixed(3)} (delta: ${delta.silhouetteScore >= 0 ? '+' : ''}${delta.silhouetteScore.toFixed(3)})`,
  );

  return {
    name: 'code-focused-mode',
    description: `Rebuilt corpus with renderMode=code-focused. Baseline: ${originalCorpus.chunks.length} chunks, variant: ${variantCorpus.chunks.length} chunks.`,
    baseline: baselineSnap,
    variant: variantSnap,
    delta,
  };
}
