/**
 * Standardized error types for ECM.
 *
 * All errors extend from EcmError, providing:
 * - Error code for programmatic handling
 * - Cause chaining for debugging
 * - Consistent error messages
 *
 * ## Usage
 *
 * ```typescript
 * import { StorageError, IngestionError } from './errors.js';
 *
 * // Throw a storage error
 * throw new StorageError('Database connection failed', 'DB_CONNECTION_FAILED');
 *
 * // Chain errors
 * try {
 *   await someOperation();
 * } catch (err) {
 *   throw new IngestionError('Session ingestion failed', 'INGEST_FAILED', err);
 * }
 * ```
 *
 * @module utils/errors
 */

/**
 * Base error class for all ECM errors.
 *
 * Provides:
 * - `code`: Programmatic error identifier (e.g., 'DB_CONNECTION_FAILED')
 * - `cause`: Original error that caused this one (for chaining)
 * - `name`: Error class name (e.g., 'StorageError')
 */
export class EcmError extends Error {
  /** Error code for programmatic handling */
  readonly code: string;

  /** Original error that caused this one */
  readonly cause?: Error;

  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;

    // Normalize cause to Error
    if (cause instanceof Error) {
      this.cause = cause;
    } else if (cause !== undefined) {
      this.cause = new Error(String(cause));
    }

    // Capture stack trace (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Get a formatted string including cause chain.
   */
  toDetailedString(): string {
    let result = `${this.name} [${this.code}]: ${this.message}`;

    if (this.cause) {
      result += `\n  Caused by: ${this.cause.message}`;
      if (this.cause instanceof EcmError) {
        result += ` [${this.cause.code}]`;
      }
    }

    return result;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Errors from the storage layer (database, vector store, etc).
 *
 * Common codes:
 * - `DB_CONNECTION_FAILED`: Cannot connect to database
 * - `DB_QUERY_FAILED`: Query execution failed
 * - `CHUNK_NOT_FOUND`: Requested chunk doesn't exist
 * - `EDGE_NOT_FOUND`: Requested edge doesn't exist
 * - `VECTOR_INSERT_FAILED`: Failed to insert vector embedding
 * - `VECTOR_SEARCH_FAILED`: Vector similarity search failed
 */
export class StorageError extends EcmError {
  constructor(message: string, code: string, cause?: unknown) {
    super(message, code, cause);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ingestion Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Errors during session ingestion.
 *
 * Common codes:
 * - `SESSION_READ_FAILED`: Cannot read session file
 * - `PARSE_FAILED`: Failed to parse session messages
 * - `CHUNK_FAILED`: Chunking process failed
 * - `EMBED_FAILED`: Embedding generation failed
 * - `EDGE_DETECTION_FAILED`: Transition detection failed
 * - `BATCH_INGEST_FAILED`: Batch ingestion encountered errors
 */
export class IngestionError extends EcmError {
  constructor(message: string, code: string, cause?: unknown) {
    super(message, code, cause);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Retrieval Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Errors during memory retrieval.
 *
 * Common codes:
 * - `TRAVERSAL_FAILED`: Graph traversal failed
 * - `VECTOR_SEARCH_FAILED`: Vector similarity search failed
 * - `CONTEXT_ASSEMBLY_FAILED`: Context assembly failed
 * - `NO_EMBEDDER`: No embedder loaded for query embedding
 * - `QUERY_TIMEOUT`: Query exceeded time limit
 */
export class RetrievalError extends EcmError {
  constructor(message: string, code: string, cause?: unknown) {
    super(message, code, cause);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Errors in configuration loading or validation.
 *
 * Common codes:
 * - `CONFIG_NOT_FOUND`: Configuration file not found
 * - `CONFIG_PARSE_FAILED`: Failed to parse configuration
 * - `CONFIG_INVALID`: Configuration validation failed
 * - `MISSING_REQUIRED`: Required field missing
 * - `INVALID_VALUE`: Field value is invalid
 */
export class ConfigError extends EcmError {
  constructor(message: string, code: string, cause?: unknown) {
    super(message, code, cause);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cluster Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Errors during clustering operations.
 *
 * Common codes:
 * - `CLUSTER_FAILED`: HDBSCAN clustering failed
 * - `NO_VECTORS`: No vectors available for clustering
 * - `CENTROID_FAILED`: Centroid computation failed
 * - `ASSIGNMENT_FAILED`: Chunk assignment failed
 */
export class ClusterError extends EcmError {
  constructor(message: string, code: string, cause?: unknown) {
    super(message, code, cause);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Errors during hook execution.
 *
 * Common codes:
 * - `HOOK_FAILED`: Hook execution failed
 * - `HOOK_TIMEOUT`: Hook exceeded time limit
 * - `RETRY_EXHAUSTED`: All retry attempts failed
 */
export class HookError extends EcmError {
  constructor(message: string, code: string, cause?: unknown) {
    super(message, code, cause);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if an error is an ECM error with a specific code.
 */
export function isErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof EcmError && error.code === code;
}

/**
 * Check if an error is a specific type of ECM error.
 */
export function isStorageError(error: unknown): error is StorageError {
  return error instanceof StorageError;
}

export function isIngestionError(error: unknown): error is IngestionError {
  return error instanceof IngestionError;
}

export function isRetrievalError(error: unknown): error is RetrievalError {
  return error instanceof RetrievalError;
}

export function isConfigError(error: unknown): error is ConfigError {
  return error instanceof ConfigError;
}

export function isClusterError(error: unknown): error is ClusterError {
  return error instanceof ClusterError;
}

export function isHookError(error: unknown): error is HookError {
  return error instanceof HookError;
}

/**
 * Wrap an unknown error in an EcmError.
 *
 * If the error is already an EcmError, returns it unchanged.
 * Otherwise wraps it in a new EcmError with UNKNOWN code.
 */
export function wrapError(error: unknown, message?: string): EcmError {
  if (error instanceof EcmError) {
    return error;
  }

  const errorMessage = message ?? (error instanceof Error ? error.message : String(error));
  return new EcmError(errorMessage, 'UNKNOWN', error);
}
