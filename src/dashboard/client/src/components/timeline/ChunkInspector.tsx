import { useApi } from '../../hooks/use-api';
import { Badge } from '../ui/badge';
import { X, ArrowLeft, ArrowRight } from 'lucide-react';

interface ChunkDetail {
  id: string;
  sessionId: string;
  sessionSlug: string;
  startTime: string;
  endTime: string;
  content: string;
  approxTokens: number;
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

interface ChunkInspectorProps {
  chunkId: string;
  onClose: () => void;
  onWalkChain: (chunkId: string, direction: 'backward' | 'forward') => void;
}

export function ChunkInspector({ chunkId, onClose, onWalkChain }: ChunkInspectorProps) {
  const { data: chunkData } = useApi<{ chunks: ChunkDetail[] }>(`/api/chunks?chunkId=${chunkId}`);
  const { data: edgeData } = useApi<EdgeData>(`/api/edges?chunkId=${chunkId}&limit=20`);

  const chunk = chunkData?.chunks?.[0];

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Chunk Inspector</h3>
        <button onClick={onClose} className="rounded p-1 hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>

      {chunk ? (
        <div className="space-y-3 text-sm overflow-y-auto flex-1">
          <div className="space-y-1">
            <div>
              <span className="text-muted-foreground">ID: </span>
              <code className="text-xs">{chunk.id.slice(0, 12)}...</code>
            </div>
            <div>
              <span className="text-muted-foreground">Project: </span>
              <Badge variant="secondary">{chunk.sessionSlug}</Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Time: </span>
              {new Date(chunk.startTime).toLocaleString()}
            </div>
            <div>
              <span className="text-muted-foreground">Tokens: </span>
              {chunk.approxTokens}
            </div>
          </div>

          <div className="border-t border-border pt-2">
            <p className="text-xs text-muted-foreground line-clamp-6 whitespace-pre-wrap">
              {chunk.content.slice(0, 500)}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onWalkChain(chunkId, 'backward')}
              className="flex flex-1 items-center justify-center gap-1 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted transition-colors"
            >
              <ArrowLeft className="h-3 w-3" />
              Walk Backward
            </button>
            <button
              onClick={() => onWalkChain(chunkId, 'forward')}
              className="flex flex-1 items-center justify-center gap-1 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted transition-colors"
            >
              Walk Forward
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>

          {edgeData && edgeData.edges.length > 0 && (
            <div className="space-y-1 border-t border-border pt-2">
              <h4 className="text-xs font-medium">Edges ({edgeData.total})</h4>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {edgeData.edges.map((edge) => (
                  <div key={edge.id} className="flex items-center gap-2 text-[10px]">
                    <Badge
                      variant={edge.type === 'backward' ? 'default' : 'outline'}
                      className="text-[9px]"
                    >
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
      ) : (
        <p className="text-sm text-muted-foreground">Loading chunk...</p>
      )}
    </div>
  );
}
