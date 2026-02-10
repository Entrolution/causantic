import { useApi } from '../hooks/use-api';
import { Spinner } from '../components/ui/spinner';
import { ClusterBubbles } from '../components/clusters/ClusterBubbles';
import { ClusterCard } from '../components/clusters/ClusterCard';

interface ClusterData {
  id: string;
  name: string | null;
  description: string | null;
  memberCount: number;
  exemplarPreviews: Array<{ id: string; preview: string }>;
}

interface ClustersResponse {
  clusters: ClusterData[];
}

export function Clusters() {
  const { data, loading } = useApi<ClustersResponse>('/api/clusters');

  if (loading || !data) return <Spinner />;

  const clusters = data.clusters;

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold">Clusters</h1>

      {clusters.length === 0 ? (
        <div className="text-muted-foreground">No clusters found. Run clustering first.</div>
      ) : (
        <>
          {/* Bubble chart */}
          <div className="rounded-lg border border-border bg-card p-4" style={{ height: 400 }}>
            <ClusterBubbles clusters={clusters} />
          </div>

          {/* Card grid */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {clusters.map((cluster) => (
              <ClusterCard key={cluster.id} cluster={cluster} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
