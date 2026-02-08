/**
 * Session ingestion pipeline exports.
 */

// Main ingestion
export { ingestSession, chunkToInput } from './ingest-session.js';
export type { IngestOptions, IngestResult } from './ingest-session.js';

// Batch ingestion
export {
  batchIngest,
  batchIngestDirectory,
  discoverSessions,
  filterAlreadyIngested,
} from './batch-ingest.js';
export type { BatchIngestOptions, BatchIngestResult } from './batch-ingest.js';

// Edge detection
export { detectTransitions, getTimeGapMs } from './edge-detector.js';
export type { TransitionResult, DetectionOptions } from './edge-detector.js';

// Edge creation
export {
  createEdgesFromTransitions,
  createEdgePair,
  createCrossSessionEdges,
  TYPE_WEIGHTS,
} from './edge-creator.js';
export type { EdgeCreationResult } from './edge-creator.js';

// Cross-session linking
export {
  linkCrossSession,
  linkAllSessions,
  isContinuedSession,
} from './cross-session-linker.js';
export type { CrossSessionLinkResult } from './cross-session-linker.js';
