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
}

interface CompareResponse {
  vector: SearchResult[];
  keyword: SearchResult[];
  fused: SearchResult[];
}

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [searchUrl, setSearchUrl] = useState<string | null>(null);
  const { data, loading } = useApi<CompareResponse>(searchUrl);

  const handleSearch = useCallback((q: string) => {
    setQuery(q);
    if (q.trim()) {
      setSearchUrl(`/api/search/compare?q=${encodeURIComponent(q.trim())}`);
    } else {
      setSearchUrl(null);
    }
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold">Hybrid Search Pipeline</h1>
      <p className="text-muted-foreground">
        Compare vector, keyword (BM25), and fused (RRF) search results side by side.
      </p>

      <SearchInput onSearch={handleSearch} />

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-accent" />
          Searching...
        </div>
      )}

      {data && <PipelineComparison data={data} />}

      {!data && !loading && query && (
        <div className="text-muted-foreground">No results found.</div>
      )}
    </div>
  );
}
