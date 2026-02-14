import { useState, useRef } from 'react';
import type { ClusterInfo } from './TimelineView';

const CLUSTER_COLORS = [
  '#10b981', '#06b6d4', '#8b5cf6', '#f59e0b', '#ef4444',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
  '#0ea5e9', '#d946ef', '#22c55e', '#eab308', '#a855f7',
];

interface ClusterLegendProps {
  clusters: ClusterInfo[];
  /** Cluster IDs present in the current timeline view, sorted by member count */
  activeClusterIds: string[];
  unclusteredCount: number;
}

interface TooltipState {
  visible: boolean;
  cluster: ClusterInfo | null;
  anchorRect: DOMRect | null;
}

export function ClusterLegend({ clusters, activeClusterIds, unclusteredCount }: ClusterLegendProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, cluster: null, anchorRect: null });

  const clusterMap = new Map(clusters.map((c) => [c.id, c]));

  // Sort by member count descending, only show clusters present in the timeline
  const sorted = activeClusterIds
    .map((id) => ({ id, info: clusterMap.get(id) }))
    .sort((a, b) => (b.info?.memberCount ?? 0) - (a.info?.memberCount ?? 0));

  const allItems = [
    ...sorted.map((c, i) => ({
      key: c.id,
      color: CLUSTER_COLORS[i % CLUSTER_COLORS.length],
      name: c.info?.name ?? `Topic ${i + 1}`,
      count: c.info?.memberCount ?? 0,
      info: c.info ?? null,
    })),
    ...(unclusteredCount > 0
      ? [{ key: '_unclustered', color: '#64748b', name: 'Unclustered', count: unclusteredCount, info: null }]
      : []),
  ];

  const handleEnter = (e: React.MouseEvent, cluster: ClusterInfo) => {
    const chip = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltip({ visible: true, cluster, anchorRect: chip });
  };

  const handleLeave = () => {
    setTooltip({ visible: false, cluster: null, anchorRect: null });
  };

  // Compute tooltip position relative to container
  const containerRect = containerRef.current?.getBoundingClientRect();
  const tipLeft = tooltip.anchorRect && containerRect
    ? Math.min(
        tooltip.anchorRect.left - containerRect.left,
        containerRect.width - 296,
      )
    : 0;
  const tipTop = tooltip.anchorRect && containerRect
    ? tooltip.anchorRect.bottom - containerRect.top + 6
    : 0;

  return (
    <div ref={containerRef} className="relative rounded-lg border border-border bg-card px-4 py-2.5">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        Topic Clusters
      </div>

      <div
        className="grid gap-x-6 gap-y-1"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
      >
        {allItems.map((item) => (
          <div
            key={item.key}
            className="flex items-center gap-2 text-xs cursor-default hover:bg-muted/50 rounded px-1.5 py-0.5 transition-colors min-w-0"
            onMouseEnter={item.info ? (e) => handleEnter(e, item.info!) : undefined}
            onMouseLeave={handleLeave}
          >
            <span
              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-foreground truncate">{item.name}</span>
            <span className="text-muted-foreground tabular-nums ml-auto shrink-0">{item.count}</span>
          </div>
        ))}
      </div>

      {/* Tooltip popover — renders below the hovered item, solid background */}
      {tooltip.visible && tooltip.cluster && (
        <div
          className="absolute z-50 rounded-md border border-border/80 bg-card/50 backdrop-blur-md px-3 py-2.5 text-xs shadow-lg w-72 pointer-events-none"
          style={{
            left: Math.max(0, tipLeft),
            top: tipTop,
          }}
        >
          <div className="font-semibold text-foreground mb-1">{tooltip.cluster.name ?? 'Unnamed'}</div>
          {tooltip.cluster.description && (
            <p className="text-muted-foreground mb-2 leading-relaxed">{tooltip.cluster.description}</p>
          )}
          <div className="flex gap-4 text-muted-foreground">
            <div>Members: <span className="text-foreground tabular-nums">{tooltip.cluster.memberCount}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

export { CLUSTER_COLORS };
