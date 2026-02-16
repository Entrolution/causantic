import { useApi } from '../../hooks/use-api';
import { Spinner } from '../ui/spinner';
import { Badge } from '../ui/badge';

interface ChainMeta {
  id: string;
  sessionSlug: string;
  sessionId: string;
  startTime: string;
  endTime: string;
  preview: string;
  approxTokens: number;
}

interface ChainResponse {
  seed: ChainMeta;
  chain: ChainMeta[];
  direction: string;
  totalTokens: number;
}

interface ChainViewProps {
  chunkId: string;
  direction: 'backward' | 'forward';
  onDirectionChange: (dir: 'backward' | 'forward') => void;
}

export function ChainView({ chunkId, direction, onDirectionChange }: ChainViewProps) {
  const { data, loading } = useApi<ChainResponse>(
    `/api/chain/walk?chunkId=${chunkId}&direction=${direction}`,
  );

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Chain Walk</h3>
        <div className="flex gap-1">
          <button
            onClick={() => onDirectionChange('backward')}
            className={`rounded px-2 py-1 text-xs transition-colors ${
              direction === 'backward'
                ? 'bg-accent/20 text-accent'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            Backward
          </button>
          <button
            onClick={() => onDirectionChange('forward')}
            className={`rounded px-2 py-1 text-xs transition-colors ${
              direction === 'forward'
                ? 'bg-accent/20 text-accent'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            Forward
          </button>
        </div>
      </div>

      {loading && <Spinner />}

      {data && data.chain.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No chain found — this chunk has no connected edges in the {direction} direction.
        </p>
      )}

      {data && (
        <div className="flex-1 overflow-y-auto space-y-2">
          {/* Seed chunk */}
          <ChainCard chunk={data.seed} position={0} total={data.chain.length + 1} isSeed />

          {/* Chain chunks */}
          {data.chain.map((chunk, i) => (
            <ChainCard
              key={chunk.id}
              chunk={chunk}
              position={i + 1}
              total={data.chain.length + 1}
            />
          ))}

          {data.chain.length > 0 && (
            <div className="text-xs text-muted-foreground pt-1">
              Total: {data.totalTokens.toLocaleString()} tokens
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChainCard({
  chunk,
  position,
  total,
  isSeed = false,
}: {
  chunk: ChainMeta;
  position: number;
  total: number;
  isSeed?: boolean;
}) {
  return (
    <div
      className={`rounded-md border p-3 text-sm space-y-1 ${
        isSeed ? 'border-accent bg-accent/5' : 'border-border bg-card'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isSeed && (
            <Badge variant="default" className="text-[10px]">
              Seed
            </Badge>
          )}
          <Badge variant="secondary" className="text-[10px]">
            {chunk.sessionSlug}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {position + 1}/{total}
        </span>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-3">{chunk.preview}</p>
      <div className="text-[10px] text-muted-foreground">
        {new Date(chunk.startTime).toLocaleString()} · {chunk.approxTokens} tokens
      </div>
    </div>
  );
}
