/**
 * Tests for MCP tools.
 */

import { describe, it, expect } from 'vitest';
import type { ToolDefinition } from '../../src/mcp/tools.js';
import {
  getTool,
  tools,
  searchTool,
  recallTool,
  predictTool,
  listProjectsTool,
  statsTool,
} from '../../src/mcp/tools.js';

describe('mcp-tools', () => {
  describe('ToolDefinition interface', () => {
    it('has correct structure', () => {
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'A test tool',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The query' },
          },
          required: ['query'],
        },
        handler: async (args) => {
          return `Result: ${args.query}`;
        },
      };

      expect(tool.name).toBe('test-tool');
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties.query.type).toBe('string');
      expect(tool.inputSchema.required).toContain('query');
    });
  });

  describe('searchTool', () => {
    it('has correct name', () => {
      expect(searchTool.name).toBe('search');
    });

    it('has description', () => {
      expect(searchTool.description).toBeTruthy();
      expect(searchTool.description.toLowerCase()).toContain('search');
    });

    it('requires query parameter', () => {
      expect(searchTool.inputSchema.required).toContain('query');
    });

    it('has query property with string type', () => {
      expect(searchTool.inputSchema.properties.query.type).toBe('string');
    });
  });

  describe('recallTool', () => {
    it('has correct name', () => {
      expect(recallTool.name).toBe('recall');
    });

    it('has description mentioning episodic or narrative', () => {
      expect(recallTool.description).toBeTruthy();
      expect(recallTool.description.toLowerCase()).toContain('narrative');
    });

    it('requires query parameter', () => {
      expect(recallTool.inputSchema.required).toContain('query');
    });

    it('has query property with string type', () => {
      expect(recallTool.inputSchema.properties.query.type).toBe('string');
    });
  });

  describe('predictTool', () => {
    it('has correct name', () => {
      expect(predictTool.name).toBe('predict');
    });

    it('has description mentioning prediction', () => {
      expect(predictTool.description).toBeTruthy();
      expect(predictTool.description.toLowerCase()).toContain('predict');
    });

    it('requires context parameter', () => {
      expect(predictTool.inputSchema.required).toContain('context');
    });

    it('has context property with string type', () => {
      expect(predictTool.inputSchema.properties.context.type).toBe('string');
    });
  });

  describe('listProjectsTool', () => {
    it('has correct name', () => {
      expect(listProjectsTool.name).toBe('list-projects');
    });

    it('has description', () => {
      expect(listProjectsTool.description).toBeTruthy();
      expect(listProjectsTool.description).toContain('projects');
    });

    it('requires no parameters', () => {
      expect(listProjectsTool.inputSchema.required).toEqual([]);
    });
  });

  describe('statsTool', () => {
    it('has correct name', () => {
      expect(statsTool.name).toBe('stats');
    });

    it('has description mentioning statistics', () => {
      expect(statsTool.description).toBeTruthy();
      expect(statsTool.description.toLowerCase()).toContain('statistic');
    });

    it('requires no parameters', () => {
      expect(statsTool.inputSchema.required).toEqual([]);
    });

    it('has no required properties', () => {
      expect(Object.keys(statsTool.inputSchema.properties)).toEqual([]);
    });
  });

  describe('project parameter', () => {
    it('search has optional project parameter', () => {
      expect(searchTool.inputSchema.properties.project).toBeTruthy();
      expect(searchTool.inputSchema.properties.project.type).toBe('string');
      expect(searchTool.inputSchema.required).not.toContain('project');
    });

    it('recall has optional project parameter', () => {
      expect(recallTool.inputSchema.properties.project).toBeTruthy();
      expect(recallTool.inputSchema.properties.project.type).toBe('string');
      expect(recallTool.inputSchema.required).not.toContain('project');
    });

    it('predict has optional project parameter', () => {
      expect(predictTool.inputSchema.properties.project).toBeTruthy();
      expect(predictTool.inputSchema.properties.project.type).toBe('string');
      expect(predictTool.inputSchema.required).not.toContain('project');
    });
  });

  describe('tools array', () => {
    it('contains all seven tools', () => {
      expect(tools.length).toBe(8);
    });

    it('contains search tool', () => {
      expect(tools.find((t) => t.name === 'search')).toBeTruthy();
    });

    it('contains recall tool', () => {
      expect(tools.find((t) => t.name === 'recall')).toBeTruthy();
    });

    it('does NOT contain explain tool', () => {
      expect(tools.find((t) => t.name === 'explain')).toBeFalsy();
    });

    it('contains predict tool', () => {
      expect(tools.find((t) => t.name === 'predict')).toBeTruthy();
    });

    it('contains list-projects tool', () => {
      expect(tools.find((t) => t.name === 'list-projects')).toBeTruthy();
    });

    it('contains hook-status tool', () => {
      expect(tools.find((t) => t.name === 'hook-status')).toBeTruthy();
    });

    it('all tools have required fields', () => {
      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeTruthy();
        expect(tool.handler).toBeTruthy();
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('all tools have object input schema', () => {
      for (const tool of tools) {
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.properties).toBeTruthy();
        expect(Array.isArray(tool.inputSchema.required)).toBe(true);
      }
    });
  });

  describe('getTool', () => {
    it('returns search tool by name', () => {
      const tool = getTool('search');
      expect(tool).toBeTruthy();
      expect(tool?.name).toBe('search');
    });

    it('returns recall tool by name', () => {
      const tool = getTool('recall');
      expect(tool).toBeTruthy();
      expect(tool?.name).toBe('recall');
    });

    it('returns undefined for explain (removed)', () => {
      const tool = getTool('explain');
      expect(tool).toBeUndefined();
    });

    it('returns predict tool by name', () => {
      const tool = getTool('predict');
      expect(tool).toBeTruthy();
      expect(tool?.name).toBe('predict');
    });

    it('returns list-projects tool by name', () => {
      const tool = getTool('list-projects');
      expect(tool).toBeTruthy();
      expect(tool?.name).toBe('list-projects');
    });

    it('returns undefined for unknown tool', () => {
      const tool = getTool('unknown-tool');
      expect(tool).toBeUndefined();
    });

    it('is case sensitive', () => {
      const tool = getTool('RECALL');
      expect(tool).toBeUndefined();
    });
  });

  describe('response formatting', () => {
    it('formats empty results', () => {
      const response = {
        chunks: [],
        text: '',
        tokenCount: 0,
      };

      const formatted =
        response.chunks.length === 0
          ? 'No relevant memory found.'
          : `Found ${response.chunks.length} relevant memory chunks.`;

      expect(formatted).toBe('No relevant memory found.');
    });

    it('formats non-empty results', () => {
      const response = {
        chunks: [{ id: '1' }, { id: '2' }, { id: '3' }],
        text: 'Chunk content...',
        tokenCount: 150,
      };

      const header = `Found ${response.chunks.length} relevant memory chunks (${response.tokenCount} tokens):\n\n`;
      const formatted = header + response.text;

      expect(formatted).toContain('Found 3 relevant memory chunks');
      expect(formatted).toContain('150 tokens');
    });
  });

  describe('tool parameter validation', () => {
    it('search requires query string', () => {
      const queryProp = searchTool.inputSchema.properties.query;
      expect(queryProp.type).toBe('string');
    });

    it('recall requires query string', () => {
      const queryProp = recallTool.inputSchema.properties.query;
      expect(queryProp.type).toBe('string');
    });

    it('predict requires context string', () => {
      const contextProp = predictTool.inputSchema.properties.context;
      expect(contextProp.type).toBe('string');
    });
  });

  describe('tool list format for MCP', () => {
    it('can be mapped to MCP tool list format', () => {
      const toolList = tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));

      expect(toolList.length).toBe(8);
      expect(toolList[0]).not.toHaveProperty('handler'); // Handler not included
      expect(toolList[0]).toHaveProperty('name');
      expect(toolList[0]).toHaveProperty('description');
      expect(toolList[0]).toHaveProperty('inputSchema');
    });
  });
});
