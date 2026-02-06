/**
 * Embedding-based classifier for topic continuity.
 *
 * Uses angular distance between user text embedding and previous
 * assistant output embedding to predict topic continuation.
 */

import { Embedder } from '../../../models/embedder.js';
import { getModel } from '../../../models/model-registry.js';
import { angularDistance } from '../../../utils/angular-distance.js';
import type { TurnTransition, ClassificationResult, TransitionFeatures } from './types.js';
import { extractLexicalFeatures } from './lexical-features.js';

/**
 * Result of embedding a single transition.
 */
export interface EmbeddedTransition {
  transition: TurnTransition;
  userEmbedding: number[];
  assistantEmbedding: number[];
  embeddingDistanceMin: number;
  embeddingDistanceMean: number;
}

/**
 * Embed all transitions using a specified model.
 */
export async function embedTransitions(
  modelId: string,
  transitions: TurnTransition[],
): Promise<EmbeddedTransition[]> {
  const config = getModel(modelId);
  const embedder = new Embedder();

  try {
    console.log(`  Loading ${modelId}...`);
    await embedder.load(config);

    const results: EmbeddedTransition[] = [];

    for (let i = 0; i < transitions.length; i++) {
      const t = transitions[i];

      // Skip transitions without previous assistant text
      if (!t.prevAssistantText.trim()) {
        continue;
      }

      // Embed user text (as query since it's seeking information)
      const userResult = await embedder.embed(t.nextUserText, true);

      // Embed assistant text (as document since it's providing information)
      const assistantResult = await embedder.embed(t.prevAssistantText, false);

      // For now, we treat the entire assistant text as one chunk
      // In a more sophisticated version, we could chunk it and compute min/mean
      const distance = angularDistance(userResult.embedding, assistantResult.embedding);

      results.push({
        transition: t,
        userEmbedding: userResult.embedding,
        assistantEmbedding: assistantResult.embedding,
        embeddingDistanceMin: distance,
        embeddingDistanceMean: distance,
      });

      if ((i + 1) % 50 === 0 || i === transitions.length - 1) {
        console.log(`    ${i + 1}/${transitions.length} transitions embedded`);
      }
    }

    return results;
  } finally {
    await embedder.dispose();
  }
}

/**
 * Compute continuation score from embedding distance.
 * Lower distance = more similar = more likely continuation.
 * Returns score in [0, 1] where 1 = continuation.
 */
export function embeddingDistanceToScore(distance: number): number {
  // Angular distance is in [0, 1], with 0 = identical
  // Invert so higher score = more likely continuation
  return 1 - distance;
}

/**
 * Classify transitions using only embedding distance.
 */
export function classifyWithEmbeddings(
  embeddedTransitions: EmbeddedTransition[],
): ClassificationResult[] {
  return embeddedTransitions.map((et) => {
    const lexicalFeatures = extractLexicalFeatures(
      et.transition.prevAssistantText,
      et.transition.nextUserText,
      et.transition.timeGapMs,
    );

    const features: TransitionFeatures = {
      ...lexicalFeatures,
      embeddingDistanceMin: et.embeddingDistanceMin,
      embeddingDistanceMean: et.embeddingDistanceMean,
    };

    return {
      transitionId: et.transition.id,
      groundTruth: et.transition.label,
      continuationScore: embeddingDistanceToScore(et.embeddingDistanceMin),
      features,
    };
  });
}

/**
 * Get just the embedding distances for a model without full classification.
 * Useful for feature ablation where we want to test embedding contribution.
 */
export async function getEmbeddingDistances(
  modelId: string,
  transitions: TurnTransition[],
): Promise<Map<string, { min: number; mean: number }>> {
  const embedded = await embedTransitions(modelId, transitions);
  const distances = new Map<string, { min: number; mean: number }>();

  for (const et of embedded) {
    distances.set(et.transition.id, {
      min: et.embeddingDistanceMin,
      mean: et.embeddingDistanceMean,
    });
  }

  return distances;
}

/**
 * Pre-computed embeddings cache for reuse across experiments.
 */
export interface EmbeddingCache {
  modelId: string;
  transitions: Map<string, EmbeddedTransition>;
}

/**
 * Create an embedding cache from embedded transitions.
 */
export function createEmbeddingCache(
  modelId: string,
  embeddedTransitions: EmbeddedTransition[],
): EmbeddingCache {
  const transitions = new Map<string, EmbeddedTransition>();
  for (const et of embeddedTransitions) {
    transitions.set(et.transition.id, et);
  }
  return { modelId, transitions };
}

/**
 * Classify from cache without re-embedding.
 */
export function classifyFromCache(cache: EmbeddingCache): ClassificationResult[] {
  const results: ClassificationResult[] = [];

  for (const et of cache.transitions.values()) {
    const lexicalFeatures = extractLexicalFeatures(
      et.transition.prevAssistantText,
      et.transition.nextUserText,
      et.transition.timeGapMs,
    );

    const features: TransitionFeatures = {
      ...lexicalFeatures,
      embeddingDistanceMin: et.embeddingDistanceMin,
      embeddingDistanceMean: et.embeddingDistanceMean,
    };

    results.push({
      transitionId: et.transition.id,
      groundTruth: et.transition.label,
      continuationScore: embeddingDistanceToScore(et.embeddingDistanceMin),
      features,
    });
  }

  return results;
}
