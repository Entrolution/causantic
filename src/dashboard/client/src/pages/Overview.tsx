import { useApi } from '../hooks/use-api';
import { Spinner } from '../components/ui/spinner';
import { StatCard } from '../components/stats/StatCard';
import { TimeSeries } from '../components/stats/TimeSeries';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Boxes, GitBranch, Layers, Clock } from 'lucide-react';

interface StatsData {
  chunks: number;
  edges: number;
  clusters: number;
  sessions: number;
  projects: number;
  chunkTimeSeries: Array<{ week: string; count: number }>;
}

interface ChunksData {
  chunks: Array<{
    id: string;
    sessionSlug: string;
    startTime: string;
    preview: string;
    tokenCount: number;
  }>;
}

export function Overview() {
  const { data: stats, loading } = useApi<StatsData>('/api/stats');
  const { data: recent } = useApi<ChunksData>('/api/chunks?limit=10');

  if (loading || !stats) return <Spinner />;

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold">Overview</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Chunks" value={stats.chunks} icon={<Layers className="h-5 w-5" />} />
        <StatCard label="Edges" value={stats.edges} icon={<GitBranch className="h-5 w-5" />} />
        <StatCard label="Clusters" value={stats.clusters} icon={<Boxes className="h-5 w-5" />} />
        <StatCard label="Sessions" value={stats.sessions} icon={<Clock className="h-5 w-5" />} />
      </div>

      {/* Time series */}
      {stats.chunkTimeSeries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Chunks Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <TimeSeries data={stats.chunkTimeSeries} />
          </CardContent>
        </Card>
      )}

      {/* Recent activity */}
      {recent?.chunks && recent.chunks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recent.chunks.map((chunk) => (
                <div
                  key={chunk.id}
                  className="flex items-start gap-3 rounded-md border border-border p-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="secondary">{chunk.sessionSlug}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(chunk.startTime).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{chunk.preview}</p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {chunk.tokenCount} tokens
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
