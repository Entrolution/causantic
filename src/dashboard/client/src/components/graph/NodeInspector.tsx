import { useApi } from '../../hooks/use-api';
import { Badge } from '../ui/badge';
import { X, Compass } from 'lucide-react';

interface GraphNode {
  id: string;
  label: string;
  project: string;
  cluster: string | null;
  degree: number;
  startTime: string | null;
}

interface EdgeData {
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
    weight: number;
    referenceType: string | null;
  }>;
  total: number;
}

interface NodeInspectorProps {
  node: GraphNode;
  onClose: () => void;
  onExploreNeighborhood: (nodeId: string) => void;
}

export function NodeInspector({ node, onClose, onExploreNeighborhood }: NodeInspectorProps) {
  const { data: edgeData } = useApi<EdgeData>(`/api/edges?chunkId=${node.id}&limit=20`);

  return (
    <div className="w-80 shrink-0 overflow-y-auto rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Node Inspector</h3>
        <button onClick={onClose} className="rounded p-1 hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2 text-sm">
        <div>
          <span className="text-muted-foreground">ID: </span>
          <code className="text-xs">{node.id.slice(0, 12)}...</code>
        </div>
        <div>
          <span className="text-muted-foreground">Project: </span>
          <Badge variant="secondary">{node.project}</Badge>
        </div>
        {node.cluster && (
          <div>
            <span className="text-muted-foreground">Cluster: </span>
            <Badge>{node.cluster.slice(0, 8)}</Badge>
          </div>
        )}
        <div>
          <span className="text-muted-foreground">Degree: </span>
          {node.degree}
        </div>
        {node.startTime && (
          <div>
            <span className="text-muted-foreground">Time: </span>
            {new Date(node.startTime).toLocaleString()}
          </div>
        )}
      </div>

      <div className="text-sm text-muted-foreground border-t border-border pt-3">
        <p className="line-clamp-4">{node.label}</p>
      </div>

      <button
        onClick={() => onExploreNeighborhood(node.id)}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted transition-colors"
      >
        <Compass className="h-4 w-4" />
        Explore Neighborhood
      </button>

      {edgeData && edgeData.edges.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Edges ({edgeData.total})</h4>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {edgeData.edges.map((edge) => (
              <div key={edge.id} className="flex items-center gap-2 text-xs">
                <Badge variant={edge.type === 'backward' ? 'default' : 'outline'} className="text-[10px]">
                  {edge.type}
                </Badge>
                {edge.referenceType && (
                  <span className="text-muted-foreground">{edge.referenceType}</span>
                )}
                <span className="ml-auto tabular-nums">{edge.weight.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
