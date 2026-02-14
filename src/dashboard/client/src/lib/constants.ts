/** Cluster metadata used across timeline components. */
export interface ClusterInfo {
  id: string;
  name: string | null;
  description: string | null;
  memberCount: number;
}

/** Consistent color palette for cluster visualization. */
export const CLUSTER_COLORS = [
  '#10b981',
  '#06b6d4',
  '#8b5cf6',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#6366f1',
  '#84cc16',
  '#0ea5e9',
  '#d946ef',
  '#22c55e',
  '#eab308',
  '#a855f7',
];
