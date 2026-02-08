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
