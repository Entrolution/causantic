/**
 * MCP tool definitions for memory operations.
 */

import { recall, explain, predict } from '../retrieval/context-assembler.js';
import { getConfig } from '../config/memory-config.js';
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
    },
    required: ['query'],
  },
  handler: async (args) => {
    const query = args.query as string;
    const range = (args.range as 'short' | 'long') || 'short';
    const config = getConfig();

    const response = await recall(query, {
      maxTokens: config.mcpMaxResponseTokens,
      range,
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
    },
    required: ['topic'],
  },
  handler: async (args) => {
    const topic = args.topic as string;
    const range = (args.range as 'short' | 'long') || 'long'; // Default to long for explain
    const config = getConfig();

    const response = await explain(topic, {
      maxTokens: config.mcpMaxResponseTokens,
      range,
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
    },
    required: ['context'],
  },
  handler: async (args) => {
    const context = args.context as string;
    const config = getConfig();

    const response = await predict(context, {
      maxTokens: Math.floor(config.mcpMaxResponseTokens / 2), // Smaller for predictions
    });

    if (response.chunks.length === 0) {
      return 'No predictions available based on current context.';
    }

    const header = `Potentially relevant context (${response.chunks.length} items):\n\n`;
    return header + response.text;
  },
};

/**
 * All available tools.
 */
export const tools: ToolDefinition[] = [recallTool, explainTool, predictTool];

/**
 * Get tool by name.
 */
export function getTool(name: string): ToolDefinition | undefined {
  return tools.find((t) => t.name === name);
}
