import { useState, useCallback } from 'react';
import { useApi } from '../hooks/use-api';
import { Spinner } from '../components/ui/spinner';
import { Select } from '../components/ui/select';
import { TimelineView, ClusterInfo } from '../components/timeline/TimelineView';
import { TopicFlowView } from '../components/timeline/TopicFlowView';
import { ClusterLegend } from '../components/timeline/ClusterLegend';
import { ChunkInspector } from '../components/timeline/ChunkInspector';
import { ChainView } from '../components/timeline/ChainView';

interface ProjectsResponse {
  projects: Array<{ slug: string; chunkCount: number }>;
}

interface ClustersResponse {
  clusters: ClusterInfo[];
}

interface TimelineChunk {
  id: string;
  startTime: string;
  endTime: string;
  sessionSlug: string;
  sessionId: string;
  preview: string;
  approxTokens: number;
  clusterId: string | null;
}

interface TimelineEdge {
  sourceId: string;
  targetId: string;
  referenceType: string | null;
}

interface TimelineData {
  chunks: TimelineChunk[];
  edges: TimelineEdge[];
  timeRange: { earliest: string | null; latest: string | null };
}

export function Timeline() {
  const [project, setProject] = useState('');
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null);
  const [chainChunkId, setChainChunkId] = useState<string | null>(null);
  const [chainDirection, setChainDirection] = useState<'backward' | 'forward'>('backward');

  const { data: projectsData } = useApi<ProjectsResponse>('/api/projects');
  const { data: clustersData } = useApi<ClustersResponse>('/api/clusters');

  const timelineUrl = `/api/timeline?limit=500${project ? `&project=${project}` : ''}`;
  const { data: timelineData, loading } = useApi<TimelineData>(timelineUrl);

  const projectOptions = (projectsData?.projects ?? []).map((p) => ({
    value: p.slug,
    label: `${p.slug} (${p.chunkCount})`,
  }));

  const handleChunkClick = useCallback((chunkId: string) => {
    setSelectedChunkId(chunkId);
  }, []);

  const handleWalkChain = useCallback((chunkId: string, direction: 'backward' | 'forward') => {
    setChainChunkId(chunkId);
    setChainDirection(direction);
  }, []);

  const showBottomPanel = selectedChunkId || chainChunkId;

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Timeline</h1>
        <Select
          value={project}
          onChange={(e) => {
            setProject(e.target.value);
            setSelectedChunkId(null);
            setChainChunkId(null);
          }}
          options={projectOptions}
          placeholder="All projects"
          className="w-60"
        />
      </div>

      {/* Cluster legend */}
      {clustersData && timelineData && timelineData.chunks.length > 0 && (
        <ClusterLegend
          clusters={clustersData.clusters}
          activeClusterIds={
            [...new Set(timelineData.chunks.map((c) => c.clusterId).filter(Boolean))] as string[]
          }
          unclusteredCount={timelineData.chunks.filter((c) => !c.clusterId).length}
        />
      )}

      {/* Timeline visualization */}
      <div
        className={`rounded-lg border border-border bg-card overflow-hidden relative ${
          showBottomPanel ? 'flex-1 min-h-[200px]' : 'flex-1'
        }`}
      >
        {loading ? (
          <Spinner />
        ) : timelineData && timelineData.chunks.length > 0 ? (
          project ? (
            <TopicFlowView
              chunks={timelineData.chunks}
              edges={timelineData.edges}
              timeRange={timelineData.timeRange}
              onChunkClick={handleChunkClick}
              selectedChunkId={selectedChunkId}
              clusters={clustersData?.clusters}
            />
          ) : (
            <TimelineView
              chunks={timelineData.chunks}
              edges={timelineData.edges}
              timeRange={timelineData.timeRange}
              onChunkClick={handleChunkClick}
              selectedChunkId={selectedChunkId}
              clusters={clustersData?.clusters}
            />
          )
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            No timeline data available
          </div>
        )}
      </div>

      {/* Bottom panel: Inspector + Chain */}
      {showBottomPanel && (
        <div className="flex gap-4 h-72 min-h-[200px]">
          {selectedChunkId && (
            <div className="w-80 shrink-0 rounded-lg border border-border bg-card p-4 overflow-y-auto">
              <ChunkInspector
                chunkId={selectedChunkId}
                onClose={() => setSelectedChunkId(null)}
                onWalkChain={handleWalkChain}
              />
            </div>
          )}

          {chainChunkId && (
            <div className="flex-1 rounded-lg border border-border bg-card p-4 overflow-y-auto">
              <ChainView
                chunkId={chainChunkId}
                direction={chainDirection}
                onDirectionChange={setChainDirection}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
