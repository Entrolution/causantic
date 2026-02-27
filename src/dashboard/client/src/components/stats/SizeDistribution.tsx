import { useRef, useEffect } from 'react';
import * as d3 from 'd3';

interface SizeDistributionProps {
  data: Array<{ bucket: string; count: number }>;
}

export function SizeDistribution({ data }: SizeDistributionProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const container = svgRef.current.parentElement;
    if (!container) return;

    const width = container.clientWidth;
    const height = 250;
    const margin = { top: 20, right: 20, bottom: 40, left: 50 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    svg.attr('width', width).attr('height', height);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleBand()
      .domain(data.map((d) => d.bucket))
      .range([0, innerWidth])
      .padding(0.2);

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(data, (d) => d.count) ?? 1])
      .nice()
      .range([innerHeight, 0]);

    const style = getComputedStyle(document.documentElement);
    const accentColor = style.getPropertyValue('--accent-color').trim() || '#10b981';
    const mutedFg = style.getPropertyValue('--muted-fg').trim() || '#94a3b8';
    const borderColor = style.getPropertyValue('--border-color').trim() || '#334155';

    // X axis
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x))
      .attr('color', mutedFg)
      .selectAll('line')
      .attr('stroke', borderColor);

    // Y axis
    g.append('g')
      .call(d3.axisLeft(y).ticks(5))
      .attr('color', mutedFg)
      .selectAll('line')
      .attr('stroke', borderColor);

    // Bars
    g.selectAll('rect')
      .data(data)
      .enter()
      .append('rect')
      .attr('x', (d) => x(d.bucket)!)
      .attr('y', (d) => y(d.count))
      .attr('width', x.bandwidth())
      .attr('height', (d) => innerHeight - y(d.count))
      .attr('fill', accentColor)
      .attr('rx', 3);

    // Count labels on top of bars
    g.selectAll('.bar-label')
      .data(data)
      .enter()
      .append('text')
      .attr('x', (d) => x(d.bucket)! + x.bandwidth() / 2)
      .attr('y', (d) => y(d.count) - 5)
      .attr('text-anchor', 'middle')
      .attr('fill', mutedFg)
      .attr('font-size', '11px')
      .text((d) => (d.count > 0 ? d.count.toLocaleString() : ''));
  }, [data]);

  return <svg ref={svgRef} className="w-full" />;
}
