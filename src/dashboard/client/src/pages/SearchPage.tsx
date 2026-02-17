import { useState, useCallback, useRef } from 'react';
import { useApi } from '../hooks/use-api';
import { SearchInput } from '../components/search/SearchInput';
import { PipelineComparison } from '../components/search/PipelineComparison';

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

interface CompareResponse {
  vector: SearchResult[];
  keyword: SearchResult[];
  fused: SearchResult[];
  fullPipeline: SearchResult[];
  fullPipelineNoClusters?: SearchResult[];
  sourceBreakdown: SourceBreakdown;
}

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [skipClusters, setSkipClusters] = useState(false);
  const [searchUrl, setSearchUrl] = useState<string | null>(null);
  const { data, loading } = useApi<CompareResponse>(searchUrl);

  const lastQueryRef = useRef('');

  const handleSearch = useCallback(
    (q: string) => {
      setQuery(q);
      lastQueryRef.current = q;
      if (q.trim()) {
        const params = new URLSearchParams({ q: q.trim() });
        if (skipClusters) params.set('skipClusters', 'true');
        setSearchUrl(`/api/search/compare?${params.toString()}`);
      } else {
        setSearchUrl(null);
      }
    },
    [skipClusters],
  );

  const handleToggleSkipClusters = useCallback(() => {
    setSkipClusters((prev) => {
      const next = !prev;
      if (lastQueryRef.current.trim()) {
        const params = new URLSearchParams({ q: lastQueryRef.current.trim() });
        if (next) params.set('skipClusters', 'true');
        setSearchUrl(`/api/search/compare?${params.toString()}`);
      }
      return next;
    });
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold">Hybrid Search Pipeline</h1>
      <p className="text-muted-foreground">
        Compare vector, keyword (BM25), fused (RRF), and full pipeline (clusters + MMR) search
        results side by side.
      </p>

      <div className="flex items-center gap-4">
        <SearchInput onSearch={handleSearch} />
        <label className="flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap cursor-pointer">
          <input
            type="checkbox"
            checked={skipClusters}
            onChange={handleToggleSkipClusters}
            className="rounded border-border"
          />
          Skip clusters (A/B)
        </label>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-accent" />
          Searching...
        </div>
      )}

      {data && (
        <PipelineComparison
          data={data}
          fullPipeline={data.fullPipeline}
          fullPipelineNoClusters={data.fullPipelineNoClusters}
          sourceBreakdown={data.sourceBreakdown}
        />
      )}

      {!data && !loading && query && <div className="text-muted-foreground">No results found.</div>}
    </div>
  );
}
