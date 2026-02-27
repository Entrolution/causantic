import { useRef, useEffect } from 'react';
import * as d3 from 'd3';

interface ToolUsageChartProps {
  data: Array<{ tool: string; count: number }>;
}

export function ToolUsageChart({ data }: ToolUsageChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const container = svgRef.current.parentElement;
    if (!container) return;

    const barHeight = 32;
    const gap = 8;
    const margin = { top: 10, right: 60, bottom: 10, left: 120 };
    const width = container.clientWidth;
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = data.length * (barHeight + gap) - gap;
    const height = innerHeight + margin.top + margin.bottom;

    svg.attr('width', width).attr('height', height);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleLinear()
      .domain([0, d3.max(data, (d) => d.count) ?? 1])
      .range([0, innerWidth]);

    const y = d3
      .scaleBand()
      .domain(data.map((d) => d.tool))
      .range([0, innerHeight])
      .padding(gap / (barHeight + gap));

    const style = getComputedStyle(document.documentElement);
    const accentColor = style.getPropertyValue('--accent-color').trim() || '#10b981';
    const mutedFg = style.getPropertyValue('--muted-fg').trim() || '#94a3b8';

    // Bars
    g.selectAll('rect')
      .data(data)
      .enter()
      .append('rect')
      .attr('x', 0)
      .attr('y', (d) => y(d.tool)!)
      .attr('width', (d) => x(d.count))
      .attr('height', y.bandwidth())
      .attr('fill', accentColor)
      .attr('rx', 4);

    // Tool labels (left)
    g.selectAll('.label')
      .data(data)
      .enter()
      .append('text')
      .attr('x', -8)
      .attr('y', (d) => y(d.tool)! + y.bandwidth() / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'central')
      .attr('fill', mutedFg)
      .attr('font-size', '12px')
      .text((d) => d.tool);

    // Count labels (right of bar)
    g.selectAll('.count')
      .data(data)
      .enter()
      .append('text')
      .attr('x', (d) => x(d.count) + 6)
      .attr('y', (d) => y(d.tool)! + y.bandwidth() / 2)
      .attr('dominant-baseline', 'central')
      .attr('fill', mutedFg)
      .attr('font-size', '12px')
      .text((d) => d.count.toLocaleString());
  }, [data]);

  return <svg ref={svgRef} className="w-full" />;
}
