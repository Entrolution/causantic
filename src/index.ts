/**
 * Causantic
 *
 * Long-term memory for Claude Code — local-first, graph-augmented, self-benchmarking.
 *
 * @packageDocumentation
 */

// Configuration
export * from './config/index.js';

// Storage (re-export from storage index)
export * from './storage/index.js';
export * from './storage/encryption.js';
export * from './storage/archive.js';

// Ingestion
export { ingestSession } from './ingest/ingest-session.js';
export type { IngestResult, IngestOptions } from './ingest/ingest-session.js';
export { batchIngest } from './ingest/batch-ingest.js';
export type { BatchIngestOptions, BatchIngestResult } from './ingest/batch-ingest.js';

// Retrieval
export * from './retrieval/index.js';

// Clustering
export * from './clusters/index.js';

// Temporal
export * from './temporal/index.js';

// Maintenance
export * from './maintenance/index.js';

// Hooks
export * from './hooks/index.js';

// Utils
export { createSecretStore, getApiKey } from './utils/secret-store.js';
