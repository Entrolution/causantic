/**
 * Retrieval system exports.
 */

// Traverser
export { traverse, traverseMultiple, resolveChunks, dedupeAndRank } from './traverser.js';
export type { TraversalOptions } from './traverser.js';

// Context assembler
export {
  assembleContext,
  recall,
  explain,
  predict,
  disposeRetrieval,
} from './context-assembler.js';
export type { RetrievalMode, RetrievalRange, RetrievalRequest, RetrievalResponse } from './context-assembler.js';

// Reciprocal Rank Fusion
export { fuseRRF } from './rrf.js';
export type { RankedItem, RRFSource } from './rrf.js';

// Cluster expansion
export { expandViaClusters } from './cluster-expander.js';
export type { ClusterExpansionConfig } from './cluster-expander.js';
