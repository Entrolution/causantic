import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';

interface GraphNode {
  id: string;
  label: string;
  project: string;
  cluster: string | null;
  degree: number;
  startTime: string | null;
  root?: boolean;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  weight: number;
  referenceType?: string | null;
}

interface ForceGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick: (node: GraphNode) => void;
  selectedNodeId: string | null;
  onSvgRef?: (el: SVGSVGElement | null) => void;
}

// Color palette for clusters
const CLUSTER_COLORS = [
  '#10b981', '#06b6d4', '#8b5cf6', '#f59e0b', '#ef4444',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
  '#0ea5e9', '#d946ef', '#22c55e', '#eab308', '#a855f7',
];

function getClusterColor(clusterId: string | null, clusterIds: string[]): string {
  if (!clusterId) return '#64748b';
  const idx = clusterIds.indexOf(clusterId);
  return CLUSTER_COLORS[idx % CLUSTER_COLORS.length];
}

export function ForceGraph({ nodes, edges, onNodeClick, selectedNodeId, onSvgRef }: ForceGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);

  useEffect(() => {
    if (onSvgRef) onSvgRef(svgRef.current);
    return () => { if (onSvgRef) onSvgRef(null); };
  }, [onSvgRef]);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const container = svgRef.current.parentElement;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight || 600;

    svg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);

    // Get unique cluster IDs for coloring
    const clusterIds = [...new Set(nodes.map((n) => n.cluster).filter(Boolean))] as string[];

    // Size scale based on degree
    const maxDegree = Math.max(...nodes.map((n) => n.degree), 1);
    const sizeScale = d3.scaleSqrt().domain([0, maxDegree]).range([4, 20]);

    // Copy data to avoid mutating props
    const nodesCopy: GraphNode[] = nodes.map((n) => ({ ...n }));
    const edgesCopy: GraphEdge[] = edges.map((e) => ({ ...e }));

    // Create container group for zoom
    const g = svg.append('g');

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Draw edges
    const edgeSelection = g
      .append('g')
      .selectAll('line')
      .data(edgesCopy)
      .join('line')
      .attr('stroke', '#475569')
      .attr('stroke-opacity', (d) => Math.max(0.1, d.weight * 0.6))
      .attr('stroke-width', (d) => Math.max(0.5, d.weight * 2))
      .attr('stroke-dasharray', (d) => (d.type === 'forward' ? '4,3' : 'none'));

    // Draw nodes
    const nodeSelection = g
      .append('g')
      .selectAll('circle')
      .data(nodesCopy)
      .join('circle')
      .attr('r', (d) => sizeScale(d.degree))
      .attr('fill', (d) => getClusterColor(d.cluster, clusterIds))
      .attr('fill-opacity', 0.8)
      .attr('stroke', (d) => (d.root ? '#ffffff' : 'none'))
      .attr('stroke-width', (d) => (d.root ? 3 : 0))
      .attr('cursor', 'pointer')
      .on('click', (_event, d) => onNodeClick(d));

    // Tooltips
    nodeSelection.append('title').text((d) => `${d.label}\nProject: ${d.project}\nDegree: ${d.degree}`);

    // Drag behavior
    const drag = d3.drag<SVGCircleElement, GraphNode>()
      .on('start', (event, d) => {
        if (!event.active) simulationRef.current?.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulationRef.current?.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    nodeSelection.call(drag);

    // Force simulation
    const simulation = d3
      .forceSimulation(nodesCopy)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphEdge>(edgesCopy)
          .id((d) => d.id)
          .distance(60)
          .strength((d) => d.weight * 0.3),
      )
      .force('charge', d3.forceManyBody().strength(-120))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<GraphNode>().radius((d) => sizeScale(d.degree) + 2))
      .on('tick', () => {
        edgeSelection
          .attr('x1', (d) => (d.source as GraphNode).x ?? 0)
          .attr('y1', (d) => (d.source as GraphNode).y ?? 0)
          .attr('x2', (d) => (d.target as GraphNode).x ?? 0)
          .attr('y2', (d) => (d.target as GraphNode).y ?? 0);

        nodeSelection.attr('cx', (d) => d.x ?? 0).attr('cy', (d) => d.y ?? 0);
      });

    simulationRef.current = simulation;

    // Highlight selected node
    if (selectedNodeId) {
      nodeSelection
        .attr('fill-opacity', (d) => (d.id === selectedNodeId ? 1 : 0.3))
        .attr('stroke', (d) => (d.id === selectedNodeId ? '#ffffff' : 'none'))
        .attr('stroke-width', (d) => (d.id === selectedNodeId ? 2 : 0));
    }

    return () => {
      simulation.stop();
    };
  }, [nodes, edges, selectedNodeId, onNodeClick]);

  return <svg ref={svgRef} className="w-full h-full" />;
}
