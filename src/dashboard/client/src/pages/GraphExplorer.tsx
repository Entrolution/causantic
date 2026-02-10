import { useState, useCallback } from 'react';
import { useApi } from '../hooks/use-api';
import { Spinner } from '../components/ui/spinner';
import { ForceGraph } from '../components/graph/ForceGraph';
import { GraphControls } from '../components/graph/GraphControls';
import { NodeInspector } from '../components/graph/NodeInspector';
import { DecayCurves } from '../components/graph/DecayCurves';
import { ExportButton } from '../components/graph/ExportButton';

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
}

interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  weight: number;
  referenceType?: string | null;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function GraphExplorer() {
  const [project, setProject] = useState('');
  const [limit, setLimit] = useState(300);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [neighborhoodId, setNeighborhoodId] = useState<string | null>(null);
  const [showDecay, setShowDecay] = useState(false);
  const [graphRef, setGraphRef] = useState<SVGSVGElement | null>(null);

  const graphUrl = neighborhoodId
    ? `/api/graph/neighborhood?chunkId=${neighborhoodId}&hops=2`
    : `/api/graph?limit=${limit}${project ? `&project=${project}` : ''}`;

  const { data, loading } = useApi<GraphData>(graphUrl);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
  }, []);

  const handleExploreNeighborhood = useCallback((nodeId: string) => {
    setNeighborhoodId(nodeId);
    setSelectedNode(null);
  }, []);

  const handleBackToFull = useCallback(() => {
    setNeighborhoodId(null);
    setSelectedNode(null);
  }, []);

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Graph Explorer</h1>
          {neighborhoodId && (
            <button
              onClick={handleBackToFull}
              className="rounded-md border border-border px-3 py-1 text-sm hover:bg-muted transition-colors"
            >
              Back to full graph
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ExportButton svgRef={graphRef} />
          <button
            onClick={() => setShowDecay(!showDecay)}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted transition-colors"
          >
            {showDecay ? 'Hide' : 'Show'} Decay Curves
          </button>
        </div>
      </div>

      <GraphControls
        project={project}
        onProjectChange={setProject}
        limit={limit}
        onLimitChange={setLimit}
      />

      <div className="flex flex-1 gap-4 min-h-0">
        <div className="flex-1 rounded-lg border border-border bg-card overflow-hidden relative">
          {loading ? (
            <Spinner />
          ) : data ? (
            <ForceGraph
              nodes={data.nodes}
              edges={data.edges}
              onNodeClick={handleNodeClick}
              selectedNodeId={selectedNode?.id ?? null}
              onSvgRef={setGraphRef}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              No graph data available
            </div>
          )}
        </div>

        {selectedNode && (
          <NodeInspector
            node={selectedNode}
            onClose={() => setSelectedNode(null)}
            onExploreNeighborhood={handleExploreNeighborhood}
          />
        )}
      </div>

      {showDecay && (
        <div className="rounded-lg border border-border bg-card p-4">
          <DecayCurves />
        </div>
      )}
    </div>
  );
}
