import { useRef, useEffect } from 'react';
import * as d3 from 'd3';

/**
 * Visualize the backward (linear, dies@10) and forward (delayed-linear, 5h hold, dies@20)
 * hop decay curves from ECM's decay.ts.
 */
export function DecayCurves() {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const container = svgRef.current.parentElement;
    if (!container) return;

    const width = container.clientWidth;
    const height = 200;
    const margin = { top: 20, right: 120, bottom: 40, left: 50 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    svg.attr('width', width).attr('height', height);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const maxHops = 25;
    const hops = d3.range(0, maxHops + 1);

    // Backward: linear decay, decayPerHop = 0.1, dies @ 10
    const backward = hops.map((h) => ({ hop: h, weight: Math.max(0, 1 - h * 0.1) }));

    // Forward: delayed-linear, holdHops=5, decayPerHop=0.067, dies @ ~20
    const forward = hops.map((h) => {
      if (h <= 5) return { hop: h, weight: 1 };
      return { hop: h, weight: Math.max(0, 1 - (h - 5) * 0.067) };
    });

    const x = d3.scaleLinear().domain([0, maxHops]).range([0, innerWidth]);
    const y = d3.scaleLinear().domain([0, 1.05]).range([innerHeight, 0]);

    const style = getComputedStyle(document.documentElement);
    const mutedFg = style.getPropertyValue('--muted-fg').trim() || '#94a3b8';
    const borderColor = style.getPropertyValue('--border-color').trim() || '#334155';

    // Axes
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(10))
      .attr('color', mutedFg);

    g.append('g').call(d3.axisLeft(y).ticks(5)).attr('color', mutedFg);

    // Axis labels
    g.append('text')
      .attr('x', innerWidth / 2)
      .attr('y', innerHeight + 35)
      .attr('text-anchor', 'middle')
      .attr('fill', mutedFg)
      .attr('font-size', 12)
      .text('Hops');

    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -innerHeight / 2)
      .attr('y', -35)
      .attr('text-anchor', 'middle')
      .attr('fill', mutedFg)
      .attr('font-size', 12)
      .text('Weight');

    const line = d3.line<{ hop: number; weight: number }>()
      .x((d) => x(d.hop))
      .y((d) => y(d.weight));

    // Backward curve
    g.append('path')
      .datum(backward)
      .attr('fill', 'none')
      .attr('stroke', '#06b6d4')
      .attr('stroke-width', 2)
      .attr('d', line);

    // Forward curve
    g.append('path')
      .datum(forward)
      .attr('fill', 'none')
      .attr('stroke', '#f59e0b')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6,3')
      .attr('d', line);

    // Legend
    const legend = g.append('g').attr('transform', `translate(${innerWidth + 10}, 10)`);

    legend
      .append('line')
      .attr('x1', 0).attr('y1', 0).attr('x2', 20).attr('y2', 0)
      .attr('stroke', '#06b6d4').attr('stroke-width', 2);
    legend
      .append('text')
      .attr('x', 25).attr('y', 4)
      .attr('fill', mutedFg).attr('font-size', 11)
      .text('Backward (linear)');

    legend
      .append('line')
      .attr('x1', 0).attr('y1', 20).attr('x2', 20).attr('y2', 20)
      .attr('stroke', '#f59e0b').attr('stroke-width', 2).attr('stroke-dasharray', '6,3');
    legend
      .append('text')
      .attr('x', 25).attr('y', 24)
      .attr('fill', mutedFg).attr('font-size', 11)
      .text('Forward (delayed)');
  }, []);

  return <svg ref={svgRef} className="w-full" />;
}
