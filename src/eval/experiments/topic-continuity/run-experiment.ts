/**
 * Main orchestrator for the topic continuity detection experiment.
 *
 * Compares embedding-only, lexical-only, and hybrid classifiers
 * across multiple models and performs feature ablation analysis.
 */

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getAllModelIds } from '../../../models/model-registry.js';
import { discoverSessions } from '../../corpus-builder.js';
import { getSessionInfo } from '../../../parser/session-reader.js';
import type {
  TurnTransition,
  ClassificationResult,
  ClassifierMetrics,
  ModelResults,
  FeatureAblation,
  ExperimentReport,
  DatasetStats,
} from './types.js';
import {
  generateTransitionLabels,
  computeDatasetStats,
  type SessionSource,
} from './labeler.js';
import {
  embedTransitions,
  classifyWithEmbeddings,
  createEmbeddingCache,
  type EmbeddedTransition,
} from './embedding-classifier.js';
import {
  classifyWithHybrid,
  classifyWithLexicalOnly,
  classifyWithAblation,
  ABLATION_CONFIGS,
} from './hybrid-classifier.js';

/**
 * Compute ROC AUC from classification results.
 * Positive class: continuation (label = 1)
 * Negative class: new_topic (label = 0)
 */
export function computeRocAuc(results: ClassificationResult[]): number {
  const positives: number[] = [];
  const negatives: number[] = [];

  for (const r of results) {
    if (r.groundTruth === 'continuation') {
      positives.push(r.continuationScore);
    } else {
      negatives.push(r.continuationScore);
    }
  }

  if (positives.length === 0 || negatives.length === 0) return 0.5;

  // Wilcoxon-Mann-Whitney statistic
  let concordant = 0;
  let ties = 0;
  for (const pos of positives) {
    for (const neg of negatives) {
      if (pos > neg) concordant++;
      else if (pos === neg) ties++;
    }
  }

  return (concordant + 0.5 * ties) / (positives.length * negatives.length);
}

/**
 * Find optimal threshold using Youden's J statistic.
 */
export function findOptimalThreshold(results: ClassificationResult[]): number {
  const scores = results.map((r) => r.continuationScore).sort((a, b) => a - b);
  const uniqueThresholds = [...new Set(scores)];

  let bestThreshold = 0.5;
  let bestJ = -Infinity;

  for (const threshold of uniqueThresholds) {
    const { tpr, fpr } = computeRates(results, threshold);
    const j = tpr - fpr;
    if (j > bestJ) {
      bestJ = j;
      bestThreshold = threshold;
    }
  }

  return bestThreshold;
}

/**
 * Compute TPR and FPR at a given threshold.
 */
function computeRates(
  results: ClassificationResult[],
  threshold: number,
): { tpr: number; fpr: number } {
  let tp = 0, fn = 0, fp = 0, tn = 0;

  for (const r of results) {
    const predicted = r.continuationScore >= threshold ? 'continuation' : 'new_topic';
    if (r.groundTruth === 'continuation') {
      if (predicted === 'continuation') tp++;
      else fn++;
    } else {
      if (predicted === 'continuation') fp++;
      else tn++;
    }
  }

  const tpr = tp + fn > 0 ? tp / (tp + fn) : 0;
  const fpr = fp + tn > 0 ? fp / (fp + tn) : 0;
  return { tpr, fpr };
}

/**
 * Compute precision, recall, F1 at a given threshold.
 */
function computePRF(
  results: ClassificationResult[],
  threshold: number,
): { precision: number; recall: number; f1: number } {
  let tp = 0, fp = 0, fn = 0;

  for (const r of results) {
    const predicted = r.continuationScore >= threshold ? 'continuation' : 'new_topic';
    if (r.groundTruth === 'continuation') {
      if (predicted === 'continuation') tp++;
      else fn++;
    } else {
      if (predicted === 'continuation') fp++;
    }
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { precision, recall, f1 };
}

/**
 * Compute all classifier metrics.
 */
export function computeMetrics(results: ClassificationResult[]): ClassifierMetrics {
  const rocAuc = computeRocAuc(results);
  const threshold = findOptimalThreshold(results);
  const { precision, recall, f1 } = computePRF(results, threshold);

  return { rocAuc, precision, recall, f1, threshold };
}

export interface ExperimentOptions {
  /** Claude projects directory containing session files. */
  projectsDir: string;
  /** Maximum sessions to process. Default: 20. */
  maxSessions?: number;
  /** Time gap threshold in minutes. Default: 30. */
  timeGapMinutes?: number;
  /** Models to evaluate. Default: all registered models. */
  modelIds?: string[];
}

/**
 * Discover all session files across all project subdirectories.
 */
async function discoverAllSessions(projectsRootDir: string): Promise<string[]> {
  const allSessions: { path: string; size: number }[] = [];

  try {
    const projectDirs = await readdir(projectsRootDir);

    for (const dir of projectDirs) {
      const projectPath = join(projectsRootDir, dir);
      try {
        const dirStat = await stat(projectPath);
        if (!dirStat.isDirectory()) continue;

        const sessions = await discoverSessions(projectPath);
        for (const sessionPath of sessions) {
          const sessionStat = await stat(sessionPath);
          allSessions.push({ path: sessionPath, size: sessionStat.size });
        }
      } catch {
        // Skip inaccessible directories
      }
    }
  } catch {
    // Fall back to treating projectsRootDir as a single project
    const sessions = await discoverSessions(projectsRootDir);
    for (const sessionPath of sessions) {
      const sessionStat = await stat(sessionPath);
      allSessions.push({ path: sessionPath, size: sessionStat.size });
    }
  }

  // Sort by size descending (richest sessions first)
  allSessions.sort((a, b) => b.size - a.size);
  return allSessions.map((s) => s.path);
}

/**
 * Run the complete topic continuity experiment.
 */
export async function runTopicContinuityExperiment(
  options: ExperimentOptions,
): Promise<ExperimentReport> {
  const {
    projectsDir,
    maxSessions = 20,
    timeGapMinutes = 30,
    modelIds = getAllModelIds(),
  } = options;

  console.log('='.repeat(70));
  console.log('  TOPIC CONTINUITY DETECTION EXPERIMENT');
  console.log('='.repeat(70));

  // Step 1: Discover sessions across all project directories
  console.log('\n--- Discovering sessions ---');
  const sessionPaths = await discoverAllSessions(projectsDir);
  const selectedPaths = sessionPaths.slice(0, maxSessions);
  console.log(`Found ${sessionPaths.length} sessions, using ${selectedPaths.length}`);

  // Step 2: Build session sources
  const sessionSources: SessionSource[] = [];
  for (const path of selectedPaths) {
    const info = await getSessionInfo(path);
    sessionSources.push({
      path,
      sessionId: info.sessionId,
      sessionSlug: info.slug,
    });
  }

  // Step 3: Generate labeled transitions
  console.log('\n--- Generating transition labels ---');
  const transitions = await generateTransitionLabels(sessionSources, { timeGapMinutes });
  const stats = computeDatasetStats(transitions);

  console.log(`\nDataset statistics:`);
  console.log(`  Total transitions: ${stats.totalTransitions}`);
  console.log(`  Continuations: ${stats.continuationCount}`);
  console.log(`  New topics: ${stats.newTopicCount}`);
  console.log(`  High confidence: ${stats.highConfidenceCount}`);
  console.log(`  By source:`);
  for (const [source, count] of Object.entries(stats.byLabelSource)) {
    console.log(`    ${source}: ${count}`);
  }

  // Filter to transitions with prior context
  const validTransitions = transitions.filter((t) => t.prevAssistantText.trim());
  console.log(`\nValid transitions (with prior context): ${validTransitions.length}`);

  // Step 4: Evaluate lexical-only classifier (no embedding needed)
  console.log('\n--- Evaluating lexical-only classifier ---');
  const lexicalResults = classifyWithLexicalOnly(validTransitions);
  const lexicalMetrics = computeMetrics(lexicalResults);
  console.log(`  ROC AUC: ${lexicalMetrics.rocAuc.toFixed(3)}`);
  console.log(`  F1: ${lexicalMetrics.f1.toFixed(3)} @ threshold ${lexicalMetrics.threshold.toFixed(3)}`);

  // Step 5: Evaluate each model
  const modelResults: ModelResults[] = [];
  let firstEmbedded: EmbeddedTransition[] | null = null;

  for (const modelId of modelIds) {
    console.log(`\n--- Evaluating ${modelId} ---`);

    try {
      // Embed transitions
      const embedded = await embedTransitions(modelId, validTransitions);

      // Save first for ablation study
      if (!firstEmbedded) {
        firstEmbedded = embedded;
      }

      // Embedding-only classification
      const embeddingResults = classifyWithEmbeddings(embedded);
      const embeddingMetrics = computeMetrics(embeddingResults);

      // Hybrid classification
      const hybridResults = classifyWithHybrid(embedded);
      const hybridMetrics = computeMetrics(hybridResults);

      modelResults.push({
        modelId,
        embeddingOnly: embeddingMetrics,
        lexicalOnly: lexicalMetrics,
        hybrid: hybridMetrics,
      });

      console.log(`  Embedding-only: AUC=${embeddingMetrics.rocAuc.toFixed(3)}, F1=${embeddingMetrics.f1.toFixed(3)}`);
      console.log(`  Hybrid: AUC=${hybridMetrics.rocAuc.toFixed(3)}, F1=${hybridMetrics.f1.toFixed(3)}`);
    } catch (err) {
      console.error(`  Failed: ${err}`);
    }
  }

  // Step 6: Feature ablation study
  console.log('\n--- Feature ablation study ---');
  const featureAblation: FeatureAblation[] = [];

  if (firstEmbedded) {
    // Compute baseline (embedding-only)
    const baselineResults = classifyWithEmbeddings(firstEmbedded);
    const baselineAuc = computeRocAuc(baselineResults);

    for (const config of ABLATION_CONFIGS) {
      const ablatedResults = classifyWithAblation(firstEmbedded, config.flags);
      const ablatedAuc = computeRocAuc(ablatedResults);

      featureAblation.push({
        featureName: config.name,
        baselineRocAuc: baselineAuc,
        withFeatureRocAuc: ablatedAuc,
        deltaRocAuc: ablatedAuc - baselineAuc,
      });

      console.log(`  ${config.name}: AUC=${ablatedAuc.toFixed(3)} (delta=${(ablatedAuc - baselineAuc >= 0 ? '+' : '')}${(ablatedAuc - baselineAuc).toFixed(3)})`);
    }
  }

  // Step 7: Generate recommendations
  const recommendations = generateRecommendations(modelResults, featureAblation);

  // Print summary
  printSummaryTable(modelResults);
  printAblationTable(featureAblation);

  return {
    name: 'topic-continuity-detection',
    description: 'Classify user messages as topic continuations or new topics',
    dataset: stats,
    modelResults,
    featureAblation,
    recommendations,
    completedAt: new Date().toISOString(),
  };
}

/**
 * Generate recommendations based on results.
 */
function generateRecommendations(
  modelResults: ModelResults[],
  ablation: FeatureAblation[],
): string[] {
  const recommendations: string[] = [];

  // Find best model
  if (modelResults.length > 0) {
    const bestHybrid = modelResults.reduce((a, b) =>
      b.hybrid.rocAuc > a.hybrid.rocAuc ? b : a,
    );
    recommendations.push(
      `Best hybrid model: ${bestHybrid.modelId} (AUC=${bestHybrid.hybrid.rocAuc.toFixed(3)})`,
    );

    // Check if hybrid beats embedding-only
    const avgImprovement =
      modelResults.reduce((sum, m) => sum + (m.hybrid.rocAuc - m.embeddingOnly.rocAuc), 0) /
      modelResults.length;
    if (avgImprovement > 0.01) {
      recommendations.push(
        `Hybrid improves on embedding-only by +${avgImprovement.toFixed(3)} AUC on average`,
      );
    } else {
      recommendations.push(
        `Hybrid provides minimal improvement over embedding-only (${avgImprovement >= 0 ? '+' : ''}${avgImprovement.toFixed(3)} AUC)`,
      );
    }
  }

  // Find most valuable features
  const sortedAblation = [...ablation].sort((a, b) => b.deltaRocAuc - a.deltaRocAuc);
  const topFeatures = sortedAblation.filter((a) => a.deltaRocAuc > 0.01);
  if (topFeatures.length > 0) {
    recommendations.push(
      `Most valuable features: ${topFeatures.map((f) => f.featureName).join(', ')}`,
    );
  }

  return recommendations;
}

/**
 * Print model comparison summary table.
 */
function printSummaryTable(results: ModelResults[]): void {
  if (results.length === 0) return;

  console.log('\n' + '='.repeat(90));
  console.log('  MODEL COMPARISON SUMMARY');
  console.log('='.repeat(90));

  const header = [
    pad('Model', 15),
    pad('Emb AUC', 10),
    pad('Emb F1', 8),
    pad('Lex AUC', 10),
    pad('Lex F1', 8),
    pad('Hyb AUC', 10),
    pad('Hyb F1', 8),
  ];
  console.log(header.join(' | '));
  console.log('-'.repeat(90));

  for (const r of results) {
    const row = [
      pad(r.modelId, 15),
      pad(r.embeddingOnly.rocAuc.toFixed(3), 10),
      pad(r.embeddingOnly.f1.toFixed(3), 8),
      pad(r.lexicalOnly.rocAuc.toFixed(3), 10),
      pad(r.lexicalOnly.f1.toFixed(3), 8),
      pad(r.hybrid.rocAuc.toFixed(3), 10),
      pad(r.hybrid.f1.toFixed(3), 8),
    ];
    console.log(row.join(' | '));
  }

  console.log('='.repeat(90));
}

/**
 * Print feature ablation table.
 */
function printAblationTable(ablation: FeatureAblation[]): void {
  if (ablation.length === 0) return;

  console.log('\n' + '='.repeat(70));
  console.log('  FEATURE ABLATION');
  console.log('='.repeat(70));

  const header = [
    pad('Configuration', 30),
    pad('ROC AUC', 10),
    pad('Delta', 10),
  ];
  console.log(header.join(' | '));
  console.log('-'.repeat(70));

  for (const a of ablation) {
    const delta = a.deltaRocAuc >= 0 ? `+${a.deltaRocAuc.toFixed(3)}` : a.deltaRocAuc.toFixed(3);
    const row = [
      pad(a.featureName, 30),
      pad(a.withFeatureRocAuc.toFixed(3), 10),
      pad(delta, 10),
    ];
    console.log(row.join(' | '));
  }

  console.log('='.repeat(70));
}

function pad(str: string, width: number): string {
  return str.padEnd(width).slice(0, width);
}

/**
 * Export transitions dataset to JSON for further analysis.
 */
export async function exportTransitionsDataset(
  options: ExperimentOptions,
  outputPath: string,
): Promise<void> {
  const { projectsDir, maxSessions = 20, timeGapMinutes = 30 } = options;

  const sessionPaths = await discoverAllSessions(projectsDir);
  const selectedPaths = sessionPaths.slice(0, maxSessions);

  const sessionSources: SessionSource[] = [];
  for (const path of selectedPaths) {
    const info = await getSessionInfo(path);
    sessionSources.push({
      path,
      sessionId: info.sessionId,
      sessionSlug: info.slug,
    });
  }

  const transitions = await generateTransitionLabels(sessionSources, { timeGapMinutes });
  const stats = computeDatasetStats(transitions);

  const { writeFile } = await import('node:fs/promises');
  await writeFile(
    outputPath,
    JSON.stringify({ transitions, stats, exportedAt: new Date().toISOString() }, null, 2),
  );

  console.log(`Exported ${transitions.length} transitions to ${outputPath}`);
}
