import { useApi } from '../hooks/use-api';
import { Spinner } from '../components/ui/spinner';
import { StatCard } from '../components/stats/StatCard';
import { TimeSeries } from '../components/stats/TimeSeries';
import { ToolUsageChart } from '../components/stats/ToolUsageChart';
import { SizeDistribution } from '../components/stats/SizeDistribution';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Boxes, GitBranch, Layers, Clock, Activity, Search, Wrench } from 'lucide-react';

interface AnalyticsData {
  toolUsage: Array<{ tool: string; count: number }>;
  retrievalTimeSeries: Array<{ week: string; count: number }>;
  topChunks: Array<{
    chunkId: string;
    count: number;
    project: string;
    tokens: number;
    preview: string;
  }>;
  projectRetrievals: Array<{ project: string; retrievals: number; uniqueQueries: number }>;
  sizeDistribution: Array<{ bucket: string; count: number }>;
  totalRetrievals: number;
}

interface StatsData {
  chunks: number;
  edges: number;
  clusters: number;
  sessions: number;
  projects: number;
  chunkTimeSeries: Array<{ week: string; count: number }>;
  analytics: AnalyticsData;
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

      {/* Retrieval analytics — only shown when feedback data exists */}
      {stats.analytics.totalRetrievals > 0 && (
        <>
          <h2 className="text-xl font-bold">Retrieval Analytics</h2>

          {/* Analytics stat cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Total Retrievals"
              value={stats.analytics.totalRetrievals}
              icon={<Activity className="h-5 w-5" />}
            />
            <StatCard
              label="Unique Queries"
              value={stats.analytics.projectRetrievals.reduce((sum, p) => sum + p.uniqueQueries, 0)}
              icon={<Search className="h-5 w-5" />}
            />
            <StatCard
              label={
                stats.analytics.toolUsage[0]?.tool
                  ? `Top Tool: ${stats.analytics.toolUsage[0].tool}`
                  : 'Top Tool'
              }
              value={stats.analytics.toolUsage[0]?.count ?? 0}
              icon={<Wrench className="h-5 w-5" />}
            />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {stats.analytics.toolUsage.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Tool Usage</CardTitle>
                </CardHeader>
                <CardContent>
                  <ToolUsageChart data={stats.analytics.toolUsage} />
                </CardContent>
              </Card>
            )}

            {stats.analytics.retrievalTimeSeries.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Retrievals Over Time</CardTitle>
                </CardHeader>
                <CardContent>
                  <TimeSeries data={stats.analytics.retrievalTimeSeries} />
                </CardContent>
              </Card>
            )}
          </div>

          {/* Chunk size distribution */}
          {stats.analytics.sizeDistribution.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Chunk Size Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <SizeDistribution data={stats.analytics.sizeDistribution} />
              </CardContent>
            </Card>
          )}

          {/* Top retrieved chunks table */}
          {stats.analytics.topChunks.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Top Retrieved Chunks</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground w-8">
                          #
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Project
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Preview
                        </th>
                        <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                          Tokens
                        </th>
                        <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                          Retrieved
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.analytics.topChunks.map((chunk, i) => (
                        <tr
                          key={chunk.chunkId}
                          className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors"
                        >
                          <td className="px-4 py-3 text-muted-foreground">{i + 1}</td>
                          <td className="px-4 py-3">
                            <Badge variant="secondary">{chunk.project}</Badge>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground truncate max-w-[300px]">
                            {chunk.preview}
                          </td>
                          <td className="px-4 py-3 text-right text-muted-foreground">
                            {chunk.tokens.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Badge variant="secondary">{chunk.count}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
