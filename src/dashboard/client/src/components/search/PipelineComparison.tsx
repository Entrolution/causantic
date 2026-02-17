import { Badge } from '../ui/badge';

interface SearchResult {
  id: string;
  score: number;
  preview: string;
  sessionSlug: string;
  startTime: string;
  source?: 'vector' | 'keyword' | 'cluster';
}

interface SourceBreakdown {
  vector: number;
  keyword: number;
  cluster: number;
}

interface PipelineComparisonProps {
  data: {
    vector: SearchResult[];
    keyword: SearchResult[];
    fused: SearchResult[];
  };
  fullPipeline: SearchResult[];
  fullPipelineNoClusters?: SearchResult[];
  sourceBreakdown: SourceBreakdown;
}

const SOURCE_COLORS: Record<string, string> = {
  vector: '#8b5cf6',
  keyword: '#06b6d4',
  cluster: '#f59e0b',
};

function SourceBadge({ source }: { source: string }) {
  const color = SOURCE_COLORS[source] ?? '#6b7280';
  return (
    <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      {source}
    </Badge>
  );
}

function SourceBreakdownSummary({ breakdown }: { breakdown: SourceBreakdown }) {
  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap">
      {(['vector', 'keyword', 'cluster'] as const).map((key) => (
        <Badge key={key} variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: SOURCE_COLORS[key] }}
          />
          {breakdown[key]} {key}
        </Badge>
      ))}
    </div>
  );
}

function ResultColumn({
  title,
  results,
  color,
  allIds,
  showSourceBadge,
  header,
}: {
  title: string;
  results: SearchResult[];
  color: string;
  allIds: Set<string>;
  showSourceBadge?: boolean;
  header?: React.ReactNode;
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
      {header}
      <div className="space-y-2">
        {results.map((result, i) => {
          const sourceCount = getSourceCount(result.id);
          return (
            <div key={result.id} className="rounded-md border border-border p-3 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">#{i + 1}</span>
                <span className="text-xs tabular-nums font-mono" style={{ color }}>
                  {result.score.toFixed(4)}
                </span>
                {showSourceBadge && result.source && <SourceBadge source={result.source} />}
                {!showSourceBadge && sourceCount > 1 && (
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

export function PipelineComparison({
  data,
  fullPipeline,
  fullPipelineNoClusters,
  sourceBreakdown,
}: PipelineComparisonProps) {
  // Build lookup for "boosted" indicator
  const allIds = new Set<string>();
  data.vector.forEach((r) => allIds.add(`v:${r.id}`));
  data.keyword.forEach((r) => allIds.add(`k:${r.id}`));

  const hasNoClusters = fullPipelineNoClusters && fullPipelineNoClusters.length > 0;

  const gridClass = hasNoClusters
    ? 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5'
    : 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4';

  return (
    <div className={gridClass}>
      <ResultColumn title="Vector" results={data.vector} color="#8b5cf6" allIds={allIds} />
      <ResultColumn title="Keyword (BM25)" results={data.keyword} color="#06b6d4" allIds={allIds} />
      <ResultColumn title="Fused (RRF)" results={data.fused} color="#10b981" allIds={allIds} />
      <ResultColumn
        title="Full Pipeline (MMR)"
        results={fullPipeline}
        color="#f59e0b"
        allIds={allIds}
        showSourceBadge
        header={<SourceBreakdownSummary breakdown={sourceBreakdown} />}
      />
      {hasNoClusters && (
        <ResultColumn
          title="No Clusters"
          results={fullPipelineNoClusters}
          color="#6b7280"
          allIds={allIds}
          showSourceBadge
        />
      )}
    </div>
  );
}
