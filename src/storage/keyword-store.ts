/**
 * FTS5-backed keyword search for chunks.
 *
 * Provides BM25-ranked full-text search using SQLite FTS5 with porter stemming.
 * Mirrors VectorStore's project-filtering pattern.
 */

import { getDb } from './db.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('keyword-store');

export interface KeywordSearchResult {
  id: string;
  score: number;
}

/**
 * Sanitize a query string for FTS5 MATCH syntax.
 * Escapes special characters and strips FTS5 operators.
 */
function sanitizeQuery(query: string): string {
  if (!query || !query.trim()) return '';

  // Remove FTS5 special operators and characters
  let sanitized = query
    // Remove boolean operators (AND, OR, NOT as full words)
    .replace(/\b(AND|OR|NOT)\b/g, '')
    // Escape special FTS5 characters by wrapping terms in double quotes
    // Remove characters that can't be in FTS5 queries
    .replace(/[*"(){}\^~\-]/g, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();

  if (!sanitized) return '';

  // Wrap each word in double quotes for exact matching (bypasses FTS5 operators)
  const terms = sanitized.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return '';

  return terms.map(t => `"${t}"`).join(' ');
}

export class KeywordStore {
  constructor(private db?: ReturnType<typeof getDb>) {}

  private getDatabase() {
    return this.db ?? getDb();
  }

  /**
   * Full-text search with BM25 ranking.
   */
  search(query: string, limit: number): KeywordSearchResult[] {
    const sanitized = sanitizeQuery(query);
    if (!sanitized) return [];

    const db = this.getDatabase();

    try {
      const rows = db.prepare(`
        SELECT chunks.id, bm25(chunks_fts) as score
        FROM chunks_fts
        JOIN chunks ON chunks.rowid = chunks_fts.rowid
        WHERE chunks_fts MATCH ?
        ORDER BY bm25(chunks_fts)
        LIMIT ?
      `).all(sanitized, limit) as Array<{ id: string; score: number }>;

      // bm25() returns negative scores (lower = better match), negate for conventional scoring
      return rows.map(r => ({
        id: r.id,
        score: -r.score,
      }));
    } catch (error) {
      log.warn('Keyword search failed', { error: (error as Error).message });
      return [];
    }
  }

  /**
   * Full-text search filtered by project(s).
   */
  searchByProject(
    query: string,
    projects: string | string[],
    limit: number,
  ): KeywordSearchResult[] {
    const sanitized = sanitizeQuery(query);
    if (!sanitized) return [];

    const db = this.getDatabase();
    const projectList = Array.isArray(projects) ? projects : [projects];
    if (projectList.length === 0) return [];

    const placeholders = projectList.map(() => '?').join(',');

    try {
      const rows = db.prepare(`
        SELECT chunks.id, bm25(chunks_fts) as score
        FROM chunks_fts
        JOIN chunks ON chunks.rowid = chunks_fts.rowid
        WHERE chunks_fts MATCH ?
          AND chunks.session_slug IN (${placeholders})
        ORDER BY bm25(chunks_fts)
        LIMIT ?
      `).all(sanitized, ...projectList, limit) as Array<{ id: string; score: number }>;

      return rows.map(r => ({
        id: r.id,
        score: -r.score,
      }));
    } catch (error) {
      log.warn('Keyword search by project failed', { error: (error as Error).message });
      return [];
    }
  }
}
