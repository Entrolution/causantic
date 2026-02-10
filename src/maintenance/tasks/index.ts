/**
 * Barrel export for maintenance task modules.
 */

export { scanProjects, type ScanProjectsDeps } from './scan-projects.js';
export { updateClusters, type UpdateClustersDeps } from './update-clusters.js';
export { pruneGraph, type PruneGraphDeps } from './prune-graph.js';
export { refreshLabels, type RefreshLabelsDeps } from './refresh-labels.js';
export { vacuum, type VacuumDeps } from './vacuum.js';
export { cleanupVectors, type CleanupVectorsDeps } from './cleanup-vectors.js';
