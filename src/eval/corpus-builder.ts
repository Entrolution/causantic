/**
 * Build a test corpus from real Claude Code sessions.
 *
 * Samples chunks uniformly across the code-ratio spectrum per session.
 */

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readSessionMessages, getSessionInfo } from '../parser/session-reader.js';
import { assembleTurns } from '../parser/turn-assembler.js';
import { chunkTurns, resetChunkCounter } from '../parser/chunker.js';
import type { Chunk, RenderMode, SessionInfo } from '../parser/types.js';

export interface CorpusConfig {
  /** Paths to session JSONL files. */
  sessionPaths: string[];
  /** Max chunks per session. Default: 30. */
  maxChunksPerSession?: number;
  /** Target max tokens per chunk. Default: 4096. */
  maxTokensPerChunk?: number;
  /** Include thinking blocks. Default: true. */
  includeThinking?: boolean;
  /** Render mode for chunking. Default: 'full'. */
  renderMode?: RenderMode;
}

export interface Corpus {
  chunks: Chunk[];
  sessions: SessionInfo[];
  config: CorpusConfig;
  builtAt: string;
}

/**
 * Compute code ratio for a chunk (0 = pure NL, 1 = pure code).
 */
function codeRatio(chunk: Chunk): number {
  const codeMarkers = (chunk.text.match(/```/g)?.length ?? 0) / 2;
  const toolResults = chunk.metadata.toolUseCount;
  const totalSignals = codeMarkers + toolResults + 1; // +1 to avoid div by zero
  return (codeMarkers + toolResults * 0.5) / totalSignals;
}

/**
 * Sample chunks uniformly across the code-ratio spectrum.
 */
function sampleUniformByCodeRatio(chunks: Chunk[], maxCount: number): Chunk[] {
  if (chunks.length <= maxCount) return chunks;

  // Sort by code ratio
  const sorted = [...chunks].sort((a, b) => codeRatio(a) - codeRatio(b));

  // Sample evenly across the sorted array
  const step = (sorted.length - 1) / (maxCount - 1);
  const sampled: Chunk[] = [];
  for (let i = 0; i < maxCount; i++) {
    const idx = Math.round(i * step);
    sampled.push(sorted[idx]);
  }

  return sampled;
}

/**
 * Build a test corpus from session files.
 */
export async function buildCorpus(config: CorpusConfig): Promise<Corpus> {
  const {
    sessionPaths,
    maxChunksPerSession = 30,
    maxTokensPerChunk = 4096,
    includeThinking = true,
    renderMode = 'full',
  } = config;

  resetChunkCounter();

  const allChunks: Chunk[] = [];
  const sessions: SessionInfo[] = [];

  for (const sessionPath of sessionPaths) {
    const info = await getSessionInfo(sessionPath);
    sessions.push(info);

    const messages = await readSessionMessages(sessionPath);
    const turns = assembleTurns(messages);
    const chunks = chunkTurns(turns, {
      maxTokens: maxTokensPerChunk,
      sessionId: info.sessionId,
      sessionSlug: info.slug,
      includeThinking,
      renderMode,
    });

    const sampled = sampleUniformByCodeRatio(chunks, maxChunksPerSession);
    allChunks.push(...sampled);

    console.log(
      `  ${info.slug}: ${messages.length} messages -> ${turns.length} turns -> ${chunks.length} chunks -> ${sampled.length} sampled`,
    );
  }

  return {
    chunks: allChunks,
    sessions,
    config,
    builtAt: new Date().toISOString(),
  };
}

/**
 * Discover session JSONL files in a Claude Code projects directory.
 */
export async function discoverSessions(projectDir: string): Promise<string[]> {
  const entries = await readdir(projectDir);
  const jsonlFiles: string[] = [];

  for (const entry of entries) {
    if (entry.endsWith('.jsonl')) {
      const fullPath = join(projectDir, entry);
      const stats = await stat(fullPath);
      if (stats.isFile() && stats.size > 1000) {
        jsonlFiles.push(fullPath);
      }
    }
  }

  // Sort by file size descending — richest sessions first
  const withSizes = await Promise.all(
    jsonlFiles.map(async (f) => ({ path: f, size: (await stat(f)).size })),
  );
  withSizes.sort((a, b) => b.size - a.size);
  return withSizes.map((f) => f.path);
}
