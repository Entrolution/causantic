/**
 * Retrieval system exports.
 */

// Context assembler
export {
  assembleContext,
  recall,
  predict,
  disposeRetrieval,
} from './context-assembler.js';
export type { RetrievalRequest, RetrievalResponse } from './context-assembler.js';

// Search assembler
export { searchContext, disposeSearch } from './search-assembler.js';
export type { SearchRequest, SearchResponse } from './search-assembler.js';

// Chain assembler
export { recallContext, predictContext } from './chain-assembler.js';
export type { EpisodicRequest, EpisodicResponse } from './chain-assembler.js';

// Chain walker
export { walkChains, selectBestChain } from './chain-walker.js';
export type { Chain, ChainWalkerOptions } from './chain-walker.js';

// Reciprocal Rank Fusion
export { fuseRRF } from './rrf.js';
export type { RankedItem, RRFSource } from './rrf.js';

// Cluster expansion
export { expandViaClusters } from './cluster-expander.js';
export type { ClusterExpansionConfig } from './cluster-expander.js';
