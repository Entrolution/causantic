/**
 * MCP tool definitions for memory operations.
 */

import { recall, explain, predict } from '../retrieval/context-assembler.js';
import { getConfig } from '../config/memory-config.js';
import { getDistinctProjects, getSessionsForProject } from '../storage/chunk-store.js';
import { reconstructSession, formatReconstruction } from '../retrieval/session-reconstructor.js';
import type { RetrievalResponse } from '../retrieval/context-assembler.js';

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
 */
function formatResponse(response: RetrievalResponse): string {
  if (response.chunks.length === 0) {
    return 'No relevant memory found.';
  }

  const header = `Found ${response.chunks.length} relevant memory chunks (${response.tokenCount} tokens):\n\n`;
  return header + response.text;
}

/**
 * Recall tool: retrieve relevant context from memory.
 */
export const recallTool: ToolDefinition = {
  name: 'recall',
  description:
    'Retrieve relevant context from memory based on a query. Use this to recall past conversations, decisions, or context that might be relevant to the current task.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What to look up in memory. Be specific about what context you need.',
      },
      range: {
        type: 'string',
        description: 'Time range hint: "short" for recent context (last few turns), "long" for historical/cross-session context. Default: "short".',
      },
      project: {
        type: 'string',
        description: 'Filter to a specific project. Omit to search all. Use list-projects to see available projects.',
      },
    },
    required: ['query'],
  },
  handler: async (args) => {
    const query = args.query as string;
    const range = (args.range as 'short' | 'long') || 'short';
    const project = args.project as string | undefined;
    const config = getConfig();

    const response = await recall(query, {
      maxTokens: config.mcpMaxResponseTokens,
      range,
      projectFilter: project,
    });

    return formatResponse(response);
  },
};

/**
 * Explain tool: get explanation of what led to current state.
 */
export const explainTool: ToolDefinition = {
  name: 'explain',
  description:
    'Get an explanation of the context and history behind a topic. Use this to understand how we got to the current state or why certain decisions were made. Uses long-range retrieval by default for historical context.',
  inputSchema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: 'What topic or aspect to explain. E.g., "the authentication system" or "why we chose React".',
      },
      range: {
        type: 'string',
        description: 'Time range: "short" for recent context, "long" for full history. Default: "long".',
      },
      project: {
        type: 'string',
        description: 'Filter to a specific project. Omit to search all. Use list-projects to see available projects.',
      },
    },
    required: ['topic'],
  },
  handler: async (args) => {
    const topic = args.topic as string;
    const range = (args.range as 'short' | 'long') || 'long'; // Default to long for explain
    const project = args.project as string | undefined;
    const config = getConfig();

    const response = await explain(topic, {
      maxTokens: config.mcpMaxResponseTokens,
      range,
      projectFilter: project,
    });

    return formatResponse(response);
  },
};

/**
 * Predict tool: predict what might be relevant next.
 */
export const predictTool: ToolDefinition = {
  name: 'predict',
  description:
    'Predict what context or topics might be relevant based on current discussion. Use this proactively to surface potentially useful past context.',
  inputSchema: {
    type: 'object',
    properties: {
      context: {
        type: 'string',
        description: 'Current context or topic being discussed.',
      },
      project: {
        type: 'string',
        description: 'Filter to a specific project. Omit to search all. Use list-projects to see available projects.',
      },
    },
    required: ['context'],
  },
  handler: async (args) => {
    const context = args.context as string;
    const project = args.project as string | undefined;
    const config = getConfig();

    const response = await predict(context, {
      maxTokens: Math.floor(config.mcpMaxResponseTokens / 2), // Smaller for predictions
      projectFilter: project,
    });

    if (response.chunks.length === 0) {
      return 'No predictions available based on current context.';
    }

    const header = `Potentially relevant context (${response.chunks.length} items):\n\n`;
    return header + response.text;
  },
};

/**
 * List projects tool: discover available projects for filtering.
 */
export const listProjectsTool: ToolDefinition = {
  name: 'list-projects',
  description:
    'List all projects in memory with chunk counts and date ranges. Use to discover available project names for filtering recall/explain/predict.',
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
      const first = new Date(p.firstSeen).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      const last = new Date(p.lastSeen).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
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
 * All available tools.
 */
export const tools: ToolDefinition[] = [
  recallTool,
  explainTool,
  predictTool,
  listProjectsTool,
  listSessionsTool,
  reconstructTool,
];

/**
 * Get tool by name.
 */
export function getTool(name: string): ToolDefinition | undefined {
  return tools.find((t) => t.name === name);
}
