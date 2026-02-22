/**
 * Persistence layer for HDBSCAN models.
 *
 * Serializes/deserializes HDBSCANModel to SQLite BLOB for incremental clustering.
 * Maps are converted to [key, value][] arrays for JSON.stringify (bare stringify produces {}).
 * Excludes model.embeddings from the blob — too large. Load from vector store on demand.
 */

import { getDb } from '../storage/db.js';
import type { HDBSCANModel } from './hdbscan/types.js';

/**
 * Serializable subset of HDBSCANModel (excludes embeddings).
 */
interface SerializedModel {
  coreDistances: number[];
  labels: number[];
  centroids: [number, number[]][];
  exemplars: [number, number[]][];
  lambdaValues: number[];
  clusterMaxLambda: [number, number][];
}

/**
 * Serialize an HDBSCANModel to a JSON blob, excluding embeddings.
 */
function serializeModel(model: HDBSCANModel): Buffer {
  const serialized: SerializedModel = {
    coreDistances: model.coreDistances,
    labels: model.labels,
    centroids: Array.from(model.centroids.entries()),
    exemplars: Array.from(model.exemplars.entries()),
    lambdaValues: model.lambdaValues,
    clusterMaxLambda: Array.from(model.clusterMaxLambda.entries()),
  };
  return Buffer.from(JSON.stringify(serialized));
}

/**
 * Deserialize a JSON blob back to an HDBSCANModel (embeddings will be empty).
 */
function deserializeModel(blob: Buffer): Omit<HDBSCANModel, 'embeddings'> {
  const parsed: SerializedModel = JSON.parse(blob.toString('utf-8'));
  return {
    coreDistances: parsed.coreDistances,
    labels: parsed.labels,
    centroids: new Map(parsed.centroids),
    exemplars: new Map(parsed.exemplars),
    lambdaValues: parsed.lambdaValues,
    clusterMaxLambda: new Map(parsed.clusterMaxLambda),
  };
}

/**
 * Save an HDBSCAN model for a project.
 */
export function saveModel(
  projectId: string,
  embeddingModel: string,
  model: HDBSCANModel,
  chunkCount: number,
): void {
  const db = getDb();
  const blob = serializeModel(model);

  db.prepare(
    `INSERT OR REPLACE INTO hdbscan_models (project_id, embedding_model, model_blob, chunk_count, created_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
  ).run(projectId, embeddingModel, blob, chunkCount);
}

/**
 * Load an HDBSCAN model for a project.
 *
 * Returns null if:
 * - No model exists for this project
 * - Stored embedding_model doesn't match currentEmbeddingModel (model invalidation)
 */
export function loadModel(
  projectId: string,
  currentEmbeddingModel: string,
): { model: Omit<HDBSCANModel, 'embeddings'>; chunkCount: number } | null {
  const db = getDb();

  const row = db
    .prepare(
      'SELECT model_blob, embedding_model, chunk_count FROM hdbscan_models WHERE project_id = ? AND embedding_model = ?',
    )
    .get(projectId, currentEmbeddingModel) as
    | { model_blob: Buffer; embedding_model: string; chunk_count: number }
    | undefined;

  if (!row) {
    return null;
  }

  const model = deserializeModel(row.model_blob);
  return { model, chunkCount: row.chunk_count };
}

/**
 * Delete saved model for a project.
 */
export function deleteModel(projectId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM hdbscan_models WHERE project_id = ?').run(projectId);
}

// Re-export for testing
export { serializeModel as _serializeModel, deserializeModel as _deserializeModel };
