import { useRef, useEffect } from 'react';
import * as d3 from 'd3';

interface TimeSeriesProps {
  data: Array<{ week: string; count: number }>;
}

export function TimeSeries({ data }: TimeSeriesProps) {
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

    const parseDate = d3.timeParse('%Y-%m-%d');
    const parsed = data.map((d) => ({
      date: parseDate(d.week)!,
      count: d.count,
    }));

    const x = d3
      .scaleTime()
      .domain(d3.extent(parsed, (d) => d.date) as [Date, Date])
      .range([0, innerWidth]);

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(parsed, (d) => d.count) ?? 0])
      .nice()
      .range([innerHeight, 0]);

    // Get CSS variables for theming
    const style = getComputedStyle(document.documentElement);
    const mutedFg = style.getPropertyValue('--muted-fg').trim() || '#94a3b8';
    const accentColor = style.getPropertyValue('--accent-color').trim() || '#10b981';
    const borderColor = style.getPropertyValue('--border-color').trim() || '#334155';

    // X axis
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat('%b %y') as (d: Date | d3.NumberValue) => string))
      .attr('color', mutedFg)
      .selectAll('line')
      .attr('stroke', borderColor);

    // Y axis
    g.append('g')
      .call(d3.axisLeft(y).ticks(5))
      .attr('color', mutedFg)
      .selectAll('line')
      .attr('stroke', borderColor);

    // Area
    const area = d3
      .area<{ date: Date; count: number }>()
      .x((d) => x(d.date))
      .y0(innerHeight)
      .y1((d) => y(d.count))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(parsed)
      .attr('fill', accentColor)
      .attr('fill-opacity', 0.15)
      .attr('d', area);

    // Line
    const line = d3
      .line<{ date: Date; count: number }>()
      .x((d) => x(d.date))
      .y((d) => y(d.count))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(parsed)
      .attr('fill', 'none')
      .attr('stroke', accentColor)
      .attr('stroke-width', 2)
      .attr('d', line);
  }, [data]);

  return <svg ref={svgRef} className="w-full" />;
}
