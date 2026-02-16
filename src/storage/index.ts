/**
 * Storage layer exports.
 */

// Database
export { getDb, closeDb, clearAllData, getDbStats, generateId, getSchemaVersion } from './db.js';

// Types
export type {
  EdgeType,
  ReferenceType,
  StoredChunk,
  ChunkInput,
  StoredEdge,
  EdgeInput,
  WeightedEdge,
  StoredCluster,
  ClusterInput,
  ChunkClusterAssignment,
  WeightedChunk,
  TraversalResult,
  VectorSearchResult,
} from './types.js';

// Chunk store
export {
  insertChunk,
  insertChunks,
  getChunkById,
  getChunksByIds,
  getChunksBySession,
  getChunksBySessionSlug,
  getRecentChunksBySessionSlug,
  getAllChunks,
  getChunksByCluster,
  isSessionIngested,
  deleteChunk,
  deleteChunks,
  getSessionIds,
  getChunkCount,
} from './chunk-store.js';

// Edge store
export {
  createEdge,
  createEdges,
  getEdgeById,
  getOutgoingEdges,
  getIncomingEdges,
  getForwardEdges,
  getBackwardEdges,
  deleteEdge,
  deleteEdges,
  deleteEdgesForChunk,
  deleteEdgesForSession,
  getEdgeCount,
  getAllEdges,
} from './edge-store.js';

// Cluster store
export {
  upsertCluster,
  getClusterById,
  getAllClusters,
  getClustersWithDescriptions,
  getStaleClusters,
  assignChunkToCluster,
  assignChunksToClusters,
  getChunkClusterAssignments,
  getClusterChunkIds,
  removeChunkAssignments,
  clearClusterAssignments,
  deleteCluster,
  clearAllClusters,
  getClusterCount,
  computeMembershipHash,
} from './cluster-store.js';

// Vector store
export { vectorStore } from './vector-store.js';

// Keyword store
export { KeywordStore } from './keyword-store.js';
export type { KeywordSearchResult } from './keyword-store.js';
