/**
 * Report generation for collection benchmarks.
 *
 * Produces Markdown and JSON reports from benchmark results.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CollectionBenchmarkResult } from './types.js';

/**
 * Generate a Markdown report from benchmark results.
 */
export function generateMarkdownReport(result: CollectionBenchmarkResult): string {
  const lines: string[] = [];
  const ts = new Date(result.timestamp).toISOString();

  lines.push(`# Causantic Collection Benchmark Report`);
  lines.push(`Generated: ${ts} | Profile: ${result.profile}${result.overallScore != null ? '' : ''}`);
  lines.push('');
  lines.push(`## Overall Score: ${result.overallScore}/100`);
  lines.push('');

  // Highlights
  if (result.highlights.length > 0) {
    lines.push('### Highlights');
    for (const h of result.highlights) {
      lines.push(`- ${h}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // Collection Health
  const h = result.collectionStats;
  lines.push('## Collection Health');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Chunks | ${h.chunkCount.toLocaleString()} |`);
  lines.push(`| Projects | ${h.projectCount} |`);
  lines.push(`| Sessions | ${h.sessionCount} |`);
  lines.push(`| Edges | ${h.edgeCount.toLocaleString()} |`);
  lines.push(`| Edge-to-chunk ratio | ${h.edgeToChunkRatio.toFixed(2)} |`);
  lines.push(`| Cluster coverage | ${(h.clusterCoverage * 100).toFixed(1)}% |`);
  lines.push(`| Orphan chunks | ${(h.orphanChunkPercentage * 100).toFixed(1)}% |`);
  if (h.temporalSpan) {
    const earliest = new Date(h.temporalSpan.earliest).toLocaleDateString();
    const latest = new Date(h.temporalSpan.latest).toLocaleDateString();
    const days = Math.round(
      (new Date(h.temporalSpan.latest).getTime() - new Date(h.temporalSpan.earliest).getTime()) /
      (1000 * 60 * 60 * 24)
    );
    lines.push(`| Temporal span | ${earliest} → ${latest} (${days} days) |`);
  }
  lines.push('');

  // Per-project breakdown
  if (h.perProject.length > 1) {
    lines.push('### Per-Project Breakdown');
    lines.push('');
    lines.push('| Project | Chunks | Edges | Clusters | Orphans |');
    lines.push('|---------|--------|-------|----------|---------|');
    for (const p of h.perProject) {
      lines.push(`| ${p.slug} | ${p.chunkCount.toLocaleString()} | ${p.edgeCount.toLocaleString()} | ${p.clusterCount} | ${(p.orphanPercentage * 100).toFixed(1)}% |`);
    }
    lines.push('');
  }

  // Edge type distribution
  if (h.edgeTypeDistribution.length > 0) {
    lines.push('### Edge Type Distribution');
    lines.push('');
    lines.push('| Type | Count | % |');
    lines.push('|------|-------|---|');
    for (const d of h.edgeTypeDistribution) {
      lines.push(`| ${d.type} | ${d.count.toLocaleString()} | ${(d.percentage * 100).toFixed(1)}% |`);
    }
    lines.push('');
  }

  // Cluster quality
  if (h.clusterQuality) {
    lines.push('### Cluster Quality');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Intra-cluster similarity | ${h.clusterQuality.intraClusterSimilarity.toFixed(2)} |`);
    lines.push(`| Inter-cluster separation | ${h.clusterQuality.interClusterSeparation.toFixed(2)} |`);
    lines.push(`| Coherence score | ${h.clusterQuality.coherenceScore.toFixed(2)} |`);
    lines.push('');
  }

  // Retrieval Quality
  if (result.retrieval) {
    const r = result.retrieval;
    lines.push('## Retrieval Quality');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Adjacent Recall@5 | ${r.adjacentRecallAt5.toFixed(2)} |`);
    lines.push(`| Adjacent Recall@10 | ${r.adjacentRecallAt10.toFixed(2)} |`);
    lines.push(`| MRR | ${r.mrr.toFixed(2)} |`);
    lines.push(`| Bridging Recall@10 | ${r.bridgingRecallAt10.toFixed(2)} |`);
    lines.push(`| Bridging vs Random | ${r.bridgingVsRandom.toFixed(1)}x |`);
    lines.push(`| Precision@5 | ${r.precisionAt5.toFixed(2)} |`);
    lines.push(`| Precision@10 | ${r.precisionAt10.toFixed(2)} |`);
    lines.push(`| Token Efficiency | ${(r.tokenEfficiency * 100).toFixed(0)}% |`);
    lines.push('');
  }

  // Skipped benchmarks
  if (result.skipped.length > 0) {
    lines.push('### Skipped Benchmarks');
    lines.push('');
    for (const s of result.skipped) {
      lines.push(`- **${s.name}**: ${s.reason}`);
    }
    lines.push('');
  }

  // Graph Value
  if (result.graphValue) {
    const g = result.graphValue;
    lines.push('## Graph Value');
    lines.push('');
    lines.push('| Source | % of Results |');
    lines.push('|--------|-------------|');
    lines.push(`| Vector | ${(g.sourceAttribution.vectorPercentage * 100).toFixed(0)}% |`);
    lines.push(`| Keyword | ${(g.sourceAttribution.keywordPercentage * 100).toFixed(0)}% |`);
    lines.push(`| Cluster | ${(g.sourceAttribution.clusterPercentage * 100).toFixed(0)}% |`);
    lines.push(`| Graph | ${(g.sourceAttribution.graphPercentage * 100).toFixed(0)}% |`);
    lines.push('');
    lines.push(`**Augmentation Ratio:** ${g.sourceAttribution.augmentationRatio.toFixed(1)}x`);
    lines.push(`**Recall Lift:** +${(g.lift * 100).toFixed(0)}% over vector-only`);
    lines.push('');

    if (g.edgeTypeEffectiveness.length > 0) {
      lines.push('### Edge Type Effectiveness');
      lines.push('');
      lines.push('| Type | Chunks Surfaced | Recall Contribution |');
      lines.push('|------|----------------|---------------------|');
      for (const e of g.edgeTypeEffectiveness) {
        lines.push(`| ${e.type} | ${e.chunksSurfaced} | ${(e.recallContribution * 100).toFixed(0)}% |`);
      }
      lines.push('');
    }
  }

  // Latency
  if (result.latency) {
    const l = result.latency;
    lines.push('## Latency');
    lines.push('');
    lines.push('| Operation | p50 | p95 | p99 |');
    lines.push('|-----------|-----|-----|-----|');
    lines.push(`| recall | ${l.recall.p50.toFixed(0)}ms | ${l.recall.p95.toFixed(0)}ms | ${l.recall.p99.toFixed(0)}ms |`);
    lines.push(`| explain | ${l.explain.p50.toFixed(0)}ms | ${l.explain.p95.toFixed(0)}ms | ${l.explain.p99.toFixed(0)}ms |`);
    lines.push(`| predict | ${l.predict.p50.toFixed(0)}ms | ${l.predict.p95.toFixed(0)}ms | ${l.predict.p99.toFixed(0)}ms |`);
    lines.push(`| reconstruct | ${l.reconstruct.p50.toFixed(0)}ms | ${l.reconstruct.p95.toFixed(0)}ms | ${l.reconstruct.p99.toFixed(0)}ms |`);
    lines.push('');
  }

  // Trend
  if (result.trend) {
    const t = result.trend;
    lines.push('## Trend (vs previous run)');
    lines.push('');
    if (t.metricDeltas.length > 0) {
      lines.push('| Metric | Previous | Current | Change |');
      lines.push('|--------|----------|---------|--------|');
      lines.push(`| Overall Score | ${(result.overallScore - t.overallScoreDelta).toFixed(0)} | ${result.overallScore.toFixed(0)} | ${t.overallScoreDelta >= 0 ? '+' : ''}${t.overallScoreDelta.toFixed(0)} ${t.overallScoreDelta >= 0 ? '\u2191' : '\u2193'} |`);
      for (const d of t.metricDeltas) {
        const arrow = d.improved ? '\u2191' : '\u2193';
        const sign = d.delta >= 0 ? '+' : '';
        lines.push(`| ${d.metric} | ${formatMetricValue(d.previous, d.metric)} | ${formatMetricValue(d.current, d.metric)} | ${sign}${formatMetricValue(d.delta, d.metric)} ${arrow} |`);
      }
      lines.push('');
    }
    lines.push(`*${t.summary}*`);
    lines.push('');
  }

  // Tuning recommendations
  if (result.tuning && result.tuning.length > 0) {
    lines.push('## Tuning Recommendations');
    lines.push('');

    const byPriority = { high: [] as typeof result.tuning, medium: [] as typeof result.tuning, low: [] as typeof result.tuning };
    for (const rec of result.tuning) {
      byPriority[rec.priority].push(rec);
    }

    let num = 1;
    if (byPriority.high.length > 0) {
      lines.push('### High Priority');
      lines.push('');
      for (const rec of byPriority.high) {
        lines.push(`${num++}. **${rec.metric}** (${rec.currentValue})`);
        if (rec.configPath !== '(action)') {
          lines.push(`   - Set \`${rec.configPath}: ${rec.suggestedValue.split(': ')[1] ?? rec.suggestedValue}\` in \`causantic.config.json\``);
        }
        lines.push(`   - Impact: ${rec.impact}`);
        lines.push('');
      }
    }

    if (byPriority.medium.length > 0) {
      lines.push('### Medium Priority');
      lines.push('');
      for (const rec of byPriority.medium) {
        lines.push(`${num++}. **${rec.metric}** (${rec.currentValue})`);
        if (rec.configPath !== '(action)') {
          lines.push(`   - Set \`${rec.configPath}: ${rec.suggestedValue.split(': ')[1] ?? rec.suggestedValue}\` in \`causantic.config.json\``);
        }
        lines.push(`   - Impact: ${rec.impact}`);
        lines.push('');
      }
    }

    if (byPriority.low.length > 0) {
      lines.push('### Low Priority');
      lines.push('');
      for (const rec of byPriority.low) {
        lines.push(`${num++}. **${rec.metric}** (${rec.currentValue})`);
        if (rec.configPath !== '(action)') {
          lines.push(`   - Set \`${rec.configPath}: ${rec.suggestedValue.split(': ')[1] ?? rec.suggestedValue}\` in \`causantic.config.json\``);
        }
        lines.push(`   - Impact: ${rec.impact}`);
        lines.push('');
      }
    }
  }

  lines.push('---');
  lines.push(`*Run with: \`npx causantic benchmark-collection --${result.profile}\`*`);
  lines.push('*Re-run after tuning to measure improvement.*');

  return lines.join('\n');
}

/**
 * Write Markdown and JSON reports to disk.
 */
export async function writeReports(
  result: CollectionBenchmarkResult,
  outputDir: string,
): Promise<{ markdownPath: string; jsonPath: string }> {
  await mkdir(outputDir, { recursive: true });

  const markdownPath = join(outputDir, 'report.md');
  const jsonPath = join(outputDir, 'report.json');

  const markdown = generateMarkdownReport(result);
  await writeFile(markdownPath, markdown, 'utf-8');
  await writeFile(jsonPath, JSON.stringify(result, null, 2), 'utf-8');

  return { markdownPath, jsonPath };
}

/**
 * Format a metric value for display.
 */
function formatMetricValue(value: number, metric: string): string {
  if (metric.includes('Latency')) return `${value.toFixed(0)}ms`;
  if (metric.includes('Ratio')) return `${value.toFixed(1)}x`;
  if (metric.includes('%') || metric.includes('Coverage') || metric.includes('Efficiency')) {
    return `${(value * 100).toFixed(1)}%`;
  }
  return value.toFixed(2);
}
