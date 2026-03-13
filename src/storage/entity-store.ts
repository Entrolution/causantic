/**
 * CRUD operations for entity tables.
 *
 * Stores extracted entities, aliases, and chunk mentions.
 * Follows session-state-store.ts patterns: uses getDb(), snake_case DB / camelCase JS.
 */

import { getDb, generateId } from './db.js';
import type { EntityType } from '../ingest/entity-extractor.js';

/** A stored entity. */
export interface StoredEntity {
  id: string;
  entityType: EntityType;
  canonicalName: string;
  projectSlug: string;
  createdAt: string;
  updatedAt: string;
}

/** DB row shape. */
interface DbEntityRow {
  id: string;
  entity_type: string;
  canonical_name: string;
  project_slug: string;
  created_at: string;
  updated_at: string;
}

function rowToEntity(row: DbEntityRow): StoredEntity {
  return {
    id: row.id,
    entityType: row.entity_type as EntityType,
    canonicalName: row.canonical_name,
    projectSlug: row.project_slug,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Resolve or create an entity from a mention.
 *
 * 1. Look up (normalizedName, entityType, project_slug) in entity_aliases
 * 2. Found → return existing entity_id
 * 3. Not found → create entity + alias, return new ID
 * 4. If mentionForm differs from normalizedName, add as additional alias
 */
export function resolveEntity(
  normalizedName: string,
  entityType: EntityType,
  mentionForm: string,
  projectSlug: string,
): string {
  const db = getDb();

  // Look up by alias
  const existing = db
    .prepare(
      'SELECT entity_id FROM entity_aliases WHERE alias = ? AND entity_type = ? AND project_slug = ?',
    )
    .get(normalizedName, entityType, projectSlug) as { entity_id: string } | undefined;

  if (existing) {
    // Add mentionForm as additional alias if different
    const mentionNormalized = mentionForm.toLowerCase();
    if (mentionNormalized !== normalizedName) {
      db.prepare(
        'INSERT OR IGNORE INTO entity_aliases (alias, entity_id, entity_type, project_slug) VALUES (?, ?, ?, ?)',
      ).run(mentionNormalized, existing.entity_id, entityType, projectSlug);
    }
    return existing.entity_id;
  }

  // Create new entity
  const entityId = generateId();
  db.prepare(
    'INSERT INTO entities (id, entity_type, canonical_name, project_slug) VALUES (?, ?, ?, ?)',
  ).run(entityId, entityType, normalizedName, projectSlug);

  // Add primary alias
  db.prepare(
    'INSERT OR IGNORE INTO entity_aliases (alias, entity_id, entity_type, project_slug) VALUES (?, ?, ?, ?)',
  ).run(normalizedName, entityId, entityType, projectSlug);

  // Add mentionForm as alias if different
  const mentionNormalized = mentionForm.toLowerCase();
  if (mentionNormalized !== normalizedName) {
    db.prepare(
      'INSERT OR IGNORE INTO entity_aliases (alias, entity_id, entity_type, project_slug) VALUES (?, ?, ?, ?)',
    ).run(mentionNormalized, entityId, entityType, projectSlug);
  }

  return entityId;
}

/**
 * Insert an entity mention for a chunk.
 * Uses INSERT OR IGNORE to handle re-ingestion safely.
 */
export function insertEntityMention(
  chunkId: string,
  entityId: string,
  mentionForm: string,
  confidence: number,
): void {
  const db = getDb();
  db.prepare(
    'INSERT OR IGNORE INTO entity_mentions (chunk_id, entity_id, mention_form, confidence) VALUES (?, ?, ?, ?)',
  ).run(chunkId, entityId, mentionForm, confidence);
}

/**
 * Get chunk IDs for an entity, ordered by most recent first.
 * Capped at `limit` to avoid performance degradation for frequent entities.
 */
export function getChunkIdsForEntity(entityId: string, limit: number = 100): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT em.chunk_id FROM entity_mentions em
       JOIN chunks c ON c.id = em.chunk_id
       WHERE em.entity_id = ?
       ORDER BY c.start_time DESC
       LIMIT ?`,
    )
    .all(entityId, limit) as Array<{ chunk_id: string }>;

  return rows.map((r) => r.chunk_id);
}

/**
 * Find entities by alias within a project.
 */
export function findEntitiesByAlias(
  alias: string,
  entityType: EntityType,
  projectSlug: string,
): StoredEntity[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT e.* FROM entities e
       JOIN entity_aliases ea ON ea.entity_id = e.id
       WHERE ea.alias = ? AND ea.entity_type = ? AND ea.project_slug = ?`,
    )
    .all(alias, entityType, projectSlug) as DbEntityRow[];

  return rows.map(rowToEntity);
}

/**
 * Get entities mentioned in a specific chunk.
 */
export function getEntitiesForChunk(chunkId: string): StoredEntity[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT e.* FROM entities e
       JOIN entity_mentions em ON em.entity_id = e.id
       WHERE em.chunk_id = ?`,
    )
    .all(chunkId) as DbEntityRow[];

  return rows.map(rowToEntity);
}

/**
 * Get total entity count, optionally filtered by project.
 */
export function getEntityCount(projectSlug?: string): number {
  const db = getDb();
  if (projectSlug) {
    return (
      db
        .prepare('SELECT COUNT(*) as count FROM entities WHERE project_slug = ?')
        .get(projectSlug) as { count: number }
    ).count;
  }
  return (db.prepare('SELECT COUNT(*) as count FROM entities').get() as { count: number }).count;
}
