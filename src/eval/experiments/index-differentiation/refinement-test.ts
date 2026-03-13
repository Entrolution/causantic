/**
 * Phase 3: Cluster-aware refinement simulation.
 *
 * For clusters with worst discrimination scores, regenerate index entries
 * with a prompt that includes the other entries in the cluster as context.
 * The LLM is asked to emphasize what makes THIS chunk uniquely different.
 *
 * Compare discrimination metrics before and after refinement.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createSecretStore } from '../../../utils/secret-store.js';
import { Embedder } from '../../../models/embedder.js';
import { getModel } from '../../../models/model-registry.js';
import { getConfig } from '../../../config/memory-config.js';
import type { IndexEntry } from '../../../storage/types.js';
import type { ClusterForAnalysis } from './similarity-analysis.js';
import { testClusterDiscrimination } from './discrimination-test.js';
import { analyseCluster } from './similarity-analysis.js';
import { cosineSimilarity } from '../../../utils/angular-distance.js';
import type { RefinementResult } from './types.js';

/** Max entries to refine per cluster (limits API cost for large clusters). */
const MAX_ENTRIES_PER_CLUSTER = 50;

/**
 * Build a refinement prompt that includes cluster context.
 *
 * The key difference from standard generation: the LLM sees the OTHER
 * entries in the cluster and is instructed to emphasize what makes
 * this chunk uniquely different from them.
 */
function buildRefinementPrompt(
  chunkContent: string,
  siblingDescriptions: string[],
  targetTokens: number,
): string {
  const maxContentChars = 500 * 4; // ~500 tokens
  const truncatedContent =
    chunkContent.length > maxContentChars
      ? chunkContent.slice(0, maxContentChars) + '\n...[truncated]'
      : chunkContent;

  const siblingList = siblingDescriptions.map((d, i) => `  ${i + 1}. ${d}`).join('\n');

  return `You are refining a search index description for a memory system. The goal is to make this description MAXIMALLY DISTINGUISHABLE from similar entries in the same topic cluster.

## Other entries in this cluster:
${siblingList}

## This chunk's content:
${truncatedContent}

Write a concise description (~${targetTokens} tokens) that:
- Captures what is UNIQUE about this chunk compared to the cluster siblings above
- Focuses on specific decisions, file names, error messages, or outcomes that differentiate it
- Avoids generic terms that would match all entries in this cluster
- Does NOT include dates, project names, or agent IDs (metadata stored separately)

If someone searched for the specific topic of this chunk, your description should match THIS chunk and not the siblings.

Description:`;
}

/**
 * Get Anthropic client, returning null if unavailable.
 */
async function getClient(): Promise<Anthropic | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    try {
      const store = createSecretStore();
      const storedKey = await store.get('anthropic-api-key');
      if (storedKey) {
        process.env.ANTHROPIC_API_KEY = storedKey;
      }
    } catch {
      // Keychain not available
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic();
}

/**
 * Run refinement experiment on a single cluster.
 *
 * For each entry in the cluster:
 * 1. Collect sibling descriptions (all other entries)
 * 2. Re-generate this entry's description with cluster-aware prompt
 * 3. Embed the refined description
 * 4. Compare discrimination metrics
 */
export async function testClusterRefinement(
  cluster: ClusterForAnalysis,
  entries: IndexEntry[],
  chunkContents: Map<string, string>,
  embedder: Embedder,
  client: Anthropic,
  model: string,
): Promise<RefinementResult> {
  const config = getConfig();
  const targetTokens = config.semanticIndex.targetDescriptionTokens;

  // Build entry map for description lookup
  const entryMap = new Map(entries.map((e) => [e.id, e]));

  // Baseline discrimination
  const baselineResult = testClusterDiscrimination(cluster);
  const baselineSimilarity = analyseCluster(cluster);

  // Generate refined descriptions (sample if cluster is large)
  const refinedEntries: Array<{
    entryId: string;
    original: string;
    refined: string;
    embedding: number[];
  }> = [];

  const entriesToRefine =
    cluster.entries.length > MAX_ENTRIES_PER_CLUSTER
      ? cluster.entries.slice(0, MAX_ENTRIES_PER_CLUSTER)
      : cluster.entries;

  for (const entry of entriesToRefine) {
    const indexEntry = entryMap.get(entry.entryId);
    if (!indexEntry) continue;

    const chunkId = indexEntry.chunkIds[0];
    const content = chunkContents.get(chunkId);
    if (!content) continue;

    // Collect sibling descriptions (cap at 20 nearest to keep prompt manageable)
    const siblingDescs = cluster.entries
      .filter((e) => e.entryId !== entry.entryId)
      .map((e) => {
        const desc = entryMap.get(e.entryId)?.description ?? '';
        const sim = cosineSimilarity(entry.entryEmbedding, e.entryEmbedding);
        return { desc, sim };
      })
      .filter((s) => s.desc.length > 0)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 20)
      .map((s) => s.desc);

    if (siblingDescs.length === 0) continue;

    const prompt = buildRefinementPrompt(content, siblingDescs, targetTokens);

    try {
      const response = await client.messages.create({
        model,
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
      if (!text) continue;

      const embedResult = await embedder.embed(text, false);

      refinedEntries.push({
        entryId: entry.entryId,
        original: indexEntry.description,
        refined: text,
        embedding: embedResult.embedding,
      });
    } catch (error) {
      console.warn(`  Refinement failed for ${entry.entryId}: ${(error as Error).message}`);
    }
  }

  // Build refined cluster for discrimination test
  const refinedCluster: ClusterForAnalysis = {
    ...cluster,
    entries: cluster.entries.map((e) => {
      const refined = refinedEntries.find((r) => r.entryId === e.entryId);
      return {
        ...e,
        entryEmbedding: refined?.embedding ?? e.entryEmbedding,
      };
    }),
  };

  const refinedDiscrimination = testClusterDiscrimination(refinedCluster);
  const refinedSimilarity = analyseCluster(refinedCluster);

  return {
    clusterId: cluster.clusterId,
    clusterName: cluster.clusterName,
    entryCount: cluster.entries.length,
    baselineMRR: baselineResult.meanReciprocalRank,
    refinedMRR: refinedDiscrimination.meanReciprocalRank,
    baselineHitRate: baselineResult.hitRate,
    refinedHitRate: refinedDiscrimination.hitRate,
    compressionRatioDelta: refinedSimilarity.compressionRatio - baselineSimilarity.compressionRatio,
    sampleRefinements: refinedEntries.slice(0, 3).map((r) => ({
      entryId: r.entryId,
      original: r.original,
      refined: r.refined,
    })),
  };
}

/**
 * Run refinement test on clusters with worst discrimination.
 *
 * @param maxClusters Maximum clusters to refine (LLM cost control)
 */
export async function runRefinementTest(
  clusters: ClusterForAnalysis[],
  entries: IndexEntry[],
  chunkContents: Map<string, string>,
  discriminationScores: Map<string, number>, // clusterId → MRR
  maxClusters: number = 5,
): Promise<RefinementResult[] | null> {
  const client = await getClient();
  if (!client) {
    console.log('  No API key available, skipping refinement test');
    return null;
  }

  const config = getConfig();
  const embedder = new Embedder();
  await embedder.load(getModel(config.embeddingModel));

  try {
    // Select clusters with worst discrimination
    const ranked = [...discriminationScores.entries()]
      .sort(([, a], [, b]) => a - b)
      .slice(0, maxClusters);

    const results: RefinementResult[] = [];
    for (const [clusterId] of ranked) {
      const cluster = clusters.find((c) => c.clusterId === clusterId);
      if (!cluster) continue;

      console.log(
        `  Refining cluster ${clusterId} (${cluster.clusterName ?? 'unnamed'}, MRR=${discriminationScores.get(clusterId)?.toFixed(3)})`,
      );

      const result = await testClusterRefinement(
        cluster,
        entries,
        chunkContents,
        embedder,
        client,
        config.clusterRefreshModel,
      );

      results.push(result);
    }

    return results;
  } finally {
    await embedder.dispose();
  }
}
