/**
 * Index Entry Differentiation Experiment
 *
 * Tests whether semantic index entries within the same topic cluster are
 * too similar to each other, reducing the search system's ability to
 * discriminate between chunks covering the same topic.
 *
 * Three phases:
 *   1. Similarity analysis — do entries converge more than raw chunks?
 *   2. Discrimination test — can we find the right entry among siblings?
 *   3. Refinement simulation — does cluster-aware regeneration help?
 *
 * Usage:
 *   npx tsx src/eval/experiments/index-differentiation/run-experiment.ts [--refine] [--max-clusters N]
 *
 * Requires: populated index entries and chunk cluster assignments.
 * Run `npx causantic maintenance run backfill-index` first if needed.
 */

import { getDb } from '../../../storage/db.js';
import { vectorStore, indexVectorStore } from '../../../storage/vector-store.js';
import { getClusterChunkIds, getAllClusters } from '../../../storage/cluster-store.js';
import {
  getIndexEntriesForChunk,
  getIndexEntryCount,
} from '../../../storage/index-entry-store.js';
import { getChunkById } from '../../../storage/chunk-store.js';
import type { IndexEntry, StoredCluster } from '../../../storage/types.js';
import type { ClusterForAnalysis } from './similarity-analysis.js';
import { runSimilarityAnalysis } from './similarity-analysis.js';
import { runDiscriminationTest } from './discrimination-test.js';
import { runAlignmentAnalysis } from './alignment-analysis.js';
import { runRefinementTest } from './refinement-test.js';
import type { DifferentiationReport } from './types.js';

const MIN_ENTRIES_PER_CLUSTER = 3;

/**
 * Build the analysis dataset: for each cluster with enough index entries,
 * gather the entry + chunk embeddings.
 */
async function buildClustersForAnalysis(): Promise<{
  clusters: ClusterForAnalysis[];
  allEntries: IndexEntry[];
  chunkContents: Map<string, string>;
}> {
  // Force DB initialisation (runs migrations, loads config)
  getDb();

  const allClusters = getAllClusters();
  console.log(`  Total clusters: ${allClusters.length}`);

  // Load all embeddings
  const chunkVectors = await vectorStore.getAllVectors();
  const indexVectors = await indexVectorStore.getAllVectors();

  const chunkEmbMap = new Map(chunkVectors.map((v) => [v.id, v.embedding]));
  const indexEmbMap = new Map(indexVectors.map((v) => [v.id, v.embedding]));

  console.log(`  Chunk vectors: ${chunkEmbMap.size}`);
  console.log(`  Index vectors: ${indexEmbMap.size}`);

  const clusters: ClusterForAnalysis[] = [];
  const allEntries: IndexEntry[] = [];
  const chunkContents = new Map<string, string>();

  for (const cluster of allClusters) {
    const chunkIds = getClusterChunkIds(cluster.id);

    // Find index entries for chunks in this cluster
    const clusterEntries: ClusterForAnalysis['entries'] = [];
    const seenEntryIds = new Set<string>();

    for (const chunkId of chunkIds) {
      const entries = getIndexEntriesForChunk(chunkId);
      for (const entry of entries) {
        if (seenEntryIds.has(entry.id)) continue;
        seenEntryIds.add(entry.id);

        const entryEmbedding = indexEmbMap.get(entry.id);
        if (!entryEmbedding) continue;

        // Get chunk embeddings for this entry
        const chunkEmbeddings: number[][] = [];
        for (const cid of entry.chunkIds) {
          const emb = chunkEmbMap.get(cid);
          if (emb) chunkEmbeddings.push(emb);

          // Collect chunk content for refinement phase
          if (!chunkContents.has(cid)) {
            const chunk = getChunkById(cid);
            if (chunk) chunkContents.set(cid, chunk.content);
          }
        }

        clusterEntries.push({
          entryId: entry.id,
          entryEmbedding,
          chunkEmbeddings,
        });

        allEntries.push(entry);
      }
    }

    if (clusterEntries.length >= MIN_ENTRIES_PER_CLUSTER) {
      clusters.push({
        clusterId: cluster.id,
        clusterName: cluster.name,
        entries: clusterEntries,
      });
    }
  }

  return { clusters, allEntries, chunkContents };
}

/**
 * Format a number for display.
 */
function fmt(n: number, decimals = 3): string {
  return n.toFixed(decimals);
}

/**
 * Run the full experiment.
 */
async function runExperiment(): Promise<DifferentiationReport> {
  const args = process.argv.slice(2);
  const doRefine = args.includes('--refine');
  const maxClustersArg = args.find((a) => a.startsWith('--max-clusters='));
  const maxClusters = maxClustersArg
    ? parseInt(maxClustersArg.split('=')[1], 10)
    : 5;

  console.log('=== Index Entry Differentiation Experiment ===\n');

  const totalEntries = getIndexEntryCount();
  console.log(`Total index entries: ${totalEntries}`);

  if (totalEntries === 0) {
    console.log(
      '\nNo index entries found. Run backfill first:\n  npx causantic maintenance run backfill-index',
    );
    process.exit(1);
  }

  // Build dataset
  console.log('\nBuilding analysis dataset...');
  const { clusters, allEntries, chunkContents } = await buildClustersForAnalysis();

  console.log(`  Eligible clusters (≥${MIN_ENTRIES_PER_CLUSTER} entries): ${clusters.length}`);
  console.log(
    `  Total entries in eligible clusters: ${clusters.reduce((s, c) => s + c.entries.length, 0)}`,
  );

  if (clusters.length === 0) {
    console.log(
      '\nNo clusters with enough index entries. Need at least ' +
        `${MIN_ENTRIES_PER_CLUSTER} entries per cluster. ` +
        'Run clustering and backfill first.',
    );
    process.exit(1);
  }

  // ── Phase 1: Similarity Analysis ──────────────────────────────────────────

  console.log('\n── Phase 1: Intra-Cluster Similarity Analysis ──\n');
  const similarityResults = runSimilarityAnalysis(clusters);

  const meanCompression =
    similarityResults.reduce((s, r) => s + r.compressionRatio, 0) /
    similarityResults.length;
  const homogenized = similarityResults.filter(
    (r) => r.compressionRatio > 1.0,
  ).length;

  console.log('  Cluster                          Entries  Entry Sim  Chunk Sim  Ratio');
  console.log('  ' + '─'.repeat(75));
  for (const r of similarityResults.slice(0, 20)) {
    const name = (r.clusterName ?? r.clusterId).slice(0, 30).padEnd(32);
    const ratio = r.compressionRatio > 1 ? `${fmt(r.compressionRatio)} ▲` : `${fmt(r.compressionRatio)} ▼`;
    console.log(
      `  ${name} ${String(r.entryCount).padStart(4)}    ${fmt(r.meanEntryPairSim)}     ${fmt(r.meanChunkPairSim)}     ${ratio}`,
    );
  }
  if (similarityResults.length > 20) {
    console.log(`  ... and ${similarityResults.length - 20} more clusters`);
  }

  console.log(`\n  Mean compression ratio: ${fmt(meanCompression)}`);
  console.log(
    `  Homogenized clusters (ratio > 1): ${homogenized}/${similarityResults.length} (${fmt((100 * homogenized) / similarityResults.length, 1)}%)`,
  );

  // ── Phase 2: Discrimination Test ──────────────────────────────────────────

  console.log('\n── Phase 2: Discrimination Test ──\n');
  const discriminationResults = runDiscriminationTest(clusters);

  let totalRR = 0;
  let totalHits = 0;
  let totalTests = 0;

  for (const r of discriminationResults) {
    totalRR += r.perEntry.reduce((s, e) => s + 1 / e.rankAmongSiblings, 0);
    totalHits += r.perEntry.filter((e) => e.rankAmongSiblings === 1).length;
    totalTests += r.perEntry.length;
  }

  const overallMRR = totalRR / totalTests;
  const overallHitRate = totalHits / totalTests;

  console.log('  Cluster                          Entries    MRR    Hit Rate');
  console.log('  ' + '─'.repeat(65));
  for (const r of discriminationResults.slice(0, 20)) {
    const name = (r.clusterName ?? r.clusterId).slice(0, 30).padEnd(32);
    console.log(
      `  ${name} ${String(r.entryCount).padStart(4)}    ${fmt(r.meanReciprocalRank)}   ${fmt(r.hitRate * 100, 1)}%`,
    );
  }
  if (discriminationResults.length > 20) {
    console.log(`  ... and ${discriminationResults.length - 20} more clusters`);
  }

  console.log(`\n  Overall MRR: ${fmt(overallMRR)}`);
  console.log(`  Overall hit rate: ${fmt(overallHitRate * 100, 1)}%`);

  // ── Phase 2b: Alignment Analysis ─────────────────────────────────────────

  console.log('\n── Phase 2b: Entry-to-Chunk Alignment Analysis ──\n');
  const alignmentResults = runAlignmentAnalysis(clusters);

  let totalSelfAlign = 0;
  let totalSibAlign = 0;
  let totalGap = 0;
  let totalUnique = 0;
  let totalAlignEntries = 0;

  for (const r of alignmentResults) {
    const validCount = r.perEntry.filter((e) => e.selfAlignment > 0).length;
    totalSelfAlign += r.meanSelfAlignment * validCount;
    totalSibAlign += r.meanSiblingAlignment * validCount;
    totalGap += r.meanAlignmentGap * validCount;
    totalUnique += r.uniquelyAlignedFraction * validCount;
    totalAlignEntries += validCount;
  }

  const overallSelfAlign = totalAlignEntries > 0 ? totalSelfAlign / totalAlignEntries : 0;
  const overallSibAlign = totalAlignEntries > 0 ? totalSibAlign / totalAlignEntries : 0;
  const overallGap = totalAlignEntries > 0 ? totalGap / totalAlignEntries : 0;
  const overallUniquelyAligned = totalAlignEntries > 0 ? totalUnique / totalAlignEntries : 0;

  console.log('  Cluster                          Entries  Self   Sibling  Gap    Unique%');
  console.log('  ' + '─'.repeat(80));
  for (const r of alignmentResults.slice(0, 20)) {
    const name = (r.clusterName ?? r.clusterId).slice(0, 30).padEnd(32);
    console.log(
      `  ${name} ${String(r.entryCount).padStart(4)}    ${fmt(r.meanSelfAlignment)}  ${fmt(r.meanSiblingAlignment)}   ${fmt(r.meanAlignmentGap)}  ${fmt(r.uniquelyAlignedFraction * 100, 1)}%`,
    );
  }
  if (alignmentResults.length > 20) {
    console.log(`  ... and ${alignmentResults.length - 20} more clusters`);
  }

  console.log(`\n  Overall self-alignment (entry ↔ own chunk):   ${fmt(overallSelfAlign)}`);
  console.log(`  Overall sibling alignment (entry ↔ other chunks): ${fmt(overallSibAlign)}`);
  console.log(`  Overall alignment gap (self - sibling):       ${fmt(overallGap)}`);
  console.log(`  Uniquely aligned (self > max sibling):        ${fmt(overallUniquelyAligned * 100, 1)}%`);

  // ── Phase 3: Refinement (optional) ────────────────────────────────────────

  let refinementSection: DifferentiationReport['refinement'] | undefined;

  if (doRefine) {
    console.log(`\n── Phase 3: Cluster-Aware Refinement (top ${maxClusters} worst clusters) ──\n`);

    const discriminationScores = new Map(
      discriminationResults.map((r) => [r.clusterId, r.meanReciprocalRank]),
    );

    const refinementResults = await runRefinementTest(
      clusters,
      allEntries,
      chunkContents,
      discriminationScores,
      maxClusters,
    );

    if (refinementResults && refinementResults.length > 0) {
      const meanMRRDelta =
        refinementResults.reduce(
          (s, r) => s + (r.refinedMRR - r.baselineMRR),
          0,
        ) / refinementResults.length;
      const meanCRDelta =
        refinementResults.reduce((s, r) => s + r.compressionRatioDelta, 0) /
        refinementResults.length;

      console.log('\n  Cluster                     Baseline MRR  Refined MRR  Delta');
      console.log('  ' + '─'.repeat(65));
      for (const r of refinementResults) {
        const name = (r.clusterName ?? r.clusterId).slice(0, 27).padEnd(29);
        const delta = r.refinedMRR - r.baselineMRR;
        const arrow = delta > 0.01 ? ' ▲' : delta < -0.01 ? ' ▼' : ' ─';
        console.log(
          `  ${name} ${fmt(r.baselineMRR)}         ${fmt(r.refinedMRR)}       ${delta > 0 ? '+' : ''}${fmt(delta)}${arrow}`,
        );
      }

      console.log(`\n  Mean MRR delta: ${meanMRRDelta > 0 ? '+' : ''}${fmt(meanMRRDelta)}`);
      console.log(`  Mean compression ratio delta: ${meanCRDelta > 0 ? '+' : ''}${fmt(meanCRDelta)}`);

      // Show sample refinements
      const withSamples = refinementResults.filter((r) => r.sampleRefinements.length > 0);
      if (withSamples.length > 0) {
        console.log('\n  Sample refinements:');
        for (const r of withSamples.slice(0, 2)) {
          console.log(`\n  Cluster: ${r.clusterName ?? r.clusterId}`);
          for (const s of r.sampleRefinements.slice(0, 2)) {
            console.log(`    Original:  ${s.original.slice(0, 120)}...`);
            console.log(`    Refined:   ${s.refined.slice(0, 120)}...`);
            console.log('');
          }
        }
      }

      refinementSection = {
        results: refinementResults,
        meanMRRDelta,
        meanCompressionRatioDelta: meanCRDelta,
      };
    }
  } else {
    console.log('\n  (Skipping Phase 3 refinement — pass --refine to enable)');
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  const summary: string[] = [];

  summary.push(
    `Analysed ${clusters.length} clusters (${clusters.reduce((s, c) => s + c.entries.length, 0)} entries)`,
  );

  if (meanCompression > 1.05) {
    summary.push(
      `Compression homogenizes: mean ratio ${fmt(meanCompression)} (entries ${fmt((meanCompression - 1) * 100, 1)}% more similar than chunks)`,
    );
  } else if (meanCompression < 0.95) {
    summary.push(
      `LLM naturally differentiates: mean ratio ${fmt(meanCompression)} (entries ${fmt((1 - meanCompression) * 100, 1)}% less similar than chunks)`,
    );
  } else {
    summary.push(
      `Neutral compression: mean ratio ${fmt(meanCompression)} (entries ~same similarity as chunks)`,
    );
  }

  if (overallMRR > 0.8) {
    summary.push(
      `Strong discrimination: MRR=${fmt(overallMRR)}, hit rate=${fmt(overallHitRate * 100, 1)}% — entries are distinct enough within clusters`,
    );
  } else if (overallMRR > 0.5) {
    summary.push(
      `Moderate discrimination: MRR=${fmt(overallMRR)}, hit rate=${fmt(overallHitRate * 100, 1)}% — some cluster confusion, refinement may help`,
    );
  } else {
    summary.push(
      `Weak discrimination: MRR=${fmt(overallMRR)}, hit rate=${fmt(overallHitRate * 100, 1)}% — entries are too similar within clusters, refinement needed`,
    );
  }

  // Alignment summary
  if (overallGap > 0.05) {
    summary.push(
      `Good alignment: gap=${fmt(overallGap)} (self=${fmt(overallSelfAlign)}, sibling=${fmt(overallSibAlign)}), ${fmt(overallUniquelyAligned * 100, 1)}% uniquely aligned — entries preserve chunk-specific signal`,
    );
  } else if (overallGap > 0) {
    summary.push(
      `Weak alignment: gap=${fmt(overallGap)} (self=${fmt(overallSelfAlign)}, sibling=${fmt(overallSibAlign)}), ${fmt(overallUniquelyAligned * 100, 1)}% uniquely aligned — LLM summarization drifts toward cluster-generic direction`,
    );
  } else {
    summary.push(
      `No alignment: gap=${fmt(overallGap)} — entries are not aligned to their source chunks, retrieval via chunk query will fail`,
    );
  }

  if (refinementSection) {
    if (refinementSection.meanMRRDelta > 0.05) {
      summary.push(
        `Refinement helps: +${fmt(refinementSection.meanMRRDelta)} MRR on worst clusters — worth implementing`,
      );
    } else if (refinementSection.meanMRRDelta > 0) {
      summary.push(
        `Refinement marginal: +${fmt(refinementSection.meanMRRDelta)} MRR — may not justify the LLM cost`,
      );
    } else {
      summary.push(
        `Refinement unhelpful: ${fmt(refinementSection.meanMRRDelta)} MRR — cluster-aware regeneration doesn't improve discrimination`,
      );
    }
  }

  console.log('\n══ Summary ══\n');
  for (const line of summary) {
    console.log(`  • ${line}`);
  }

  const report: DifferentiationReport = {
    timestamp: new Date().toISOString(),
    totalEntries,
    eligibleClusters: clusters.length,
    analysedClusters: clusters.length,
    similarity: {
      results: similarityResults,
      meanCompressionRatio: meanCompression,
      homogenizedFraction: homogenized / similarityResults.length,
    },
    discrimination: {
      results: discriminationResults,
      overallMRR,
      overallHitRate,
    },
    alignment: {
      results: alignmentResults.map((r) => ({
        clusterId: r.clusterId,
        clusterName: r.clusterName,
        entryCount: r.entryCount,
        meanSelfAlignment: r.meanSelfAlignment,
        meanSiblingAlignment: r.meanSiblingAlignment,
        meanAlignmentGap: r.meanAlignmentGap,
        uniquelyAlignedFraction: r.uniquelyAlignedFraction,
      })),
      overallSelfAlignment: overallSelfAlign,
      overallSiblingAlignment: overallSibAlign,
      overallAlignmentGap: overallGap,
      overallUniquelyAligned: overallUniquelyAligned,
    },
    refinement: refinementSection,
    summary,
  };

  return report;
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────

import { writeFileSync } from 'fs';

runExperiment()
  .then((report) => {
    const outPath = 'index-differentiation-report.json';
    writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`\nReport written to ${outPath}`);
  })
  .catch((err) => {
    console.error('Experiment failed:', err);
    process.exit(1);
  });
