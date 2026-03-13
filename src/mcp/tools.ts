/**
 * MCP tool definitions for memory operations.
 */

import { recall, predict } from '../retrieval/context-assembler.js';
import { searchContext, findSimilarChunkIds } from '../retrieval/search-assembler.js';
import { getConfig } from '../config/memory-config.js';
import { recordRetrieval } from '../storage/feedback-store.js';
import {
  getDistinctProjects,
  getSessionsForProject,
  queryChunkIds,
  deleteChunks,
  invalidateProjectsCache,
} from '../storage/chunk-store.js';
import { vectorStore } from '../storage/vector-store.js';
import { deleteIndexEntriesForChunks } from '../storage/index-entry-store.js';
import {
  reconstructSession,
  formatReconstruction,
  buildBriefing,
} from '../retrieval/session-reconstructor.js';
import { searchSessionSummaries } from '../storage/session-state-store.js';
import { readHookStatus, formatHookStatusMcp } from '../hooks/hook-status.js';
import { formatDateRange, formatChunkPreview, buildChunkMap, getMemoryStats } from './services.js';
import { errorMessage } from '../utils/errors.js';
import { buildRepoMap } from '../repomap/index.js';
import type { RetrievalResponse } from '../retrieval/context-assembler.js';
import type { SearchResponse } from '../retrieval/search-assembler.js';
import type { DependencyGraph } from '../repomap/index.js';

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
 * Record retrieval feedback, suppressing errors since it's non-critical.
 */
function recordRetrievalSafe(
  chunks: Array<{ id: string }>,
  query: string,
  type: 'search' | 'recall' | 'predict',
): void {
  if (chunks.length === 0) return;
  try {
    recordRetrieval(
      chunks.map((c) => c.id),
      query,
      type,
    );
  } catch {
    // Non-critical — don't fail the tool response
  }
}

/**
 * Extract common retrieval arguments from tool args.
 */
function extractRetrievalArgs(args: Record<string, unknown>): {
  query: string;
  project: string | undefined;
  agent: string | undefined;
  maxTokens: number;
} {
  const config = getConfig();
  return {
    query: (args.query ?? args.context) as string,
    project: args.project as string | undefined,
    agent: args.agent as string | undefined,
    maxTokens: (args.max_tokens as number | undefined) ?? config.mcpMaxResponseTokens,
  };
}

/**
 * Search tool: semantic discovery across memory.
 */
export const searchTool: ToolDefinition = {
  name: 'search',
  description:
    'Search memory to discover relevant past context. Uses hybrid (BM25 + vector) retrieval with entity boosting. Returns ranked results by relevance. Use this for broad discovery — "what do I know about X?" For recent/latest session queries, use reconstruct instead.',
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
      agent: {
        type: 'string',
        description: 'Filter to a specific agent (e.g., "researcher"). Omit to include all agents.',
      },
      max_tokens: {
        type: 'number',
        description: 'Maximum tokens in response. Defaults to server config.',
      },
    },
    required: ['query'],
  },
  handler: async (args) => {
    const { query, project, agent, maxTokens } = extractRetrievalArgs(args);

    const response = await searchContext({
      query,
      maxTokens,
      projectFilter: project,
      agentFilter: agent,
    });

    const result = formatSearchResponse(response);
    recordRetrievalSafe(response.chunks, query, 'search');

    return result;
  },
};

/**
 * Recall tool: episodic memory walking backward through causal chains.
 */
export const recallTool: ToolDefinition = {
  name: 'recall',
  description:
    'Recall episodic memory — walk backward through causal chains to reconstruct narrative context. Also searches session summaries for supplementary context. Use for "how did we solve the auth bug?" or "what led to this decision?" Returns ordered narrative (problem → solution). For recent/latest session queries, use reconstruct instead.',
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
      agent: {
        type: 'string',
        description: 'Filter to a specific agent (e.g., "researcher"). Omit to include all agents.',
      },
      max_tokens: {
        type: 'number',
        description: 'Maximum tokens in response. Defaults to server config.',
      },
    },
    required: ['query'],
  },
  handler: async (args) => {
    const { query, project, agent, maxTokens } = extractRetrievalArgs(args);

    // Search session summaries for supplementary context
    let summarySection = '';
    try {
      const summaries = searchSessionSummaries(query, project);
      if (summaries.length > 0) {
        const lines = summaries.map((s) => {
          const date = new Date(s.endedAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          });
          return `- [${date}] ${s.summary}`;
        });
        summarySection = `**Session summaries matching "${query}":**\n${lines.join('\n')}\n\n---\n\n`;
      }
    } catch {
      // Non-critical — proceed without summaries
    }

    const response = await recall(query, {
      maxTokens,
      projectFilter: project,
      agentFilter: agent,
    });

    const result = formatResponse(response);
    recordRetrievalSafe(response.chunks, query, 'recall');

    return summarySection + result;
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
      agent: {
        type: 'string',
        description: 'Filter to a specific agent (e.g., "researcher"). Omit to include all agents.',
      },
      max_tokens: {
        type: 'number',
        description: 'Maximum tokens in response. Defaults to server config.',
      },
    },
    required: ['context'],
  },
  handler: async (args) => {
    const { query: context, project, agent, maxTokens } = extractRetrievalArgs(args);

    const response = await predict(context, {
      maxTokens,
      projectFilter: project,
      agentFilter: agent,
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

    recordRetrievalSafe(response.chunks, context, 'predict');

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
      const range = formatDateRange(p.firstSeen, p.lastSeen);
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
      limit: {
        type: 'number',
        description: 'Maximum number of sessions to display (default: 30).',
      },
    },
    required: ['project'],
  },
  handler: async (args) => {
    const project = args.project as string;
    let from = args.from as string | undefined;
    let to = args.to as string | undefined;
    const daysBack = args.days_back as number | undefined;
    const limit = (args.limit as number | undefined) ?? 30;

    if (daysBack !== undefined && daysBack > 0 && from === undefined && to === undefined) {
      to = new Date().toISOString();
      from = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
    }

    const sessions = getSessionsForProject(project, from, to);

    if (sessions.length === 0) {
      return `No sessions found for project "${project}".`;
    }

    const totalCount = sessions.length;
    const truncated = totalCount > limit;
    const displaySessions = truncated ? sessions.slice(0, limit) : sessions;

    const lines = displaySessions.map((s) => {
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

    let output = `Sessions for "${project}" (${totalCount} total):\n${lines.join('\n')}`;
    if (truncated) {
      output += `\n(showing ${limit} of ${totalCount} sessions — use 'from'/'to' to narrow)`;
    }
    return output;
  },
};

/**
 * Reconstruct tool: rebuild session context by time range.
 */
export const reconstructTool: ToolDefinition = {
  name: 'reconstruct',
  description:
    'Use this for all recent/latest/last session queries. Rebuild session context for a project. Call with just project to get the most recent history up to the token budget. Optionally specify a time range with from/to, days_back, session_id, or previous_session. Use mode=briefing for a structured startup summary combining session state and project structure.',
  inputSchema: {
    type: 'object',
    properties: {
      project: {
        type: 'string',
        description: 'Project slug (required). Use list-projects to discover available projects.',
      },
      mode: {
        type: 'string',
        description:
          'Reconstruction mode: "timeline" (default) for chronological chunks, "briefing" for structured session summary with files, outcomes, and project structure.',
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
        description:
          'End date (ISO 8601). When used without from/days_back/session_id, acts as the anchor for timeline mode — returns the most recent chunks before this date.',
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
      agent: {
        type: 'string',
        description: 'Filter to a specific agent (e.g., "researcher"). Omit to include all agents.',
      },
      max_tokens: {
        type: 'number',
        description: 'Maximum tokens in response. Defaults to server config.',
      },
    },
    required: ['project'],
  },
  handler: async (args) => {
    const project = args.project as string;
    const agent = args.agent as string | undefined;
    const mode = (args.mode as string | undefined) ?? 'timeline';
    const config = getConfig();
    const maxTokens = (args.max_tokens as number | undefined) ?? config.mcpMaxResponseTokens;

    try {
      // Briefing mode: structured session summary
      if (mode === 'briefing') {
        let repoMapText: string | undefined;

        // Include repo map if enabled and we can determine project path
        if (config.repomap.enabled) {
          try {
            const result = await buildRepoMap(process.cwd(), {
              maxTokens: Math.min(config.repomap.maxTokens, Math.floor(maxTokens * 0.4)),
            });
            repoMapText = result.text;
            _cachedRepoMapGraph = result.graph;
          } catch {
            // Non-critical — briefing works without repo map
          }
        }

        const briefing = buildBriefing({
          project,
          repoMapText,
          maxTokens,
        });

        return briefing.text;
      }

      // Timeline mode (default)
      const result = reconstructSession({
        project,
        sessionId: args.session_id as string | undefined,
        from: args.from as string | undefined,
        to: args.to as string | undefined,
        daysBack: args.days_back as number | undefined,
        previousSession: args.previous_session as boolean | undefined,
        currentSessionId: args.current_session_id as string | undefined,
        maxTokens,
        keepNewest: (args.keep_newest as boolean | undefined) ?? true,
        agentFilter: agent,
      });

      return formatReconstruction(result);
    } catch (error) {
      return `Error: ${errorMessage(error)}`;
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
    return getMemoryStats();
  },
};

/**
 * Format a semantic dry-run preview showing top matches with scores and distribution.
 */
function formatSemanticDryRun(
  matches: { id: string; score: number }[],
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
  const chunkMap = buildChunkMap(topMatches);

  lines.push('');
  lines.push('Top matches:');
  for (let i = 0; i < topN; i++) {
    lines.push(formatChunkPreview(topMatches[i], chunkMap.get(topMatches[i].id), i));
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
function formatDeletedPreview(matches: { id: string; score: number }[], n: number): string {
  const topN = matches.slice(0, n);
  const chunkMap = buildChunkMap(topN);

  const lines: string[] = ['', 'Top deleted:'];
  for (let i = 0; i < topN.length; i++) {
    lines.push(formatChunkPreview(topN[i], chunkMap.get(topN[i].id), i));
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
      await deleteIndexEntriesForChunks(targetIds);
      invalidateProjectsCache();

      return `Deleted ${deleted} chunk(s) from project "${project}" (vectors, index entries, and related edges/clusters also removed).${preview}`;
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
    await deleteIndexEntriesForChunks(ids);
    invalidateProjectsCache();

    return `Deleted ${deleted} chunk(s) from project "${project}" (vectors, index entries, and related edges/clusters also removed).`;
  },
};

/**
 * Cache for repo map graphs to enable symbol lookup in search.
 */
// Reserved for future symbol lookup in search
let _cachedRepoMapGraph: DependencyGraph | null = null;

/**
 * Repo map tool: structural codebase summary.
 */
export const repomapTool: ToolDefinition = {
  name: 'repomap',
  description:
    'Get a compact structural summary of a project — files, definitions, and cross-file relationships. Shows what is defined where without reading individual files. Use at session start for orientation, or on-demand when you need to locate symbols.',
  inputSchema: {
    type: 'object',
    properties: {
      project: {
        type: 'string',
        description:
          'Absolute path to the project root directory. Defaults to the current working directory if omitted.',
      },
      focus_files: {
        type: 'string',
        description:
          'Comma-separated list of relative file paths to boost to the top of the output.',
      },
      max_tokens: {
        type: 'number',
        description: 'Maximum tokens in response. Default: 1024.',
      },
    },
    required: [],
  },
  handler: async (args) => {
    const config = getConfig();

    if (!config.repomap.enabled) {
      return 'Repo map is disabled in configuration.';
    }

    const projectPath = (args.project as string | undefined) ?? process.cwd();
    const maxTokens = (args.max_tokens as number | undefined) ?? config.repomap.maxTokens;
    const focusFilesRaw = args.focus_files as string | undefined;
    const focusFiles = focusFilesRaw ? focusFilesRaw.split(',').map((f) => f.trim()) : undefined;

    try {
      const result = await buildRepoMap(projectPath, {
        maxTokens,
        focusFiles,
      });

      // Cache the graph for symbol lookup in search
      _cachedRepoMapGraph = result.graph;

      const header = `Repo map: ${result.fileCount} files, ${result.definitionCount} definitions, ${result.edgeCount} cross-file references (${Math.round(result.durationMs)}ms, ${result.parsedCount} re-parsed)\n\n`;
      return header + result.text;
    } catch (error) {
      return `Error building repo map: ${errorMessage(error)}`;
    }
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
  repomapTool,
];

/**
 * Get tool by name.
 */
export function getTool(name: string): ToolDefinition | undefined {
  return tools.find((t) => t.name === name);
}
