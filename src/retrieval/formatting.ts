/**
 * Shared formatting utilities for chunk output in search and chain assemblers.
 */

import type { StoredChunk } from '../storage/types.js';

/**
 * Format the common header parts shared by both search and chain output.
 */
function formatChunkHeader(chunk: StoredChunk): { date: string; agentPart: string } {
  const date = new Date(chunk.startTime).toLocaleDateString();
  const agentPart = chunk.agentId && chunk.agentId !== 'ui' ? ` | Agent: ${chunk.agentId}` : '';
  return { date, agentPart };
}

/**
 * Format a chunk for search output (with relevance percentage).
 */
export function formatSearchChunk(chunk: StoredChunk, content: string, weight: number): string {
  const { date, agentPart } = formatChunkHeader(chunk);
  const relevance = (weight * 100).toFixed(0);
  return `[Session: ${chunk.sessionSlug}${agentPart} | Date: ${date} | Relevance: ${relevance}%]\n${content}`;
}

/**
 * Format a chunk for chain output (with position/total).
 */
export function formatChainChunk(
  chunk: StoredChunk,
  content: string,
  position: number,
  total: number,
): string {
  const { date, agentPart } = formatChunkHeader(chunk);
  return `[${position}/${total} | Session: ${chunk.sessionSlug}${agentPart} | Date: ${date}]\n${content}`;
}
