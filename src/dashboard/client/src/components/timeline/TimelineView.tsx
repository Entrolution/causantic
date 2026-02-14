import { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import { CLUSTER_COLORS } from './ClusterLegend';

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

export interface ClusterInfo {
  id: string;
  name: string | null;
  description: string | null;
  memberCount: number;
}

interface TimelineViewProps {
  chunks: TimelineChunk[];
  edges: TimelineEdge[];
  timeRange: { earliest: string | null; latest: string | null };
  onChunkClick: (chunkId: string) => void;
  selectedChunkId: string | null;
  clusters?: ClusterInfo[];
}

export function TimelineView({ chunks, edges: _edges, timeRange, onChunkClick, selectedChunkId, clusters }: TimelineViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Build cluster lookup: id → sorted index + metadata
  const clusterIds = [...new Set(chunks.map((c) => c.clusterId).filter(Boolean))] as string[];
  const clusterMap = new Map((clusters ?? []).map((c) => [c.id, c]));

  // Sort clusters by member count (largest first) for consistent color assignment
  const sortedClusters = clusterIds
    .map((id) => ({ id, info: clusterMap.get(id) }))
    .sort((a, b) => (b.info?.memberCount ?? 0) - (a.info?.memberCount ?? 0));

  const colorIndex = new Map(sortedClusters.map((c, i) => [c.id, i]));

  function getColor(clusterId: string | null): string {
    if (!clusterId) return '#64748b';
    const idx = colorIndex.get(clusterId);
    if (idx === undefined) return '#64748b';
    return CLUSTER_COLORS[idx % CLUSTER_COLORS.length];
  }

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    if (chunks.length === 0 || !timeRange.earliest || !timeRange.latest) return;

    const container = svgRef.current?.parentElement;
    const width = container?.clientWidth ?? 800;
    const height = container?.clientHeight ?? 400;
    const margin = { top: 30, right: 30, bottom: 40, left: 160 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // Collect unique session slugs (grouped by project)
    const sessionSlugs = [...new Set(chunks.map((c) => c.sessionSlug))];

    // Scales
    const xScale = d3.scaleTime()
      .domain([new Date(timeRange.earliest!), new Date(timeRange.latest!)])
      .range([0, innerWidth]);

    const yScale = d3.scaleBand<string>()
      .domain(sessionSlugs)
      .range([0, innerHeight])
      .padding(0.3);

    // Container group with margins
    svg.attr('width', width).attr('height', height);

    // Clip path to constrain chunks/edges within chart area
    svg.append('defs')
      .append('clipPath')
      .attr('id', 'timeline-clip')
      .append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Zoom on X axis
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 20])
      .translateExtent([[-100, 0], [innerWidth + 100, height]])
      .on('zoom', (event) => {
        const newXScale = event.transform.rescaleX(xScale);
        xAxisG.call(d3.axisBottom(newXScale).ticks(8));

        // Update chunk positions
        chunkRects
          .attr('x', (d) => newXScale(new Date(d.startTime)))
          .attr('width', (d) => {
            const w = newXScale(new Date(d.endTime)) - newXScale(new Date(d.startTime));
            return Math.max(4, w);
          });
      });

    svg.call(zoom);

    // Draw axes
    const xAxisG = g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).ticks(8))
      .attr('class', 'timeline-axis');

    g.append('g')
      .call(d3.axisLeft(yScale))
      .attr('class', 'timeline-axis')
      .selectAll('text')
      .style('font-size', '11px');

    // Style axis lines
    g.selectAll('.timeline-axis line, .timeline-axis path')
      .attr('stroke', 'var(--border-color, #334155)');
    g.selectAll('.timeline-axis text')
      .attr('fill', 'var(--muted-foreground, #94a3b8)');

    // Clipped group for chart content
    const chartArea = g.append('g').attr('clip-path', 'url(#timeline-clip)');

    // Draw chunks
    const chunkRects = chartArea.append('g')
      .selectAll('rect')
      .data(chunks)
      .join('rect')
      .attr('x', (d) => xScale(new Date(d.startTime)))
      .attr('y', (d) => yScale(d.sessionSlug) ?? 0)
      .attr('width', (d) => {
        const w = xScale(new Date(d.endTime)) - xScale(new Date(d.startTime));
        return Math.max(4, w);
      })
      .attr('height', yScale.bandwidth())
      .attr('rx', 2)
      .attr('fill', (d) => getColor(d.clusterId))
      .attr('fill-opacity', (d) => d.id === selectedChunkId ? 1.0 : 0.7)
      .attr('stroke', (d) => d.id === selectedChunkId ? '#ffffff' : 'none')
      .attr('stroke-width', 2)
      .attr('cursor', 'pointer')
      .on('click', (_event, d) => onChunkClick(d.id))
      .on('mouseenter', function () {
        d3.select(this).attr('fill-opacity', 1.0);
      })
      .on('mouseleave', function (_event, d) {
        d3.select(this).attr('fill-opacity', d.id === selectedChunkId ? 1.0 : 0.7);
      });

    // Chunk tooltips — include cluster name
    chunkRects.append('title')
      .text((d) => {
        const info = d.clusterId ? clusterMap.get(d.clusterId) : null;
        const clusterLabel = info?.name ?? (d.clusterId ? 'Unknown cluster' : 'Unclustered');
        return `${d.sessionSlug}\n${clusterLabel}\n${d.preview.slice(0, 100)}...\n${new Date(d.startTime).toLocaleString()}`;
      });

  }, [chunks, timeRange, onChunkClick, selectedChunkId, clusters, sortedClusters, colorIndex, clusterMap]);

  return (
    <div className="w-full h-full">
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
}
