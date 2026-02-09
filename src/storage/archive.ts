/**
 * Export/import functionality for ECM memory data.
 *
 * Supports encrypted and unencrypted archives.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { encrypt, decrypt, serializeEncrypted, deserializeEncrypted } from './encryption.js';
import { getDb } from './db.js';

/** Archive format version */
const ARCHIVE_VERSION = '1.0';

/** Magic bytes for encrypted archives */
const ENCRYPTED_MAGIC = Buffer.from('ECM\x00');

/** Archive metadata */
export interface ArchiveMetadata {
  version: string;
  created: string;
  chunkCount: number;
  edgeCount: number;
  clusterCount: number;
  projects: string[];
}

/** Chunk data for export */
export interface ExportedChunk {
  id: string;
  sessionSlug: string;
  content: string;
  startTime: string;
  endTime: string;
  turnIndices: number[];
  vectorClock: Record<string, number>;
}

/** Edge data for export */
export interface ExportedEdge {
  source: string;
  target: string;
  type: string;
  referenceType: string;
  weight: number;
  vectorClock: Record<string, number>;
}

/** Cluster data for export */
export interface ExportedCluster {
  id: string;
  name: string;
  description: string | null;
  memberChunkIds: string[];
}

/** Complete archive structure */
export interface Archive {
  format: 'ecm-archive';
  version: string;
  created: string;
  metadata: ArchiveMetadata;
  chunks: ExportedChunk[];
  edges: ExportedEdge[];
  clusters: ExportedCluster[];
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
}

/** Import options */
export interface ImportOptions {
  /** Input file path */
  inputPath: string;
  /** Decryption password (required if encrypted) */
  password?: string;
  /** Merge with existing data */
  merge?: boolean;
}

/**
 * Export memory data to an archive.
 */
export async function exportArchive(options: ExportOptions): Promise<void> {
  const db = getDb();

  // Get unique projects
  const projectsResult = db.prepare(
    'SELECT DISTINCT session_slug FROM chunks'
  ).all() as { session_slug: string }[];
  const allProjects = projectsResult.map((r) => r.session_slug);

  // Filter projects if specified
  const targetProjects = options.projects ?? allProjects;

  // Export chunks
  const chunksQuery = db.prepare(`
    SELECT id, session_slug, content, start_time, end_time, turn_indices, vector_clock
    FROM chunks
    WHERE session_slug IN (${targetProjects.map(() => '?').join(',')})
  `);
  const chunksResult = chunksQuery.all(...targetProjects) as Array<{
    id: string;
    session_slug: string;
    content: string;
    start_time: string;
    end_time: string;
    turn_indices: string;
    vector_clock: string;
  }>;

  let chunks: ExportedChunk[] = chunksResult.map((row) => ({
    id: row.id,
    sessionSlug: row.session_slug,
    content: row.content,
    startTime: row.start_time,
    endTime: row.end_time,
    turnIndices: JSON.parse(row.turn_indices || '[]'),
    vectorClock: JSON.parse(row.vector_clock || '{}'),
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

  // Export edges
  const chunkIds = chunks.map((c) => c.id);
  const edgesQuery = db.prepare(`
    SELECT source_id, target_id, type, reference_type, weight, vector_clock
    FROM edges
    WHERE source_id IN (${chunkIds.map(() => '?').join(',')})
  `);
  const edgesResult = edgesQuery.all(...chunkIds) as Array<{
    source_id: string;
    target_id: string;
    type: string;
    reference_type: string;
    weight: number;
    vector_clock: string;
  }>;

  const edges: ExportedEdge[] = edgesResult.map((row) => ({
    source: row.source_id,
    target: row.target_id,
    type: row.type,
    referenceType: row.reference_type,
    weight: row.weight,
    vectorClock: JSON.parse(row.vector_clock || '{}'),
  }));

  // Export clusters
  const clustersQuery = db.prepare(`
    SELECT c.id, c.name, c.description, GROUP_CONCAT(cm.chunk_id) as member_ids
    FROM clusters c
    LEFT JOIN cluster_members cm ON c.id = cm.cluster_id
    WHERE cm.chunk_id IN (${chunkIds.map(() => '?').join(',')})
    GROUP BY c.id
  `);
  const clustersResult = clustersQuery.all(...chunkIds) as Array<{
    id: string;
    name: string;
    description: string | null;
    member_ids: string | null;
  }>;

  const clusters: ExportedCluster[] = clustersResult.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    memberChunkIds: row.member_ids?.split(',') ?? [],
  }));

  // Build archive
  const archive: Archive = {
    format: 'ecm-archive',
    version: ARCHIVE_VERSION,
    created: new Date().toISOString(),
    metadata: {
      version: ARCHIVE_VERSION,
      created: new Date().toISOString(),
      chunkCount: chunks.length,
      edgeCount: edges.length,
      clusterCount: clusters.length,
      projects: targetProjects,
    },
    chunks,
    edges,
    clusters,
  };

  // Serialize
  const jsonData = JSON.stringify(archive, null, 2);

  // Write output
  if (options.password) {
    // Encrypted
    const encrypted = encrypt(Buffer.from(jsonData, 'utf-8'), options.password);
    const serialized = serializeEncrypted(encrypted);
    const output = Buffer.concat([ENCRYPTED_MAGIC, serialized]);
    writeFileSync(options.outputPath, output);
  } else {
    // Unencrypted
    writeFileSync(options.outputPath, jsonData);
  }

  console.log(`Exported ${chunks.length} chunks, ${edges.length} edges, ${clusters.length} clusters`);
}

/**
 * Import memory data from an archive.
 */
export async function importArchive(options: ImportOptions): Promise<void> {
  if (!existsSync(options.inputPath)) {
    throw new Error(`File not found: ${options.inputPath}`);
  }

  const fileContent = readFileSync(options.inputPath);

  let jsonData: string;

  // Check if encrypted
  if (fileContent.subarray(0, 4).equals(ENCRYPTED_MAGIC)) {
    if (!options.password) {
      throw new Error('Archive is encrypted. Please provide a password.');
    }
    const encryptedData = deserializeEncrypted(fileContent.subarray(4));
    const decrypted = decrypt(encryptedData, options.password);
    jsonData = decrypted.toString('utf-8');
  } else {
    jsonData = fileContent.toString('utf-8');
  }

  const archive = JSON.parse(jsonData) as Archive;

  if (archive.format !== 'ecm-archive') {
    throw new Error('Invalid archive format');
  }

  const db = getDb();

  // Start transaction
  const transaction = db.transaction(() => {
    if (!options.merge) {
      // Clear existing data
      db.prepare('DELETE FROM cluster_members').run();
      db.prepare('DELETE FROM clusters').run();
      db.prepare('DELETE FROM edges').run();
      db.prepare('DELETE FROM chunks').run();
    }

    // Import chunks
    const insertChunk = db.prepare(`
      INSERT OR REPLACE INTO chunks (id, session_slug, content, start_time, end_time, turn_indices, vector_clock)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const chunk of archive.chunks) {
      insertChunk.run(
        chunk.id,
        chunk.sessionSlug,
        chunk.content,
        chunk.startTime,
        chunk.endTime,
        JSON.stringify(chunk.turnIndices),
        JSON.stringify(chunk.vectorClock)
      );
    }

    // Import edges
    const insertEdge = db.prepare(`
      INSERT OR REPLACE INTO edges (source_id, target_id, type, reference_type, weight, vector_clock)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const edge of archive.edges) {
      insertEdge.run(
        edge.source,
        edge.target,
        edge.type,
        edge.referenceType,
        edge.weight,
        JSON.stringify(edge.vectorClock)
      );
    }

    // Import clusters
    const insertCluster = db.prepare(`
      INSERT OR REPLACE INTO clusters (id, name, description)
      VALUES (?, ?, ?)
    `);
    const insertMember = db.prepare(`
      INSERT OR REPLACE INTO cluster_members (cluster_id, chunk_id)
      VALUES (?, ?)
    `);
    for (const cluster of archive.clusters) {
      insertCluster.run(cluster.id, cluster.name, cluster.description);
      for (const memberId of cluster.memberChunkIds) {
        insertMember.run(cluster.id, memberId);
      }
    }
  });

  transaction();

  console.log(`Imported ${archive.chunks.length} chunks, ${archive.edges.length} edges, ${archive.clusters.length} clusters`);
}

/**
 * Redact file paths in content.
 */
function redactFilePaths(content: string): string {
  // Match common file path patterns
  const pathPattern = /(?:\/[\w.-]+)+\.\w+|(?:[A-Z]:\\[\w.-\\]+)|(?:~\/[\w.-\/]+)/g;
  return content.replace(pathPattern, '[REDACTED_PATH]');
}

/**
 * Redact code blocks in content.
 */
function redactCodeBlocks(content: string): string {
  // Match markdown code blocks
  const codeBlockPattern = /```[\s\S]*?```/g;
  return content.replace(codeBlockPattern, '```\n[REDACTED_CODE]\n```');
}
