/**
 * MCP tool definitions for memory operations.
 */

import { recall, predict } from '../retrieval/context-assembler.js';
import {
  searchContext,
  findSimilarChunkIds,
  type SimilarChunkResult,
} from '../retrieval/search-assembler.js';
import { getConfig } from '../config/memory-config.js';
import {
  getChunkCount,
  getChunksByIds,
  getDistinctProjects,
  getSessionsForProject,
  queryChunkIds,
  deleteChunks,
  invalidateProjectsCache,
} from '../storage/chunk-store.js';
import { vectorStore } from '../storage/vector-store.js';
import { getEdgeCount } from '../storage/edge-store.js';
import { getClusterCount } from '../storage/cluster-store.js';
import { reconstructSession, formatReconstruction } from '../retrieval/session-reconstructor.js';
import { readHookStatus, formatHookStatusMcp } from '../hooks/hook-status.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import type { RetrievalResponse } from '../retrieval/context-assembler.js';
import type { SearchResponse } from '../retrieval/search-assembler.js';

const __tools_dirname = dirname(fileURLToPath(import.meta.url));
const toolsPkg = JSON.parse(readFileSync(resolve(__tools_dirname, '../../package.json'), 'utf-8'));
const TOOLS_VERSION: string = toolsPkg.version;

/**
 * Tool definition for MCP.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<string>;
}

/**
 * Format retrieval response as text output.
 * Appends chain walk diagnostics when episodic retrieval falls back to search.
 */
function formatResponse(response: RetrievalResponse): string {
  if (response.chunks.length === 0) {
    return 'No relevant memory found.';
  }

  const header = `Found ${response.chunks.length} relevant memory chunks (${response.tokenCount} tokens):\n\n`;
  let result = header + response.text;

  if (response.diagnostics?.fallbackReason) {
    const d = response.diagnostics;
    const lengths = d.chainLengths.length > 0 ? d.chainLengths.join(', ') : 'none';
    result += `\n\n[Chain walk: fell back to search — ${d.fallbackReason}. Search found ${d.searchResultCount} chunks, ${d.seedCount} seeds, ${d.chainsAttempted} chain(s) attempted, lengths: ${lengths}]`;
  }

  return result;
}

/**
 * Format search response as text output.
 */
function formatSearchResponse(response: SearchResponse): string {
  if (response.chunks.length === 0) {
    return 'No relevant memory found.';
  }

  const header = `Found ${response.chunks.length} relevant memory chunks (${response.tokenCount} tokens):\n\n`;
  return header + response.text;
}

/**
 * Search tool: semantic discovery across memory.
 */
export const searchTool: ToolDefinition = {
  name: 'search',
  description:
    'Search memory semantically to discover relevant past context. Returns ranked results by relevance. Use this for broad discovery — "what do I know about X?"',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What to search for in memory. Be specific about what context you need.',
      },
      project: {
        type: 'string',
        description:
          'Filter to a specific project. Omit to search all. Use list-projects to see available projects.',
      },
    },
    required: ['query'],
  },
  handler: async (args) => {
    const query = args.query as string;
    const project = args.project as string | undefined;
    const config = getConfig();

    const response = await searchContext({
      query,
      maxTokens: config.mcpMaxResponseTokens,
      projectFilter: project,
    });

    return formatSearchResponse(response);
  },
};

/**
 * Recall tool: episodic memory walking backward through causal chains.
 */
export const recallTool: ToolDefinition = {
  name: 'recall',
  description:
    'Recall episodic memory — walk backward through causal chains to reconstruct narrative context. Use for "how did we solve the auth bug?" or "what led to this decision?" Returns ordered narrative (problem → solution).',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What to recall from memory. Be specific about what context you need.',
      },
      project: {
        type: 'string',
        description:
          'Filter to a specific project. Omit to search all. Use list-projects to see available projects.',
      },
    },
    required: ['query'],
  },
  handler: async (args) => {
    const query = args.query as string;
    const project = args.project as string | undefined;
    const config = getConfig();

    const response = await recall(query, {
      maxTokens: config.mcpMaxResponseTokens,
      projectFilter: project,
    });

    return formatResponse(response);
  },
};

/**
 * Predict tool: episodic memory walking forward through causal chains.
 */
export const predictTool: ToolDefinition = {
  name: 'predict',
  description:
    'Predict what context or topics might be relevant based on current discussion. Walks forward through causal chains to surface likely next steps. Use this proactively to surface potentially useful past context.',
  inputSchema: {
    type: 'object',
    properties: {
      context: {
        type: 'string',
        description: 'Current context or topic being discussed.',
      },
      project: {
        type: 'string',
        description:
          'Filter to a specific project. Omit to search all. Use list-projects to see available projects.',
      },
    },
    required: ['context'],
  },
  handler: async (args) => {
    const context = args.context as string;
    const project = args.project as string | undefined;
    const config = getConfig();

    const response = await predict(context, {
      maxTokens: config.mcpMaxResponseTokens,
      projectFilter: project,
    });

    if (response.chunks.length === 0) {
      return 'No predictions available based on current context.';
    }

    const header = `Potentially relevant context (${response.chunks.length} items):\n\n`;
    let result = header + response.text;

    if (response.diagnostics?.fallbackReason) {
      const d = response.diagnostics;
      const lengths = d.chainLengths.length > 0 ? d.chainLengths.join(', ') : 'none';
      result += `\n\n[Chain walk: fell back to search — ${d.fallbackReason}. Search found ${d.searchResultCount} chunks, ${d.seedCount} seeds, ${d.chainsAttempted} chain(s) attempted, lengths: ${lengths}]`;
    }

    return result;
  },
};

/**
 * List projects tool: discover available projects for filtering.
 */
export const listProjectsTool: ToolDefinition = {
  name: 'list-projects',
  description:
    'List all projects in memory with chunk counts and date ranges. Use to discover available project names for filtering search/recall/predict.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async () => {
    const projects = getDistinctProjects();

    if (projects.length === 0) {
      return 'No projects found in memory.';
    }

    const lines = projects.map((p) => {
      const first = new Date(p.firstSeen).toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      });
      const last = new Date(p.lastSeen).toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      });
      const range = first === last ? first : `${first} – ${last}`;
      return `- ${p.slug} (${p.chunkCount} chunks, ${range})`;
    });

    return `Projects in memory:\n${lines.join('\n')}`;
  },
};

/**
 * List sessions tool: browse available sessions for a project.
 */
export const listSessionsTool: ToolDefinition = {
  name: 'list-sessions',
  description:
    'List sessions for a project with chunk counts, time ranges, and token totals. Use to browse available sessions before reconstructing context.',
  inputSchema: {
    type: 'object',
    properties: {
      project: {
        type: 'string',
        description: 'Project slug (required). Use list-projects to discover available projects.',
      },
      from: {
        type: 'string',
        description: 'Start date filter (ISO 8601). Optional.',
      },
      to: {
        type: 'string',
        description: 'End date filter (ISO 8601). Optional.',
      },
      days_back: {
        type: 'number',
        description: 'Look back N days from now. Alternative to from/to.',
      },
    },
    required: ['project'],
  },
  handler: async (args) => {
    const project = args.project as string;
    let from = args.from as string | undefined;
    let to = args.to as string | undefined;
    const daysBack = args.days_back as number | undefined;

    if (daysBack !== null && daysBack !== undefined) {
      to = new Date().toISOString();
      from = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
    }

    const sessions = getSessionsForProject(project, from, to);

    if (sessions.length === 0) {
      return `No sessions found for project "${project}".`;
    }

    const lines = sessions.map((s) => {
      const start = new Date(s.firstChunkTime).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
      const end = new Date(s.lastChunkTime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });
      return `- ${s.sessionId.slice(0, 8)} (${start} – ${end}, ${s.chunkCount} chunks, ${s.totalTokens} tokens)`;
    });

    return `Sessions for "${project}" (${sessions.length} total):\n${lines.join('\n')}`;
  },
};

/**
 * Reconstruct tool: rebuild session context by time range.
 */
export const reconstructTool: ToolDefinition = {
  name: 'reconstruct',
  description:
    'Rebuild session context for a project by time range. Returns chronological chunks with session boundary markers. Use for "what did I work on yesterday?", "show me the last session", etc.',
  inputSchema: {
    type: 'object',
    properties: {
      project: {
        type: 'string',
        description: 'Project slug (required). Use list-projects to discover available projects.',
      },
      session_id: {
        type: 'string',
        description: 'Specific session ID to reconstruct.',
      },
      from: {
        type: 'string',
        description: 'Start date (ISO 8601).',
      },
      to: {
        type: 'string',
        description: 'End date (ISO 8601).',
      },
      days_back: {
        type: 'number',
        description: 'Look back N days from now.',
      },
      previous_session: {
        type: 'boolean',
        description: 'Get the session before the current one.',
      },
      current_session_id: {
        type: 'string',
        description: 'Current session ID (required when previous_session is true).',
      },
      keep_newest: {
        type: 'boolean',
        description: 'Keep newest chunks when truncating to fit token budget (default: true).',
      },
    },
    required: ['project'],
  },
  handler: async (args) => {
    const project = args.project as string;
    const config = getConfig();

    try {
      const result = reconstructSession({
        project,
        sessionId: args.session_id as string | undefined,
        from: args.from as string | undefined,
        to: args.to as string | undefined,
        daysBack: args.days_back as number | undefined,
        previousSession: args.previous_session as boolean | undefined,
        currentSessionId: args.current_session_id as string | undefined,
        maxTokens: config.mcpMaxResponseTokens,
        keepNewest: (args.keep_newest as boolean | undefined) ?? true,
      });

      return formatReconstruction(result);
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/**
 * Hook status tool: check when hooks last ran and whether they succeeded.
 */
export const hookStatusTool: ToolDefinition = {
  name: 'hook-status',
  description:
    'Check when causantic hooks last ran and whether they succeeded. Use for diagnosing whether hooks are firing correctly after setup or configuration changes.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async () => {
    const status = readHookStatus();
    return formatHookStatusMcp(status);
  },
};

/**
 * Stats tool: memory statistics and version info.
 */
export const statsTool: ToolDefinition = {
  name: 'stats',
  description:
    'Show memory statistics including version, chunk/edge/cluster counts, and per-project breakdowns. Use to check system health and memory usage.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async () => {
    const chunks = getChunkCount();
    const edges = getEdgeCount();
    const clusters = getClusterCount();
    const projects = getDistinctProjects();

    const lines = [
      `Causantic v${TOOLS_VERSION}`,
      '',
      'Memory Statistics:',
      `- Chunks: ${chunks}`,
      `- Edges: ${edges}`,
      `- Clusters: ${clusters}`,
    ];

    if (projects.length > 0) {
      lines.push('', 'Projects:');
      for (const p of projects) {
        const first = new Date(p.firstSeen).toLocaleDateString('en-US', {
          month: 'short',
          year: 'numeric',
        });
        const last = new Date(p.lastSeen).toLocaleDateString('en-US', {
          month: 'short',
          year: 'numeric',
        });
        const range = first === last ? first : `${first} – ${last}`;
        lines.push(`- ${p.slug}: ${p.chunkCount} chunks (${range})`);
      }
    }

    return lines.join('\n');
  },
};

/**
 * Format a semantic dry-run preview showing top matches with scores and distribution.
 */
function formatSemanticDryRun(
  matches: SimilarChunkResult[],
  query: string,
  threshold: number,
  project: string,
): string {
  const thresholdPct = Math.round(threshold * 100);
  const lines: string[] = [
    `Dry run: ${matches.length} chunk(s) match query "${query}" (threshold: ${thresholdPct}%, project: "${project}")`,
  ];

  // Score distribution
  const scores = matches.map((m) => m.score);
  const maxScore = Math.round(Math.max(...scores) * 100);
  const minScore = Math.round(Math.min(...scores) * 100);
  const sorted = [...scores].sort((a, b) => a - b);
  const medianScore = Math.round(
    (sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)]) * 100,
  );
  lines.push(`Scores: ${maxScore}% max, ${minScore}% min, ${medianScore}% median`);

  // Top 5 previews
  const topN = Math.min(5, matches.length);
  const topMatches = matches.slice(0, topN);
  const chunks = getChunksByIds(topMatches.map((m) => m.id));
  const chunkMap = new Map(chunks.map((c) => [c.id, c]));

  lines.push('');
  lines.push('Top matches:');
  for (let i = 0; i < topN; i++) {
    const match = topMatches[i];
    const chunk = chunkMap.get(match.id);
    const scorePct = Math.round(match.score * 100);
    const preview = chunk ? chunk.content.split('\n')[0].slice(0, 80) : '(chunk not found)';
    const date = chunk
      ? new Date(chunk.startTime).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : '';
    lines.push(`  ${i + 1}. [${scorePct}%] "${preview}" (${date})`);
  }

  if (matches.length > topN) {
    lines.push(`  ...and ${matches.length - topN} more`);
  }

  // Threshold suggestion when many matches
  if (matches.length > 20) {
    const higher1 = Math.min(99, thresholdPct + 10);
    const higher2 = Math.min(99, thresholdPct + 20);
    lines.push('');
    lines.push(
      `Tip: Try threshold ${higher1 / 100} or ${higher2 / 100} for more selective results.`,
    );
  }

  lines.push('Set dry_run=false to proceed with deletion.');
  return lines.join('\n');
}

/**
 * Format the top N deleted chunks for confirmation display.
 */
function formatDeletedPreview(matches: SimilarChunkResult[], n: number): string {
  const topN = matches.slice(0, n);
  const chunks = getChunksByIds(topN.map((m) => m.id));
  const chunkMap = new Map(chunks.map((c) => [c.id, c]));

  const lines: string[] = ['', 'Top deleted:'];
  for (let i = 0; i < topN.length; i++) {
    const match = topN[i];
    const chunk = chunkMap.get(match.id);
    const scorePct = Math.round(match.score * 100);
    const preview = chunk ? chunk.content.split('\n')[0].slice(0, 80) : '(chunk not found)';
    const date = chunk
      ? new Date(chunk.startTime).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : '';
    lines.push(`  ${i + 1}. [${scorePct}%] "${preview}" (${date})`);
  }
  return lines.join('\n');
}

/**
 * Forget tool: delete chunks from memory by project, time range, session, or topic.
 */
export const forgetTool: ToolDefinition = {
  name: 'forget',
  description:
    'Delete chunks from memory filtered by project, time range, session, or semantic query. Requires project. Defaults to dry_run=true (preview only). Set dry_run=false to actually delete.',
  inputSchema: {
    type: 'object',
    properties: {
      project: {
        type: 'string',
        description: 'Project slug (required). Use list-projects to see available projects.',
      },
      before: {
        type: 'string',
        description: 'Delete chunks before this ISO 8601 date. Optional.',
      },
      after: {
        type: 'string',
        description: 'Delete chunks on or after this ISO 8601 date. Optional.',
      },
      session_id: {
        type: 'string',
        description: 'Delete chunks from a specific session. Optional.',
      },
      query: {
        type: 'string',
        description:
          'Semantic query for topic-based deletion (e.g., "authentication flow"). Finds similar chunks by embedding similarity. Can combine with before/after/session_id (AND logic).',
      },
      threshold: {
        type: 'number',
        description:
          'Similarity threshold (0-1 or 0-100, default 0.6). Higher = more selective. Values >1 treated as percentages. Only used when query is provided.',
      },
      dry_run: {
        type: 'boolean',
        description: 'Preview without deleting (default: true). Set to false to actually delete.',
      },
    },
    required: ['project'],
  },
  handler: async (args) => {
    const project = args.project as string;
    const before = args.before as string | undefined;
    const after = args.after as string | undefined;
    const sessionId = args.session_id as string | undefined;
    const query = args.query as string | undefined;
    const threshold = args.threshold as number | undefined;
    const dryRun = (args.dry_run as boolean | undefined) ?? true;

    // Validate query is not empty/whitespace
    if (query !== undefined && typeof query === 'string' && query.trim() === '') {
      return 'Error: query must not be empty.';
    }

    const hasTimeFilters = before !== undefined || after !== undefined || sessionId !== undefined;

    if (query !== undefined) {
      // Semantic deletion path
      const semanticMatches = await findSimilarChunkIds({ query, project, threshold });

      if (semanticMatches.length === 0) {
        const normalizedThreshold =
          threshold !== undefined && threshold > 1 ? threshold / 100 : (threshold ?? 0.6);
        return `No chunks match query "${query}" at threshold ${Math.round(normalizedThreshold * 100)}%.`;
      }

      let targetIds: string[];

      if (hasTimeFilters) {
        // Intersect semantic matches with time/session filter
        const filterIds = new Set(queryChunkIds({ project, before, after, sessionId }));
        targetIds = semanticMatches.filter((m) => filterIds.has(m.id)).map((m) => m.id);

        if (targetIds.length === 0) {
          return `${semanticMatches.length} chunk(s) matched query but none overlap with the time/session filters.`;
        }
      } else {
        targetIds = semanticMatches.map((m) => m.id);
      }

      // Compute effective threshold for display
      const effectiveThreshold =
        threshold !== undefined && threshold > 1 ? threshold / 100 : (threshold ?? 0.6);

      if (dryRun) {
        // Filter semanticMatches to only those in targetIds for display
        const targetSet = new Set(targetIds);
        const displayMatches = semanticMatches.filter((m) => targetSet.has(m.id));
        return formatSemanticDryRun(displayMatches, query, effectiveThreshold, project);
      }

      // Fetch top 3 previews before deletion
      const previewMatches = semanticMatches.filter((m) => targetIds.includes(m.id)).slice(0, 3);
      const preview = formatDeletedPreview(previewMatches, 3);

      const deleted = deleteChunks(targetIds);
      await vectorStore.deleteBatch(targetIds);
      invalidateProjectsCache();

      return `Deleted ${deleted} chunk(s) from project "${project}" (vectors and related edges/clusters also removed).${preview}`;
    }

    // Non-semantic deletion path (existing behavior)
    const ids = queryChunkIds({ project, before, after, sessionId });

    if (ids.length === 0) {
      return 'No chunks match the given filters.';
    }

    if (dryRun) {
      return `Dry run: ${ids.length} chunk(s) would be deleted from project "${project}". Set dry_run=false to proceed.`;
    }

    const deleted = deleteChunks(ids);
    await vectorStore.deleteBatch(ids);
    invalidateProjectsCache();

    return `Deleted ${deleted} chunk(s) from project "${project}" (vectors and related edges/clusters also removed).`;
  },
};

/**
 * All available tools.
 */
export const tools: ToolDefinition[] = [
  searchTool,
  recallTool,
  predictTool,
  listProjectsTool,
  listSessionsTool,
  reconstructTool,
  hookStatusTool,
  statsTool,
  forgetTool,
];

/**
 * Get tool by name.
 */
export function getTool(name: string): ToolDefinition | undefined {
  return tools.find((t) => t.name === name);
}
