/**
 * MCP tool definitions for memory operations.
 */

import { recall, explain, predict } from '../retrieval/context-assembler.js';
import { getConfig } from '../config/memory-config.js';
import { getDistinctProjects } from '../storage/chunk-store.js';
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
 * All available tools.
 */
export const tools: ToolDefinition[] = [recallTool, explainTool, predictTool, listProjectsTool];

/**
 * Get tool by name.
 */
export function getTool(name: string): ToolDefinition | undefined {
  return tools.find((t) => t.name === name);
}
