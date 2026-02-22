/**
 * Tests for HDBSCAN model persistence (serialize/deserialize round-trip).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { setDb, resetDb } from '../../src/storage/db.js';
import {
  saveModel,
  loadModel,
  deleteModel,
  _serializeModel,
  _deserializeModel,
} from '../../src/clusters/hdbscan-model-store.js';
import type { HDBSCANModel } from '../../src/clusters/hdbscan/types.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
    INSERT INTO schema_version (version) VALUES (12);

    CREATE TABLE hdbscan_models (
      project_id TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      model_blob BLOB NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (project_id, embedding_model)
    );
  `);
  return db;
}

function createSampleModel(): HDBSCANModel {
  return {
    embeddings: [
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
      [0.7, 0.8, 0.9],
    ],
    coreDistances: [0.1, 0.2, 0.3],
    labels: [0, 0, 1],
    centroids: new Map([
      [0, [0.25, 0.35, 0.45]],
      [1, [0.7, 0.8, 0.9]],
    ]),
    exemplars: new Map([
      [0, [0, 1]],
      [1, [2]],
    ]),
    lambdaValues: [1.5, 2.0, 1.8],
    clusterMaxLambda: new Map([
      [0, 3.0],
      [1, 2.5],
    ]),
  };
}

describe('hdbscan-model-store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
  });

  afterEach(() => {
    db.close();
    resetDb();
  });

  describe('serialize/deserialize round-trip', () => {
    it('preserves all fields except embeddings', () => {
      const model = createSampleModel();
      const blob = _serializeModel(model);
      const restored = _deserializeModel(blob);

      expect(restored.coreDistances).toEqual(model.coreDistances);
      expect(restored.labels).toEqual(model.labels);
      expect(restored.lambdaValues).toEqual(model.lambdaValues);

      // Maps need explicit comparison
      expect(Array.from(restored.centroids.entries())).toEqual(
        Array.from(model.centroids.entries()),
      );
      expect(Array.from(restored.exemplars.entries())).toEqual(
        Array.from(model.exemplars.entries()),
      );
      expect(Array.from(restored.clusterMaxLambda.entries())).toEqual(
        Array.from(model.clusterMaxLambda.entries()),
      );
    });

    it('does not include embeddings in serialized blob', () => {
      const model = createSampleModel();
      const blob = _serializeModel(model);
      const parsed = JSON.parse(blob.toString('utf-8'));

      expect(parsed).not.toHaveProperty('embeddings');
    });

    it('handles empty Maps correctly', () => {
      const model: HDBSCANModel = {
        embeddings: [],
        coreDistances: [],
        labels: [],
        centroids: new Map(),
        exemplars: new Map(),
        lambdaValues: [],
        clusterMaxLambda: new Map(),
      };

      const blob = _serializeModel(model);
      const restored = _deserializeModel(blob);

      expect(restored.centroids.size).toBe(0);
      expect(restored.exemplars.size).toBe(0);
      expect(restored.clusterMaxLambda.size).toBe(0);
    });
  });

  describe('saveModel / loadModel', () => {
    it('saves and loads a model for a project', () => {
      const model = createSampleModel();
      saveModel('proj-1', 'jina-small', model, 100);

      const result = loadModel('proj-1', 'jina-small');
      expect(result).not.toBeNull();
      expect(result!.chunkCount).toBe(100);

      // Verify model fields
      expect(result!.model.coreDistances).toEqual(model.coreDistances);
      expect(result!.model.labels).toEqual(model.labels);
      expect(Array.from(result!.model.centroids.entries())).toEqual(
        Array.from(model.centroids.entries()),
      );
    });

    it('returns null when no model exists', () => {
      const result = loadModel('nonexistent', 'jina-small');
      expect(result).toBeNull();
    });

    it('returns null when embedding model does not match', () => {
      const model = createSampleModel();
      saveModel('proj-1', 'jina-small', model, 100);

      // Load with different model — should invalidate
      const result = loadModel('proj-1', 'nomic-v1.5');
      expect(result).toBeNull();
    });

    it('overwrites existing model on re-save', () => {
      const model1 = createSampleModel();
      saveModel('proj-1', 'jina-small', model1, 50);

      const model2 = createSampleModel();
      model2.labels = [1, 1, 0];
      saveModel('proj-1', 'jina-small', model2, 200);

      const result = loadModel('proj-1', 'jina-small');
      expect(result).not.toBeNull();
      expect(result!.chunkCount).toBe(200);
      expect(result!.model.labels).toEqual([1, 1, 0]);
    });

    it('stores different models per embedding model', () => {
      const model = createSampleModel();
      saveModel('proj-1', 'jina-small', model, 100);
      saveModel('proj-1', 'nomic-v1.5', model, 200);

      const result1 = loadModel('proj-1', 'jina-small');
      const result2 = loadModel('proj-1', 'nomic-v1.5');
      expect(result1!.chunkCount).toBe(100);
      expect(result2!.chunkCount).toBe(200);
    });
  });

  describe('deleteModel', () => {
    it('deletes all models for a project', () => {
      const model = createSampleModel();
      saveModel('proj-1', 'jina-small', model, 100);
      saveModel('proj-1', 'nomic-v1.5', model, 200);

      deleteModel('proj-1');

      expect(loadModel('proj-1', 'jina-small')).toBeNull();
      expect(loadModel('proj-1', 'nomic-v1.5')).toBeNull();
    });

    it('does not affect other projects', () => {
      const model = createSampleModel();
      saveModel('proj-1', 'jina-small', model, 100);
      saveModel('proj-2', 'jina-small', model, 200);

      deleteModel('proj-1');

      expect(loadModel('proj-1', 'jina-small')).toBeNull();
      expect(loadModel('proj-2', 'jina-small')).not.toBeNull();
    });
  });
});
