/**
 * Integration tests for export/import functionality.
 *
 * Uses real in-memory databases to verify end-to-end round-trips.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import Database from 'better-sqlite3-multiple-ciphers';
import {
  createTestDb,
  setupTestDb,
  teardownTestDb,
  createSampleChunk,
  insertTestChunk,
  insertTestEdge,
  insertTestCluster,
  assignChunkToCluster,
} from './test-utils.js';
import {
  exportArchive,
  importArchive,
  validateArchive,
  type Archive,
  type ExportResult,
  type ImportResult,
} from '../../src/storage/archive.js';
import { serializeEmbedding, deserializeEmbedding } from '../../src/utils/embedding-utils.js';

// Helper to create a temp file path
function tempPath(suffix = '.json'): string {
  return join(tmpdir(), `causantic-test-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`);
}

// Helper to create vectors table in test db
function createVectorsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vectors (
      id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      orphaned_at TEXT DEFAULT NULL,
      last_accessed TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// Helper to insert a vector into the test db
function insertTestVector(db: Database.Database, id: string, embedding: number[]): void {
  db.prepare('INSERT INTO vectors (id, embedding) VALUES (?, ?)').run(
    id,
    serializeEmbedding(embedding),
  );
}

// Helper to seed a standard test dataset
function seedTestData(db: Database.Database): {
  chunkIds: string[];
  edgeId: string;
  clusterId: string;
  embedding: number[];
} {
  const chunk1 = createSampleChunk({
    id: 'chunk-1',
    sessionId: 'session-1',
    sessionSlug: 'project-a',
    content: 'First chunk content with /path/to/file.ts',
    startTime: '2024-01-01T00:00:00Z',
    endTime: '2024-01-01T00:01:00Z',
    projectPath: '/home/user/project-a',
  });
  const chunk2 = createSampleChunk({
    id: 'chunk-2',
    sessionId: 'session-1',
    sessionSlug: 'project-a',
    content: 'Second chunk with ```ts\nconst x = 1;\n```',
    startTime: '2024-01-01T00:01:00Z',
    endTime: '2024-01-01T00:02:00Z',
    projectPath: '/home/user/project-a',
  });
  const chunk3 = createSampleChunk({
    id: 'chunk-3',
    sessionId: 'session-2',
    sessionSlug: 'project-b',
    content: 'Third chunk from project-b',
    startTime: '2024-01-01T00:02:00Z',
    endTime: '2024-01-01T00:03:00Z',
    projectPath: '/home/user/project-b',
  });

  insertTestChunk(db, chunk1);
  insertTestChunk(db, chunk2);
  insertTestChunk(db, chunk3);

  const edgeId = insertTestEdge(db, {
    id: 'edge-1',
    sourceChunkId: 'chunk-1',
    targetChunkId: 'chunk-2',
    edgeType: 'forward',
    referenceType: 'within-chain',
    initialWeight: 0.9,
    linkCount: 2,
  });

  const clusterId = insertTestCluster(db, {
    id: 'cluster-1',
    name: 'Auth cluster',
    description: 'Authentication related',
    exemplarIds: ['chunk-1'],
  });
  assignChunkToCluster(db, 'chunk-1', clusterId, 0.3);
  assignChunkToCluster(db, 'chunk-2', clusterId, 0.5);

  // Add centroid and membership hash
  db.prepare('UPDATE clusters SET centroid = ?, membership_hash = ? WHERE id = ?').run(
    serializeEmbedding([0.1, 0.2, 0.3, 0.4]),
    'abc123',
    clusterId,
  );

  createVectorsTable(db);
  const embedding = Array.from({ length: 8 }, (_, i) => i * 0.1);
  insertTestVector(db, 'chunk-1', embedding);
  insertTestVector(db, 'chunk-2', embedding.map((v) => v + 0.01));

  return {
    chunkIds: ['chunk-1', 'chunk-2', 'chunk-3'],
    edgeId,
    clusterId,
    embedding,
  };
}

describe('archive', () => {
  let db: Database.Database;
  let outputPath: string;

  beforeEach(() => {
    db = createTestDb();
    setupTestDb(db);
    outputPath = tempPath();
  });

  afterEach(() => {
    teardownTestDb(db);
    if (existsSync(outputPath)) {
      unlinkSync(outputPath);
    }
  });

  describe('unencrypted round-trip', () => {
    it('exports and imports all data correctly', async () => {
      const { embedding } = seedTestData(db);

      const exportResult = await exportArchive({ outputPath });
      expect(exportResult.chunkCount).toBe(3);
      expect(exportResult.edgeCount).toBe(1);
      expect(exportResult.clusterCount).toBe(1);
      expect(exportResult.vectorCount).toBe(2);
      expect(exportResult.compressed).toBe(true);
      expect(exportResult.encrypted).toBe(false);
      expect(exportResult.fileSize).toBeGreaterThan(0);

      // Import into fresh db
      teardownTestDb(db);
      db = createTestDb();
      setupTestDb(db);
      createVectorsTable(db);

      const importResult = await importArchive({ inputPath: outputPath });
      expect(importResult.chunkCount).toBe(3);
      expect(importResult.edgeCount).toBe(1);
      expect(importResult.clusterCount).toBe(1);
      expect(importResult.vectorCount).toBe(2);
      expect(importResult.dryRun).toBe(false);

      // Verify data
      const chunks = db.prepare('SELECT * FROM chunks ORDER BY id').all() as Array<Record<string, unknown>>;
      expect(chunks).toHaveLength(3);
      expect(chunks[0].id).toBe('chunk-1');
      expect(chunks[0].session_id).toBe('session-1');
      expect(chunks[0].session_slug).toBe('project-a');
      expect(chunks[0].project_path).toBe('/home/user/project-a');

      const edges = db.prepare('SELECT * FROM edges').all() as Array<Record<string, unknown>>;
      expect(edges).toHaveLength(1);
      expect(edges[0].source_chunk_id).toBe('chunk-1');
      expect(edges[0].target_chunk_id).toBe('chunk-2');
      expect(edges[0].edge_type).toBe('forward');
      expect(edges[0].reference_type).toBe('within-chain');
      expect(edges[0].initial_weight).toBe(0.9);
      expect(edges[0].link_count).toBe(2);

      const clusters = db.prepare('SELECT * FROM clusters').all() as Array<Record<string, unknown>>;
      expect(clusters).toHaveLength(1);
      expect(clusters[0].name).toBe('Auth cluster');
      expect(clusters[0].description).toBe('Authentication related');
      expect(clusters[0].membership_hash).toBe('abc123');

      const members = db.prepare('SELECT * FROM chunk_clusters ORDER BY chunk_id').all() as Array<Record<string, unknown>>;
      expect(members).toHaveLength(2);
      expect(members[0].chunk_id).toBe('chunk-1');
      expect(members[0].distance).toBe(0.3);

      const vectors = db.prepare('SELECT * FROM vectors ORDER BY id').all() as Array<Record<string, unknown>>;
      expect(vectors).toHaveLength(2);
    });
  });

  describe('encrypted round-trip', () => {
    it('encrypts and decrypts correctly', async () => {
      seedTestData(db);
      const password = 'test-password-123';

      const exportResult = await exportArchive({ outputPath, password });
      expect(exportResult.encrypted).toBe(true);

      // Verify file starts with magic bytes
      const fileContent = readFileSync(outputPath);
      expect(fileContent.subarray(0, 4).equals(Buffer.from('CST\x00'))).toBe(true);

      // Import into fresh db
      teardownTestDb(db);
      db = createTestDb();
      setupTestDb(db);
      createVectorsTable(db);

      const importResult = await importArchive({ inputPath: outputPath, password });
      expect(importResult.chunkCount).toBe(3);

      const chunks = db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
      expect(chunks.count).toBe(3);
    });

    it('rejects wrong password', async () => {
      seedTestData(db);
      await exportArchive({ outputPath, password: 'correct-password' });

      teardownTestDb(db);
      db = createTestDb();
      setupTestDb(db);

      await expect(
        importArchive({ inputPath: outputPath, password: 'wrong-password' }),
      ).rejects.toThrow();
    });

    it('rejects missing password for encrypted archive', async () => {
      seedTestData(db);
      await exportArchive({ outputPath, password: 'test-pass' });

      teardownTestDb(db);
      db = createTestDb();
      setupTestDb(db);

      await expect(importArchive({ inputPath: outputPath })).rejects.toThrow(
        'Archive is encrypted',
      );
    });
  });

  describe('vector round-trip', () => {
    it('preserves vector embeddings through serialize/JSON/deserialize', async () => {
      const { embedding } = seedTestData(db);

      await exportArchive({ outputPath });

      teardownTestDb(db);
      db = createTestDb();
      setupTestDb(db);
      createVectorsTable(db);

      await importArchive({ inputPath: outputPath });

      const vectors = db.prepare('SELECT id, embedding FROM vectors ORDER BY id').all() as Array<{
        id: string;
        embedding: Buffer;
      }>;
      expect(vectors).toHaveLength(2);

      const restored = deserializeEmbedding(vectors[0].embedding);
      expect(restored).toHaveLength(embedding.length);
      // Float32 precision: compare with tolerance
      for (let i = 0; i < embedding.length; i++) {
        expect(restored[i]).toBeCloseTo(embedding[i], 5);
      }
    });

    it('skips vectors with --no-vectors', async () => {
      seedTestData(db);

      const result = await exportArchive({ outputPath, noVectors: true });
      expect(result.vectorCount).toBe(0);

      teardownTestDb(db);
      db = createTestDb();
      setupTestDb(db);
      createVectorsTable(db);

      const importResult = await importArchive({ inputPath: outputPath });
      expect(importResult.vectorCount).toBe(0);

      const vectors = db.prepare('SELECT COUNT(*) as count FROM vectors').get() as { count: number };
      expect(vectors.count).toBe(0);
    });
  });

  describe('cluster round-trip', () => {
    it('preserves centroid, distances, exemplar IDs, and membership hash', async () => {
      seedTestData(db);

      await exportArchive({ outputPath });

      teardownTestDb(db);
      db = createTestDb();
      setupTestDb(db);
      createVectorsTable(db);

      await importArchive({ inputPath: outputPath });

      const cluster = db.prepare('SELECT * FROM clusters WHERE id = ?').get('cluster-1') as Record<string, unknown>;
      expect(cluster.name).toBe('Auth cluster');
      expect(cluster.description).toBe('Authentication related');
      expect(cluster.membership_hash).toBe('abc123');
      expect(cluster.exemplar_ids).toBe(JSON.stringify(['chunk-1']));

      // Verify centroid survives round-trip
      const centroid = deserializeEmbedding(cluster.centroid as Buffer);
      expect(centroid).toHaveLength(4);
      expect(centroid[0]).toBeCloseTo(0.1, 5);

      // Verify member distances
      const members = db.prepare('SELECT * FROM chunk_clusters WHERE cluster_id = ? ORDER BY chunk_id').all('cluster-1') as Array<Record<string, unknown>>;
      expect(members).toHaveLength(2);
      expect(members[0].distance).toBe(0.3);
      expect(members[1].distance).toBe(0.5);
    });
  });

  describe('project filtering', () => {
    it('exports only specified projects', async () => {
      seedTestData(db);

      const result = await exportArchive({
        outputPath,
        projects: ['project-a'],
      });
      expect(result.chunkCount).toBe(2); // only project-a chunks

      teardownTestDb(db);
      db = createTestDb();
      setupTestDb(db);
      createVectorsTable(db);

      await importArchive({ inputPath: outputPath });

      const chunks = db.prepare('SELECT * FROM chunks').all();
      expect(chunks).toHaveLength(2);

      const slugs = (chunks as Array<Record<string, unknown>>).map((c) => c.session_slug);
      expect(slugs).toEqual(['project-a', 'project-a']);
    });
  });

  describe('edge completeness', () => {
    it('excludes edges with one endpoint outside the export', async () => {
      const chunk1 = createSampleChunk({ id: 'chunk-a', sessionSlug: 'proj-1', sessionId: 'ses-1' });
      const chunk2 = createSampleChunk({ id: 'chunk-b', sessionSlug: 'proj-1', sessionId: 'ses-1' });
      const chunk3 = createSampleChunk({ id: 'chunk-c', sessionSlug: 'proj-2', sessionId: 'ses-2' });
      insertTestChunk(db, chunk1);
      insertTestChunk(db, chunk2);
      insertTestChunk(db, chunk3);

      // Edge within proj-1
      insertTestEdge(db, {
        id: 'edge-internal',
        sourceChunkId: 'chunk-a',
        targetChunkId: 'chunk-b',
        edgeType: 'forward',
      });
      // Edge crossing projects
      insertTestEdge(db, {
        id: 'edge-cross',
        sourceChunkId: 'chunk-a',
        targetChunkId: 'chunk-c',
        edgeType: 'forward',
      });

      const result = await exportArchive({
        outputPath,
        projects: ['proj-1'],
      });
      // Only the internal edge should be exported
      expect(result.edgeCount).toBe(1);
    });
  });

  describe('redaction', () => {
    it('redacts file paths', async () => {
      seedTestData(db);

      await exportArchive({ outputPath, redactPaths: true });

      teardownTestDb(db);
      db = createTestDb();
      setupTestDb(db);
      createVectorsTable(db);

      await importArchive({ inputPath: outputPath });

      const chunk = db.prepare('SELECT content FROM chunks WHERE id = ?').get('chunk-1') as { content: string };
      expect(chunk.content).toContain('[REDACTED_PATH]');
      expect(chunk.content).not.toContain('/path/to/file.ts');
    });

    it('redacts code blocks', async () => {
      seedTestData(db);

      await exportArchive({ outputPath, redactCode: true });

      teardownTestDb(db);
      db = createTestDb();
      setupTestDb(db);
      createVectorsTable(db);

      await importArchive({ inputPath: outputPath });

      const chunk = db.prepare('SELECT content FROM chunks WHERE id = ?').get('chunk-2') as { content: string };
      expect(chunk.content).toContain('[REDACTED_CODE]');
      expect(chunk.content).not.toContain('const x = 1');
    });
  });

  describe('merge vs replace', () => {
    it('replace mode clears existing data', async () => {
      seedTestData(db);
      await exportArchive({ outputPath });

      // Add extra data before import
      const extra = createSampleChunk({ id: 'chunk-extra', sessionSlug: 'project-a', sessionId: 'ses-x' });
      insertTestChunk(db, extra);
      expect(
        (db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number }).count,
      ).toBe(4);

      await importArchive({ inputPath: outputPath, merge: false });

      // Replace should have cleared the extra chunk
      expect(
        (db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number }).count,
      ).toBe(3);
    });

    it('merge mode preserves existing data', async () => {
      seedTestData(db);

      // Export only project-a
      await exportArchive({ outputPath, projects: ['project-a'] });

      // Now add different data
      teardownTestDb(db);
      db = createTestDb();
      setupTestDb(db);
      createVectorsTable(db);
      const other = createSampleChunk({ id: 'chunk-other', sessionSlug: 'project-c', sessionId: 'ses-c' });
      insertTestChunk(db, other);

      await importArchive({ inputPath: outputPath, merge: true });

      // Should have both the imported chunks AND the existing one
      const count = (db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number }).count;
      expect(count).toBe(3); // 2 from project-a + 1 existing
    });
  });

  describe('dry-run import', () => {
    it('reports counts without modifying database', async () => {
      seedTestData(db);
      await exportArchive({ outputPath });

      teardownTestDb(db);
      db = createTestDb();
      setupTestDb(db);

      const result = await importArchive({ inputPath: outputPath, dryRun: true });
      expect(result.dryRun).toBe(true);
      expect(result.chunkCount).toBe(3);
      expect(result.edgeCount).toBe(1);

      // Database should be empty
      const count = (db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number }).count;
      expect(count).toBe(0);
    });
  });

  describe('v1.0 backward compatibility', () => {
    it('imports v1.0 archive without vectors', async () => {
      // Build a v1.0-style archive manually
      const v1Archive = {
        format: 'causantic-archive' as const,
        version: '1.0',
        created: new Date().toISOString(),
        metadata: {
          version: '1.0',
          created: new Date().toISOString(),
          chunkCount: 1,
          edgeCount: 0,
          clusterCount: 0,
          vectorCount: 0,
          embeddingDimensions: null,
          projects: ['test'],
        },
        chunks: [
          {
            id: 'v1-chunk',
            sessionId: 'ses-1',
            sessionSlug: 'test',
            projectPath: null,
            content: 'v1 content',
            startTime: '2024-01-01T00:00:00Z',
            endTime: '2024-01-01T00:01:00Z',
            turnIndices: [0],
          },
        ],
        edges: [],
        clusters: [],
        // No vectors array — v1.0 format
      };

      writeFileSync(outputPath, JSON.stringify(v1Archive));

      createVectorsTable(db);
      const result = await importArchive({ inputPath: outputPath });
      expect(result.chunkCount).toBe(1);
      expect(result.vectorCount).toBe(0);

      const count = (db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number }).count;
      expect(count).toBe(1);
    });

    it('imports v1.0 archive with memberChunkIds cluster format', async () => {
      const v1Archive = {
        format: 'causantic-archive' as const,
        version: '1.0',
        created: new Date().toISOString(),
        metadata: {
          version: '1.0',
          created: new Date().toISOString(),
          chunkCount: 1,
          edgeCount: 0,
          clusterCount: 1,
          vectorCount: 0,
          embeddingDimensions: null,
          projects: ['test'],
        },
        chunks: [
          {
            id: 'v1-chunk',
            sessionId: 'ses-1',
            sessionSlug: 'test',
            projectPath: null,
            content: 'v1 content',
            startTime: '2024-01-01T00:00:00Z',
            endTime: '2024-01-01T00:01:00Z',
            turnIndices: [0],
          },
        ],
        edges: [],
        clusters: [
          {
            id: 'v1-cluster',
            name: 'Old Cluster',
            description: null,
            centroid: null,
            exemplarIds: null,
            membershipHash: null,
            // v1.0 format used memberChunkIds instead of members
            memberChunkIds: ['v1-chunk'],
          },
        ],
      };

      writeFileSync(outputPath, JSON.stringify(v1Archive));

      createVectorsTable(db);
      await importArchive({ inputPath: outputPath });

      const members = db.prepare('SELECT * FROM chunk_clusters').all() as Array<Record<string, unknown>>;
      expect(members).toHaveLength(1);
      expect(members[0].chunk_id).toBe('v1-chunk');
      expect(members[0].distance).toBe(0); // default distance for v1.0
    });
  });

  describe('validation', () => {
    it('rejects unknown version', () => {
      const archive = {
        format: 'causantic-archive',
        version: '99.0',
        metadata: { chunkCount: 0, edgeCount: 0, clusterCount: 0 },
        chunks: [],
        edges: [],
        clusters: [],
        vectors: [],
      } as unknown as Archive;

      const result = validateArchive(archive);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Unsupported archive version');
    });

    it('rejects invalid format', () => {
      const archive = {
        format: 'not-causantic',
        version: '1.1',
        metadata: { chunkCount: 0, edgeCount: 0, clusterCount: 0 },
        chunks: [],
        edges: [],
        clusters: [],
        vectors: [],
      } as unknown as Archive;

      const result = validateArchive(archive);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid archive format');
    });

    it('warns on count mismatch', () => {
      const archive: Archive = {
        format: 'causantic-archive',
        version: '1.1',
        created: new Date().toISOString(),
        metadata: {
          version: '1.1',
          created: new Date().toISOString(),
          chunkCount: 99,
          edgeCount: 0,
          clusterCount: 0,
          vectorCount: 0,
          embeddingDimensions: null,
          projects: [],
        },
        chunks: [],
        edges: [],
        clusters: [],
        vectors: [],
      };

      const result = validateArchive(archive);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes('chunkCount'))).toBe(true);
    });

    it('warns on dangling edge references', () => {
      const archive: Archive = {
        format: 'causantic-archive',
        version: '1.1',
        created: new Date().toISOString(),
        metadata: {
          version: '1.1',
          created: new Date().toISOString(),
          chunkCount: 1,
          edgeCount: 1,
          clusterCount: 0,
          vectorCount: 0,
          embeddingDimensions: null,
          projects: [],
        },
        chunks: [
          {
            id: 'chunk-1',
            sessionId: 'ses',
            sessionSlug: 'test',
            projectPath: null,
            content: 'test',
            startTime: '2024-01-01T00:00:00Z',
            endTime: '2024-01-01T00:01:00Z',
            turnIndices: [],
          },
        ],
        edges: [
          {
            id: 'edge-1',
            source: 'chunk-1',
            target: 'chunk-nonexistent',
            type: 'forward',
            referenceType: null,
            weight: 1.0,
            linkCount: 1,
          },
        ],
        clusters: [],
        vectors: [],
      };

      const result = validateArchive(archive);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes('edge(s) reference chunks'))).toBe(true);
    });

    it('warns on v1.0 missing vectors', () => {
      const archive = {
        format: 'causantic-archive',
        version: '1.0',
        created: new Date().toISOString(),
        metadata: {
          version: '1.0',
          created: new Date().toISOString(),
          chunkCount: 0,
          edgeCount: 0,
          clusterCount: 0,
          vectorCount: 0,
          embeddingDimensions: null,
          projects: [],
        },
        chunks: [],
        edges: [],
        clusters: [],
        vectors: [],
      } as Archive;

      const result = validateArchive(archive);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes('version 1.0'))).toBe(true);
    });

    it('rejects invalid file at import', async () => {
      writeFileSync(outputPath, JSON.stringify({ format: 'wrong', version: '1.0' }));

      await expect(importArchive({ inputPath: outputPath })).rejects.toThrow('Invalid archive');
    });
  });

  describe('gzip compression', () => {
    it('exports compressed data that is smaller than uncompressed', async () => {
      seedTestData(db);

      await exportArchive({ outputPath });

      const compressedSize = readFileSync(outputPath).length;

      // The file should be gzip (starts with gzip magic bytes)
      const fileContent = readFileSync(outputPath);
      expect(fileContent[0]).toBe(0x1f);
      expect(fileContent[1]).toBe(0x8b);

      // Compression should produce meaningful reduction (at least some savings)
      expect(compressedSize).toBeGreaterThan(0);
    });

    it('imports plain JSON (backward compat)', async () => {
      // Write a plain JSON archive (no gzip)
      const plainArchive: Archive = {
        format: 'causantic-archive',
        version: '1.1',
        created: new Date().toISOString(),
        metadata: {
          version: '1.1',
          created: new Date().toISOString(),
          chunkCount: 1,
          edgeCount: 0,
          clusterCount: 0,
          vectorCount: 0,
          embeddingDimensions: null,
          projects: ['test'],
        },
        chunks: [
          {
            id: 'plain-chunk',
            sessionId: 'ses-1',
            sessionSlug: 'test',
            projectPath: null,
            content: 'plain text',
            startTime: '2024-01-01T00:00:00Z',
            endTime: '2024-01-01T00:01:00Z',
            turnIndices: [],
          },
        ],
        edges: [],
        clusters: [],
        vectors: [],
      };
      writeFileSync(outputPath, JSON.stringify(plainArchive));

      createVectorsTable(db);
      const result = await importArchive({ inputPath: outputPath });
      expect(result.chunkCount).toBe(1);
    });
  });

  describe('empty archive', () => {
    it('exports and imports empty database', async () => {
      const result = await exportArchive({ outputPath });
      expect(result.chunkCount).toBe(0);
      expect(result.edgeCount).toBe(0);
      expect(result.clusterCount).toBe(0);
      expect(result.vectorCount).toBe(0);

      teardownTestDb(db);
      db = createTestDb();
      setupTestDb(db);
      createVectorsTable(db);

      const importResult = await importArchive({ inputPath: outputPath });
      expect(importResult.chunkCount).toBe(0);
    });
  });

  describe('missing file', () => {
    it('throws on non-existent file', async () => {
      await expect(importArchive({ inputPath: '/nonexistent/file.json' })).rejects.toThrow(
        'File not found',
      );
    });
  });

  describe('export result', () => {
    it('returns accurate counts and metadata', async () => {
      seedTestData(db);

      const result = await exportArchive({ outputPath });
      expect(result).toEqual({
        chunkCount: 3,
        edgeCount: 1,
        clusterCount: 1,
        vectorCount: 2,
        fileSize: expect.any(Number),
        compressed: true,
        encrypted: false,
      });
    });
  });
});
