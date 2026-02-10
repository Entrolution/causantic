import { Badge } from '../ui/badge';

interface SearchResult {
  id: string;
  score: number;
  preview: string;
  sessionSlug: string;
  startTime: string;
}

interface PipelineComparisonProps {
  data: {
    vector: SearchResult[];
    keyword: SearchResult[];
    fused: SearchResult[];
  };
}

function ResultColumn({ title, results, color, allIds }: {
  title: string;
  results: SearchResult[];
  color: string;
  allIds: Set<string>;
}) {
  // Count how many sources each result appears in
  const getSourceCount = (id: string) => {
    let count = 0;
    if (allIds.has(`v:${id}`)) count++;
    if (allIds.has(`k:${id}`)) count++;
    return count;
  };

  return (
    <div className="flex-1 min-w-0">
      <h3 className="mb-3 text-sm font-semibold" style={{ color }}>
        {title}
        <span className="ml-2 text-muted-foreground font-normal">({results.length})</span>
      </h3>
      <div className="space-y-2">
        {results.map((result, i) => {
          const sourceCount = getSourceCount(result.id);
          return (
            <div
              key={result.id}
              className="rounded-md border border-border p-3 space-y-1"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">#{i + 1}</span>
                <span className="text-xs tabular-nums font-mono" style={{ color }}>
                  {result.score.toFixed(4)}
                </span>
                {sourceCount > 1 && (
                  <Badge variant="default" className="text-[10px] px-1.5 py-0">
                    boosted
                  </Badge>
                )}
                <Badge variant="secondary" className="text-[10px] ml-auto">
                  {result.sessionSlug}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-3">{result.preview}</p>
            </div>
          );
        })}
        {results.length === 0 && (
          <div className="text-sm text-muted-foreground italic">No results</div>
        )}
      </div>
    </div>
  );
}

export function PipelineComparison({ data }: PipelineComparisonProps) {
  // Build lookup for "boosted" indicator
  const allIds = new Set<string>();
  data.vector.forEach((r) => allIds.add(`v:${r.id}`));
  data.keyword.forEach((r) => allIds.add(`k:${r.id}`));

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <ResultColumn title="Vector" results={data.vector} color="#8b5cf6" allIds={allIds} />
      <ResultColumn title="Keyword (BM25)" results={data.keyword} color="#06b6d4" allIds={allIds} />
      <ResultColumn title="Fused (RRF)" results={data.fused} color="#10b981" allIds={allIds} />
    </div>
  );
}
