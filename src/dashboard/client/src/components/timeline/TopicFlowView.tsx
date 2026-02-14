import { useRef, useEffect, useMemo } from 'react';
import * as d3 from 'd3';
import { CLUSTER_COLORS } from '../../lib/constants';
import type { ClusterInfo } from '../../lib/constants';

interface TimelineChunk {
  id: string;
  startTime: string;
  endTime: string;
  sessionSlug: string;
  sessionId: string;
  preview: string;
  approxTokens: number;
  clusterId: string | null;
}

interface TimelineEdge {
  sourceId: string;
  targetId: string;
  referenceType: string | null;
}

interface TopicFlowViewProps {
  chunks: TimelineChunk[];
  edges: TimelineEdge[];
  timeRange: { earliest: string | null; latest: string | null };
  onChunkClick: (chunkId: string) => void;
  selectedChunkId: string | null;
  clusters?: ClusterInfo[];
}

const GAP_THRESHOLD_MS = 3600000; // 1 hour
const CHAIN_MAX = 20;

/** Hex color → rgba at given alpha */
function hexAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

interface TopicStats {
  longestStreak: { cluster: string; count: number; durationMs: number } | null;
  mostSwitches: { from: string; to: string; count: number } | null;
  focusScore: number;
}

function computeStats(sorted: TimelineChunk[], clusterLabel: (id: string | null) => string): TopicStats {
  if (sorted.length <= 1) {
    return {
      longestStreak: sorted.length === 1 ? { cluster: clusterLabel(sorted[0].clusterId), count: 1, durationMs: 0 } : null,
      mostSwitches: null,
      focusScore: 1,
    };
  }

  // Longest streak
  let bestStreak = { cluster: sorted[0].clusterId, count: 1, startIdx: 0, endIdx: 0 };
  let curStreak = { cluster: sorted[0].clusterId, count: 1, startIdx: 0 };
  for (let i = 1; i < sorted.length; i++) {
    const cid = sorted[i].clusterId ?? '__unclustered';
    const prev = curStreak.cluster ?? '__unclustered';
    if (cid === prev) {
      curStreak.count++;
    } else {
      if (curStreak.count > bestStreak.count) {
        bestStreak = { ...curStreak, endIdx: i - 1 };
      }
      curStreak = { cluster: sorted[i].clusterId, count: 1, startIdx: i };
    }
  }
  if (curStreak.count > bestStreak.count) {
    bestStreak = { ...curStreak, endIdx: sorted.length - 1 };
  }
  const streakDuration = new Date(sorted[bestStreak.endIdx].endTime).getTime() - new Date(sorted[bestStreak.startIdx].startTime).getTime();

  // Switch counts between pairs
  const pairCounts = new Map<string, { from: string; to: string; count: number }>();
  let switchCount = 0;
  for (let i = 1; i < sorted.length; i++) {
    const fromId = sorted[i - 1].clusterId ?? '__unclustered';
    const toId = sorted[i].clusterId ?? '__unclustered';
    if (fromId !== toId) {
      switchCount++;
      const key = [fromId, toId].sort().join('|');
      const existing = pairCounts.get(key);
      if (existing) {
        existing.count++;
      } else {
        pairCounts.set(key, { from: fromId, to: toId, count: 1 });
      }
    }
  }

  let mostSwitches: TopicStats['mostSwitches'] = null;
  for (const pair of pairCounts.values()) {
    if (!mostSwitches || pair.count > mostSwitches.count) {
      mostSwitches = { from: clusterLabel(pair.from === '__unclustered' ? null : pair.from), to: clusterLabel(pair.to === '__unclustered' ? null : pair.to), count: pair.count };
    }
  }

  return {
    longestStreak: { cluster: clusterLabel(bestStreak.cluster), count: bestStreak.count, durationMs: streakDuration },
    mostSwitches,
    focusScore: 1 - switchCount / (sorted.length - 1),
  };
}

function formatDuration(ms: number): string {
  if (ms < 60000) return '<1m';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

export function TopicFlowView({ chunks, edges: _edges, timeRange, onChunkClick, selectedChunkId, clusters }: TopicFlowViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const clusterMap = useMemo(() => new Map((clusters ?? []).map((c) => [c.id, c])), [clusters]);

  // Sort chunks chronologically
  const sorted = useMemo(() =>
    [...chunks].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
    [chunks],
  );

  // Cluster ordering by first appearance
  const clusterOrder = useMemo(() => {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const c of sorted) {
      const cid = c.clusterId ?? '__unclustered';
      if (!seen.has(cid)) {
        seen.add(cid);
        if (cid !== '__unclustered') order.push(cid);
      }
    }
    // Unclustered at bottom
    if (seen.has('__unclustered')) order.push('__unclustered');
    return order;
  }, [sorted]);

  // Color assignment: sort by member count (same as ClusterLegend/TimelineView)
  const colorIndex = useMemo(() => {
    const realClusters = clusterOrder.filter((id) => id !== '__unclustered');
    const bySizeDesc = [...realClusters]
      .map((id) => ({ id, info: clusterMap.get(id) }))
      .sort((a, b) => (b.info?.memberCount ?? 0) - (a.info?.memberCount ?? 0));
    return new Map(bySizeDesc.map((c, i) => [c.id, i]));
  }, [clusterOrder, clusterMap]);

  function getColor(clusterId: string | null): string {
    if (!clusterId || clusterId === '__unclustered') return '#64748b';
    const idx = colorIndex.get(clusterId);
    if (idx === undefined) return '#64748b';
    return CLUSTER_COLORS[idx % CLUSTER_COLORS.length];
  }

  function clusterLabel(clusterId: string | null): string {
    if (!clusterId || clusterId === '__unclustered') return 'Unclustered';
    const info = clusterMap.get(clusterId);
    return info?.name ?? `Topic ${(colorIndex.get(clusterId) ?? 0) + 1}`;
  }

  // Compute dwell time stats
  const stats = useMemo(() => computeStats(sorted, clusterLabel), [sorted, clusterMap, colorIndex]);

  // Per-cluster chunk counts and token sums for Y-axis labels
  const clusterStats = useMemo(() => {
    const map = new Map<string, { count: number; tokens: number }>();
    for (const c of sorted) {
      const cid = c.clusterId ?? '__unclustered';
      const existing = map.get(cid);
      if (existing) {
        existing.count++;
        existing.tokens += c.approxTokens;
      } else {
        map.set(cid, { count: 1, tokens: c.approxTokens });
      }
    }
    return map;
  }, [sorted]);

  // Session boundaries
  const sessionBoundaries = useMemo(() => {
    const sessionFirst = new Map<string, number>();
    for (const c of sorted) {
      if (!sessionFirst.has(c.sessionId)) {
        sessionFirst.set(c.sessionId, new Date(c.startTime).getTime());
      }
    }
    // Sort by time and skip the first
    const boundaries = [...sessionFirst.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(1)
      .map(([sessionId, time]) => {
        const chunk = sorted.find((c) => c.sessionId === sessionId);
        return { time, slug: chunk?.sessionSlug ?? sessionId.slice(0, 8) };
      });
    return boundaries;
  }, [sorted]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    if (sorted.length === 0 || !timeRange.earliest || !timeRange.latest) return;

    const container = svgRef.current?.parentElement;
    const width = container?.clientWidth ?? 800;
    const height = container?.clientHeight ?? 400;
    const margin = { top: 30, right: 30, bottom: 40, left: 220 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // Scales
    const xScale = d3.scaleTime()
      .domain([new Date(timeRange.earliest!), new Date(timeRange.latest!)])
      .range([0, innerWidth]);

    const yScale = d3.scaleBand<string>()
      .domain(clusterOrder)
      .range([0, innerHeight])
      .padding(0.25);

    const bandwidth = yScale.bandwidth();

    svg.attr('width', width).attr('height', height);

    // Defs: clip path + gradients
    const defs = svg.append('defs');
    defs.append('clipPath')
      .attr('id', 'topicflow-clip')
      .append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight);

    // Gradient defs for cross-cluster ribbons
    const gradientPairs = new Set<string>();
    for (let i = 0; i < sorted.length - 1; i++) {
      const fromId = sorted[i].clusterId ?? '__unclustered';
      const toId = sorted[i + 1].clusterId ?? '__unclustered';
      if (fromId !== toId) {
        gradientPairs.add(`${fromId}||${toId}`);
      }
    }
    for (const pair of gradientPairs) {
      const [fromId, toId] = pair.split('||');
      const gradId = `grad-${fromId}-${toId}`.replace(/[^a-zA-Z0-9-]/g, '_');
      const grad = defs.append('linearGradient')
        .attr('id', gradId)
        .attr('x1', '0%').attr('y1', '0%')
        .attr('x2', '100%').attr('y2', '0%');
      grad.append('stop').attr('offset', '0%').attr('stop-color', getColor(fromId === '__unclustered' ? null : fromId)).attr('stop-opacity', 0.3);
      grad.append('stop').attr('offset', '100%').attr('stop-color', getColor(toId === '__unclustered' ? null : toId)).attr('stop-opacity', 0.3);
    }

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // X axis
    const xAxisG = g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).ticks(8))
      .attr('class', 'topicflow-axis');

    // Y axis (custom labels)
    const yAxisG = g.append('g').attr('class', 'topicflow-axis');
    for (const cid of clusterOrder) {
      const yPos = (yScale(cid) ?? 0) + bandwidth / 2;
      const label = clusterLabel(cid === '__unclustered' ? null : cid);
      const cs = clusterStats.get(cid);
      const tokenStr = cs ? (cs.tokens >= 1000 ? `${Math.round(cs.tokens / 1000)}k` : `${cs.tokens}`) : '0';
      const fullLabel = cs ? `${label} (${cs.count}, ${tokenStr} tok)` : label;
      const truncated = fullLabel.length > 30 ? fullLabel.slice(0, 28) + '…' : fullLabel;
      yAxisG.append('text')
        .attr('x', -8)
        .attr('y', yPos)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('fill', 'var(--muted-foreground, #94a3b8)')
        .attr('font-size', '11px')
        .text(truncated)
        .append('title').text(fullLabel);
    }
    // Y axis line
    yAxisG.append('line')
      .attr('x1', 0).attr('y1', 0)
      .attr('x2', 0).attr('y2', innerHeight)
      .attr('stroke', 'var(--border-color, #334155)');

    // Style axis
    g.selectAll('.topicflow-axis line, .topicflow-axis path')
      .attr('stroke', 'var(--border-color, #334155)');
    g.selectAll('.topicflow-axis text')
      .attr('fill', 'var(--muted-foreground, #94a3b8)');

    const chartArea = g.append('g').attr('clip-path', 'url(#topicflow-clip)');

    // Helper to render all dynamic content
    function renderContent(xS: d3.ScaleTime<number, number>) {
      chartArea.selectAll('*').remove();

      // Session boundary lines
      const sessionG = chartArea.append('g').attr('class', 'session-boundaries');
      for (const sb of sessionBoundaries) {
        const x = xS(new Date(sb.time));
        sessionG.append('line')
          .attr('x1', x).attr('y1', 0)
          .attr('x2', x).attr('y2', innerHeight)
          .attr('stroke', '#475569')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '4,4')
          .attr('stroke-opacity', 0.3);
        sessionG.append('text')
          .attr('x', x + 4)
          .attr('y', 10)
          .attr('fill', 'var(--muted-foreground, #94a3b8)')
          .attr('font-size', '9px')
          .attr('fill-opacity', 0.5)
          .text(sb.slug.length > 12 ? sb.slug.slice(0, 10) + '…' : sb.slug);
      }

      // Ribbons
      const ribbonG = chartArea.append('g').attr('class', 'ribbons');
      for (let i = 0; i < sorted.length - 1; i++) {
        const cur = sorted[i];
        const next = sorted[i + 1];
        const curEnd = new Date(cur.endTime).getTime();
        const nextStart = new Date(next.startTime).getTime();
        const gap = nextStart - curEnd;

        if (gap > GAP_THRESHOLD_MS) {
          // Gap indicator
          const midX = (xS(new Date(cur.endTime)) + xS(new Date(next.startTime))) / 2;
          const midY = innerHeight / 2;
          ribbonG.append('text')
            .attr('class', 'gap-indicator')
            .attr('x', midX)
            .attr('y', midY)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('fill', 'var(--muted-foreground, #94a3b8)')
            .attr('font-size', '12px')
            .attr('fill-opacity', 0.5)
            .text('⋯');
          continue;
        }

        const fromCid = cur.clusterId ?? '__unclustered';
        const toCid = next.clusterId ?? '__unclustered';

        const x1 = xS(new Date(cur.endTime));
        const x2 = xS(new Date(next.startTime));
        const ribbonThickness = bandwidth * 0.5;

        if (fromCid === toCid) {
          // Same-cluster: flat horizontal band
          const yTop = (yScale(fromCid) ?? 0) + bandwidth * 0.25;
          ribbonG.append('rect')
            .attr('class', `ribbon ribbon-${i}`)
            .attr('x', Math.min(x1, x2))
            .attr('y', yTop)
            .attr('width', Math.max(1, Math.abs(x2 - x1)))
            .attr('height', ribbonThickness)
            .attr('fill', getColor(cur.clusterId))
            .attr('fill-opacity', 0.15);
        } else {
          // Cross-cluster: cubic bezier ribbon
          const y1Top = (yScale(fromCid) ?? 0) + bandwidth * 0.25;
          const y1Bot = y1Top + ribbonThickness;
          const y2Top = (yScale(toCid) ?? 0) + bandwidth * 0.25;
          const y2Bot = y2Top + ribbonThickness;
          const mx = (x1 + x2) / 2;

          const gradId = `grad-${fromCid}-${toCid}`.replace(/[^a-zA-Z0-9-]/g, '_');

          ribbonG.append('path')
            .attr('class', `ribbon ribbon-${i}`)
            .attr('d', [
              `M${x1},${y1Top}`,
              `C${mx},${y1Top} ${mx},${y2Top} ${x2},${y2Top}`,
              `L${x2},${y2Bot}`,
              `C${mx},${y2Bot} ${mx},${y1Bot} ${x1},${y1Bot}`,
              'Z',
            ].join(' '))
            .attr('fill', `url(#${gradId})`)
            .attr('stroke', 'none');
        }
      }

      // Chunks
      const chunkG = chartArea.append('g').attr('class', 'chunks');
      chunkG.selectAll('rect')
        .data(sorted)
        .join('rect')
        .attr('class', (_, i) => `chunk chunk-${i}`)
        .attr('x', (d) => xS(new Date(d.startTime)))
        .attr('y', (d) => {
          const cid = d.clusterId ?? '__unclustered';
          return (yScale(cid) ?? 0) + bandwidth * 0.15;
        })
        .attr('width', (d) => {
          const w = xS(new Date(d.endTime)) - xS(new Date(d.startTime));
          return Math.max(4, w);
        })
        .attr('height', bandwidth * 0.7)
        .attr('rx', 2)
        .attr('fill', (d) => getColor(d.clusterId))
        .attr('fill-opacity', (d) => d.id === selectedChunkId ? 1.0 : 0.7)
        .attr('stroke', (d) => d.id === selectedChunkId ? '#ffffff' : 'none')
        .attr('stroke-width', 2)
        .attr('cursor', 'pointer')
        .on('click', (_event, d) => onChunkClick(d.id))
        .on('mouseenter', function (_event, d) {
          const idx = sorted.indexOf(d);
          highlightChain(idx);
        })
        .on('mouseleave', function () {
          clearHighlight();
        });

      // Chunk tooltips
      chunkG.selectAll('rect')
        .append('title')
        .text((_: unknown, i: number) => {
          const d = sorted[i];
          const info = d.clusterId ? clusterMap.get(d.clusterId) : null;
          const cl = info?.name ?? (d.clusterId ? 'Unknown cluster' : 'Unclustered');
          return `${cl}\n${d.preview.slice(0, 100)}…\n${new Date(d.startTime).toLocaleString()}`;
        });
    }

    function highlightChain(centerIdx: number) {
      // Walk backward
      const highlighted = new Set<number>();
      highlighted.add(centerIdx);
      for (let i = centerIdx - 1; i >= 0 && highlighted.size < CHAIN_MAX; i--) {
        const gap = new Date(sorted[i + 1].startTime).getTime() - new Date(sorted[i].endTime).getTime();
        if (gap > GAP_THRESHOLD_MS) break;
        highlighted.add(i);
      }
      // Walk forward
      for (let i = centerIdx + 1; i < sorted.length && highlighted.size < CHAIN_MAX; i++) {
        const gap = new Date(sorted[i].startTime).getTime() - new Date(sorted[i - 1].endTime).getTime();
        if (gap > GAP_THRESHOLD_MS) break;
        highlighted.add(i);
      }

      // Dim everything
      chartArea.selectAll('.chunk').attr('fill-opacity', 0.1);
      chartArea.selectAll('.ribbon').attr('opacity', 0.1);
      chartArea.selectAll('.gap-indicator').attr('fill-opacity', 0.1);

      // Highlight chain
      for (const idx of highlighted) {
        chartArea.select(`.chunk-${idx}`).attr('fill-opacity', 1.0);
      }
      // Highlight ribbons between consecutive highlighted indices
      for (const idx of highlighted) {
        if (highlighted.has(idx + 1)) {
          chartArea.select(`.ribbon-${idx}`).attr('opacity', 1.0);
        }
      }
    }

    function clearHighlight() {
      chartArea.selectAll('.chunk')
        .attr('fill-opacity', (d: unknown) => (d as TimelineChunk).id === selectedChunkId ? 1.0 : 0.7);
      chartArea.selectAll('.ribbon').attr('opacity', 1.0);
      chartArea.selectAll('.gap-indicator').attr('fill-opacity', 0.5);
    }

    // Initial render
    renderContent(xScale);

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 20])
      .translateExtent([[-100, 0], [innerWidth + 100, height]])
      .on('zoom', (event) => {
        const newXScale = event.transform.rescaleX(xScale);
        xAxisG.call(d3.axisBottom(newXScale).ticks(8));
        renderContent(newXScale);
      });

    svg.call(zoom);

  }, [sorted, timeRange, onChunkClick, selectedChunkId, clusterOrder, clusterMap, colorIndex, clusterStats, sessionBoundaries]);

  return (
    <div className="w-full h-full flex flex-col">
      {/* Stats bar */}
      {sorted.length > 1 && (
        <div className="flex items-center gap-4 px-4 py-2 text-xs text-muted-foreground border-b border-border shrink-0">
          {stats.longestStreak && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/30 rounded">
              <span className="font-medium text-foreground">Longest streak:</span>
              <span className="tabular-nums">
                {stats.longestStreak.cluster} ({stats.longestStreak.count} chunks, {formatDuration(stats.longestStreak.durationMs)})
              </span>
            </div>
          )}
          <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/30 rounded">
            <span className="font-medium text-foreground">Most switches:</span>
            <span className="tabular-nums">
              {stats.mostSwitches ? `${stats.mostSwitches.from} ↔ ${stats.mostSwitches.to} (${stats.mostSwitches.count}×)` : '—'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/30 rounded">
            <span className="font-medium text-foreground">Focus:</span>
            <span className="tabular-nums">{Math.round(stats.focusScore * 100)}%</span>
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <svg ref={svgRef} className="w-full h-full" />
      </div>
    </div>
  );
}
