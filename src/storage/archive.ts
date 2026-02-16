/**
 * Export/import functionality for Causantic memory data.
 *
 * Supports encrypted and unencrypted archives with optional gzip compression.
 * Archive format v1.1 adds vector embeddings and full cluster data.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { encrypt, decrypt, serializeEncrypted, deserializeEncrypted } from './encryption.js';
import { getDb, generateId } from './db.js';
import { serializeEmbedding, deserializeEmbedding } from '../utils/embedding-utils.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('archive');

/** Archive format version */
const ARCHIVE_VERSION = '1.1';

/** Accepted versions on import */
const ACCEPTED_VERSIONS = ['1.0', '1.1'];

/** Magic bytes for encrypted archives */
const ENCRYPTED_MAGIC = Buffer.from('CST\x00');

/** Magic bytes for gzip */
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

/** Archive metadata */
export interface ArchiveMetadata {
  version: string;
  created: string;
  chunkCount: number;
  edgeCount: number;
  clusterCount: number;
  vectorCount: number;
  embeddingDimensions: number | null;
  projects: string[];
}

/** Chunk data for export */
export interface ExportedChunk {
  id: string;
  sessionId: string;
  sessionSlug: string;
  projectPath: string | null;
  content: string;
  startTime: string;
  endTime: string;
  turnIndices: number[];
}

/** Edge data for export */
export interface ExportedEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  referenceType: string | null;
  weight: number;
  linkCount: number;
}

/** Cluster member with distance */
export interface ClusterMember {
  chunkId: string;
  distance: number;
}

/** Cluster data for export */
export interface ExportedCluster {
  id: string;
  name: string | null;
  description: string | null;
  centroid: number[] | null;
  exemplarIds: string[] | null;
  membershipHash: string | null;
  members: ClusterMember[];
}

/** Vector data for export */
export interface ExportedVector {
  chunkId: string;
  embedding: number[];
}

/** Complete archive structure */
export interface Archive {
  format: 'causantic-archive';
  version: string;
  created: string;
  metadata: ArchiveMetadata;
  chunks: ExportedChunk[];
  edges: ExportedEdge[];
  clusters: ExportedCluster[];
  vectors: ExportedVector[];
}

/** Export options */
export interface ExportOptions {
  /** Output file path */
  outputPath: string;
  /** Encryption password (omit for unencrypted) */
  password?: string;
  /** Filter by project slugs */
  projects?: string[];
  /** Redact file paths */
  redactPaths?: boolean;
  /** Redact code blocks */
  redactCode?: boolean;
  /** Skip vector embeddings */
  noVectors?: boolean;
}

/** Export result */
export interface ExportResult {
  chunkCount: number;
  edgeCount: number;
  clusterCount: number;
  vectorCount: number;
  fileSize: number;
  compressed: boolean;
  encrypted: boolean;
}

/** Import options */
export interface ImportOptions {
  /** Input file path */
  inputPath: string;
  /** Decryption password (required if encrypted) */
  password?: string;
  /** Merge with existing data */
  merge?: boolean;
  /** Validate and report without importing */
  dryRun?: boolean;
}

/** Import result */
export interface ImportResult {
  chunkCount: number;
  edgeCount: number;
  clusterCount: number;
  vectorCount: number;
  dryRun: boolean;
}

/** Validation result */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate an archive structure before import.
 */
export function validateArchive(archive: Archive): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Version check
  if (!archive.version || !ACCEPTED_VERSIONS.includes(archive.version)) {
    errors.push(`Unsupported archive version: ${archive.version ?? 'missing'}`);
  }

  // Format check
  if (archive.format !== 'causantic-archive') {
    errors.push(`Invalid archive format: ${archive.format ?? 'missing'}`);
  }

  // Count verification
  if (archive.metadata) {
    if (archive.metadata.chunkCount !== archive.chunks?.length) {
      warnings.push(
        `Metadata chunkCount (${archive.metadata.chunkCount}) does not match actual (${archive.chunks?.length ?? 0})`,
      );
    }
    if (archive.metadata.edgeCount !== archive.edges?.length) {
      warnings.push(
        `Metadata edgeCount (${archive.metadata.edgeCount}) does not match actual (${archive.edges?.length ?? 0})`,
      );
    }
    if (archive.metadata.clusterCount !== archive.clusters?.length) {
      warnings.push(
        `Metadata clusterCount (${archive.metadata.clusterCount}) does not match actual (${archive.clusters?.length ?? 0})`,
      );
    }
  }

  // Edge referential integrity
  if (archive.chunks && archive.edges) {
    const chunkIdSet = new Set(archive.chunks.map((c) => c.id));
    let danglingCount = 0;
    for (const edge of archive.edges) {
      if (!chunkIdSet.has(edge.source) || !chunkIdSet.has(edge.target)) {
        danglingCount++;
      }
    }
    if (danglingCount > 0) {
      warnings.push(`${danglingCount} edge(s) reference chunks not in the archive`);
    }
  }

  // v1.0 backward compat warning
  if (archive.version === '1.0') {
    warnings.push(
      'Archive version 1.0: no vector embeddings included. Semantic search will not work until re-embedding.',
    );
  }

  // Embedding dimension mismatch detection
  if (archive.metadata?.embeddingDimensions && archive.vectors?.length > 0) {
    const sampleDims = archive.vectors[0].embedding?.length;
    if (sampleDims && sampleDims !== archive.metadata.embeddingDimensions) {
      warnings.push(
        `Embedding dimensions mismatch: metadata says ${archive.metadata.embeddingDimensions}, sample vector has ${sampleDims}`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Export memory data to an archive.
 */
export async function exportArchive(options: ExportOptions): Promise<ExportResult> {
  const db = getDb();

  // Get unique projects
  const projectsResult = db.prepare('SELECT DISTINCT session_slug FROM chunks').all() as {
    session_slug: string;
  }[];
  const allProjects = projectsResult.map((r) => r.session_slug);

  // Filter projects if specified
  const targetProjects = options.projects ?? allProjects;

  // Export chunks
  const chunksQuery = db.prepare(`
    SELECT id, session_id, session_slug, project_path, content, start_time, end_time, turn_indices
    FROM chunks
    WHERE session_slug IN (${targetProjects.map(() => '?').join(',')})
  `);
  const chunksResult = chunksQuery.all(...targetProjects) as Array<{
    id: string;
    session_id: string;
    session_slug: string;
    project_path: string | null;
    content: string;
    start_time: string;
    end_time: string;
    turn_indices: string;
  }>;

  let chunks: ExportedChunk[] = chunksResult.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    sessionSlug: row.session_slug,
    projectPath: row.project_path,
    content: row.content,
    startTime: row.start_time,
    endTime: row.end_time,
    turnIndices: JSON.parse(row.turn_indices || '[]'),
  }));

  // Apply redactions
  if (options.redactPaths) {
    chunks = chunks.map((chunk) => ({
      ...chunk,
      content: redactFilePaths(chunk.content),
    }));
  }
  if (options.redactCode) {
    chunks = chunks.map((chunk) => ({
      ...chunk,
      content: redactCodeBlocks(chunk.content),
    }));
  }

  // Build chunk ID set for filtering edges and vectors
  const chunkIdSet = new Set(chunks.map((c) => c.id));

  // Export edges — both endpoints must be in the export
  const chunkIds = chunks.map((c) => c.id);
  let edges: ExportedEdge[] = [];
  if (chunkIds.length > 0) {
    const edgesQuery = db.prepare(`
      SELECT id, source_chunk_id, target_chunk_id, edge_type, reference_type, initial_weight, link_count
      FROM edges
      WHERE source_chunk_id IN (${chunkIds.map(() => '?').join(',')})
    `);
    const edgesResult = edgesQuery.all(...chunkIds) as Array<{
      id: string;
      source_chunk_id: string;
      target_chunk_id: string;
      edge_type: string;
      reference_type: string | null;
      initial_weight: number;
      link_count: number;
    }>;

    // Filter: only keep edges where BOTH endpoints are in the export
    edges = edgesResult
      .filter((row) => chunkIdSet.has(row.source_chunk_id) && chunkIdSet.has(row.target_chunk_id))
      .map((row) => ({
        id: row.id,
        source: row.source_chunk_id,
        target: row.target_chunk_id,
        type: row.edge_type,
        referenceType: row.reference_type,
        weight: row.initial_weight,
        linkCount: row.link_count,
      }));
  }

  // Export clusters with full data
  let clusters: ExportedCluster[] = [];
  if (chunkIds.length > 0) {
    // Find clusters that have at least one member in our export
    const clusterIdsQuery = db.prepare(`
      SELECT DISTINCT cluster_id FROM chunk_clusters
      WHERE chunk_id IN (${chunkIds.map(() => '?').join(',')})
    `);
    const clusterIds = (
      clusterIdsQuery.all(...chunkIds) as Array<{ cluster_id: string }>
    ).map((r) => r.cluster_id);

    if (clusterIds.length > 0) {
      const clustersQuery = db.prepare(`
        SELECT id, name, description, centroid, exemplar_ids, membership_hash
        FROM clusters
        WHERE id IN (${clusterIds.map(() => '?').join(',')})
      `);
      const clustersResult = clustersQuery.all(...clusterIds) as Array<{
        id: string;
        name: string | null;
        description: string | null;
        centroid: Buffer | null;
        exemplar_ids: string | null;
        membership_hash: string | null;
      }>;

      const membersQuery = db.prepare(`
        SELECT chunk_id, distance FROM chunk_clusters
        WHERE cluster_id = ? AND chunk_id IN (${chunkIds.map(() => '?').join(',')})
      `);

      clusters = clustersResult.map((row) => {
        const membersResult = membersQuery.all(row.id, ...chunkIds) as Array<{
          chunk_id: string;
          distance: number;
        }>;

        return {
          id: row.id,
          name: row.name,
          description: row.description,
          centroid: row.centroid ? deserializeEmbedding(row.centroid) : null,
          exemplarIds: row.exemplar_ids ? JSON.parse(row.exemplar_ids) : null,
          membershipHash: row.membership_hash,
          members: membersResult.map((m) => ({
            chunkId: m.chunk_id,
            distance: m.distance,
          })),
        };
      });
    }
  }

  // Export vectors
  let vectors: ExportedVector[] = [];
  let embeddingDimensions: number | null = null;
  if (!options.noVectors && chunkIds.length > 0) {
    // Check if vectors table exists
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vectors'")
      .get();
    if (tableExists) {
      const vectorsQuery = db.prepare(`
        SELECT id, embedding FROM vectors
        WHERE id IN (${chunkIds.map(() => '?').join(',')})
      `);
      const vectorsResult = vectorsQuery.all(...chunkIds) as Array<{
        id: string;
        embedding: Buffer;
      }>;

      vectors = vectorsResult.map((row) => ({
        chunkId: row.id,
        embedding: deserializeEmbedding(row.embedding),
      }));

      if (vectors.length > 0) {
        embeddingDimensions = vectors[0].embedding.length;
      }
    }
  }

  // Build archive
  const archive: Archive = {
    format: 'causantic-archive',
    version: ARCHIVE_VERSION,
    created: new Date().toISOString(),
    metadata: {
      version: ARCHIVE_VERSION,
      created: new Date().toISOString(),
      chunkCount: chunks.length,
      edgeCount: edges.length,
      clusterCount: clusters.length,
      vectorCount: vectors.length,
      embeddingDimensions,
      projects: targetProjects,
    },
    chunks,
    edges,
    clusters,
    vectors,
  };

  // Serialize: JSON -> gzip -> (optional) encrypt -> write
  const jsonData = JSON.stringify(archive);
  const compressed = gzipSync(Buffer.from(jsonData, 'utf-8'));

  let output: Buffer;
  const encrypted = !!options.password;
  if (options.password) {
    const encryptedData = encrypt(compressed, options.password);
    const serialized = serializeEncrypted(encryptedData);
    output = Buffer.concat([ENCRYPTED_MAGIC, serialized]);
  } else {
    output = compressed;
  }

  writeFileSync(options.outputPath, output);

  const result: ExportResult = {
    chunkCount: chunks.length,
    edgeCount: edges.length,
    clusterCount: clusters.length,
    vectorCount: vectors.length,
    fileSize: output.length,
    compressed: true,
    encrypted,
  };

  log.info('Export completed', { ...result });
  return result;
}

/**
 * Import memory data from an archive.
 */
export async function importArchive(options: ImportOptions): Promise<ImportResult> {
  if (!existsSync(options.inputPath)) {
    throw new Error(`File not found: ${options.inputPath}`);
  }

  const fileContent = readFileSync(options.inputPath);

  let jsonData: string;

  // Detection order:
  // 1. CST\0 (encrypted) -> decrypt, then check for gzip
  // 2. gzip magic 0x1f 0x8b (compressed, unencrypted)
  // 3. plain JSON (v1.0 backward compat)
  if (fileContent.length >= 4 && fileContent.subarray(0, 4).equals(ENCRYPTED_MAGIC)) {
    if (!options.password) {
      throw new Error('Archive is encrypted. Please provide a password.');
    }
    const encryptedData = deserializeEncrypted(fileContent.subarray(4));
    const decrypted = decrypt(encryptedData, options.password);

    // Check if decrypted data is gzipped
    if (decrypted.length >= 2 && decrypted[0] === 0x1f && decrypted[1] === 0x8b) {
      jsonData = gunzipSync(decrypted).toString('utf-8');
    } else {
      jsonData = decrypted.toString('utf-8');
    }
  } else if (
    fileContent.length >= 2 &&
    fileContent[0] === GZIP_MAGIC[0] &&
    fileContent[1] === GZIP_MAGIC[1]
  ) {
    jsonData = gunzipSync(fileContent).toString('utf-8');
  } else {
    jsonData = fileContent.toString('utf-8');
  }

  const archive = JSON.parse(jsonData) as Archive;

  // Validate
  const validation = validateArchive(archive);
  for (const warning of validation.warnings) {
    log.warn(warning);
  }
  if (!validation.valid) {
    throw new Error(`Invalid archive: ${validation.errors.join('; ')}`);
  }

  // Normalize v1.0 archives
  if (!archive.vectors) {
    archive.vectors = [];
  }

  const result: ImportResult = {
    chunkCount: archive.chunks.length,
    edgeCount: archive.edges.length,
    clusterCount: archive.clusters.length,
    vectorCount: archive.vectors.length,
    dryRun: !!options.dryRun,
  };

  if (options.dryRun) {
    log.info('Dry run — no changes made', { ...result });
    return result;
  }

  const db = getDb();

  // Ensure vectors table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS vectors (
      id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      orphaned_at TEXT DEFAULT NULL,
      last_accessed TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Start transaction
  const transaction = db.transaction(() => {
    if (!options.merge) {
      // Clear existing data
      db.prepare('DELETE FROM chunk_clusters').run();
      db.prepare('DELETE FROM clusters').run();
      db.prepare('DELETE FROM edges').run();
      db.prepare('DELETE FROM vectors').run();
      db.prepare('DELETE FROM chunks').run();
    }

    // Import chunks
    const insertChunk = db.prepare(`
      INSERT OR REPLACE INTO chunks (id, session_id, session_slug, project_path, content, start_time, end_time, turn_indices)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const chunk of archive.chunks) {
      insertChunk.run(
        chunk.id,
        chunk.sessionId ?? '',
        chunk.sessionSlug,
        chunk.projectPath ?? null,
        chunk.content,
        chunk.startTime,
        chunk.endTime,
        JSON.stringify(chunk.turnIndices),
      );
    }

    // Import edges
    const insertEdge = db.prepare(`
      INSERT OR REPLACE INTO edges (id, source_chunk_id, target_chunk_id, edge_type, reference_type, initial_weight, created_at, link_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const edge of archive.edges) {
      insertEdge.run(
        edge.id ?? generateId(),
        edge.source,
        edge.target,
        edge.type,
        edge.referenceType ?? null,
        edge.weight,
        new Date().toISOString(),
        edge.linkCount ?? 1,
      );
    }

    // Import clusters
    const insertCluster = db.prepare(`
      INSERT OR REPLACE INTO clusters (id, name, description, centroid, exemplar_ids, membership_hash)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertMember = db.prepare(`
      INSERT OR REPLACE INTO chunk_clusters (chunk_id, cluster_id, distance)
      VALUES (?, ?, ?)
    `);
    for (const cluster of archive.clusters) {
      insertCluster.run(
        cluster.id,
        cluster.name,
        cluster.description,
        cluster.centroid ? serializeEmbedding(cluster.centroid) : null,
        cluster.exemplarIds ? JSON.stringify(cluster.exemplarIds) : null,
        cluster.membershipHash ?? null,
      );

      // Handle both v1.1 (members with distance) and v1.0 compat (memberChunkIds)
      const members: ClusterMember[] =
        cluster.members ??
        ((cluster as unknown as { memberChunkIds?: string[] }).memberChunkIds)?.map(
          (id) => ({ chunkId: id, distance: 0 }),
        ) ??
        [];
      for (const member of members) {
        insertMember.run(member.chunkId, cluster.id, member.distance);
      }
    }

    // Import vectors
    if (archive.vectors.length > 0) {
      const insertVector = db.prepare(`
        INSERT OR REPLACE INTO vectors (id, embedding, orphaned_at, last_accessed)
        VALUES (?, ?, NULL, CURRENT_TIMESTAMP)
      `);
      for (const vector of archive.vectors) {
        insertVector.run(vector.chunkId, serializeEmbedding(vector.embedding));
      }
    }
  });

  transaction();

  log.info('Import completed', { ...result });
  return result;
}

/**
 * Redact file paths in content.
 */
function redactFilePaths(content: string): string {
  const pathPattern = /(?:\/[\w.-]+)+\.\w+|(?:[A-Z]:\\[\w.-\\]+)|(?:~\/[\w.-\/]+)/g;
  return content.replace(pathPattern, '[REDACTED_PATH]');
}

/**
 * Redact code blocks in content.
 */
function redactCodeBlocks(content: string): string {
  const codeBlockPattern = /```[\s\S]*?```/g;
  return content.replace(codeBlockPattern, '```\n[REDACTED_CODE]\n```');
}
