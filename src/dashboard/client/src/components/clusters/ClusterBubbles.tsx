import { useRef, useEffect } from 'react';
import * as d3 from 'd3';

interface ClusterData {
  id: string;
  name: string | null;
  memberCount: number;
}

interface ClusterBubblesProps {
  clusters: ClusterData[];
}

const COLORS = [
  '#10b981', '#06b6d4', '#8b5cf6', '#f59e0b', '#ef4444',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
  '#0ea5e9', '#d946ef', '#22c55e', '#eab308', '#a855f7',
];

export function ClusterBubbles({ clusters }: ClusterBubblesProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || clusters.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const container = svgRef.current.parentElement;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight || 360;

    svg.attr('width', width).attr('height', height);

    const pack = d3
      .pack<ClusterData>()
      .size([width, height])
      .padding(6);

    const root = d3
      .hierarchy<{ children: ClusterData[] }>({ children: clusters })
      .sum((d) => ('memberCount' in d ? (d as ClusterData).memberCount : 0));

    const packed = pack(root as d3.HierarchyNode<ClusterData>);

    const style = getComputedStyle(document.documentElement);
    const fg = style.getPropertyValue('--fg').trim() || '#e2e8f0';

    const node = svg
      .selectAll('g')
      .data(packed.leaves())
      .join('g')
      .attr('transform', (d) => `translate(${d.x},${d.y})`);

    node
      .append('circle')
      .attr('r', (d) => d.r)
      .attr('fill', (_, i) => COLORS[i % COLORS.length])
      .attr('fill-opacity', 0.7)
      .attr('stroke', (_, i) => COLORS[i % COLORS.length])
      .attr('stroke-width', 1);

    // Label (only for circles large enough)
    node
      .filter((d) => d.r > 30)
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '-0.3em')
      .attr('fill', fg)
      .attr('font-size', (d) => Math.min(14, d.r / 3))
      .attr('font-weight', 600)
      .text((d) => (d.data as ClusterData).name?.slice(0, 20) ?? (d.data as ClusterData).id.slice(0, 8));

    node
      .filter((d) => d.r > 30)
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '1.1em')
      .attr('fill', fg)
      .attr('fill-opacity', 0.7)
      .attr('font-size', (d) => Math.min(11, d.r / 4))
      .text((d) => `${(d.data as ClusterData).memberCount} chunks`);

    // Tooltips
    node.append('title').text((d) => {
      const data = d.data as ClusterData;
      return `${data.name ?? data.id}\n${data.memberCount} chunks`;
    });
  }, [clusters]);

  return <svg ref={svgRef} className="w-full h-full" />;
}
