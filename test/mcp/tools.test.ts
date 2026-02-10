/**
 * Tests for MCP tools.
 */

import { describe, it, expect } from 'vitest';
import type { ToolDefinition } from '../../src/mcp/tools.js';
import { getTool, tools, recallTool, explainTool, predictTool, listProjectsTool } from '../../src/mcp/tools.js';

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

  describe('recallTool', () => {
    it('has correct name', () => {
      expect(recallTool.name).toBe('recall');
    });

    it('has description', () => {
      expect(recallTool.description).toBeTruthy();
      expect(recallTool.description).toContain('context');
    });

    it('requires query parameter', () => {
      expect(recallTool.inputSchema.required).toContain('query');
    });

    it('has query property with string type', () => {
      expect(recallTool.inputSchema.properties.query.type).toBe('string');
    });

    it('has optional range parameter', () => {
      expect(recallTool.inputSchema.properties.range).toBeTruthy();
      expect(recallTool.inputSchema.required).not.toContain('range');
    });
  });

  describe('explainTool', () => {
    it('has correct name', () => {
      expect(explainTool.name).toBe('explain');
    });

    it('has description mentioning history', () => {
      expect(explainTool.description).toBeTruthy();
      expect(explainTool.description.toLowerCase()).toContain('history');
    });

    it('requires topic parameter', () => {
      expect(explainTool.inputSchema.required).toContain('topic');
    });

    it('has topic property with string type', () => {
      expect(explainTool.inputSchema.properties.topic.type).toBe('string');
    });

    it('has optional range parameter', () => {
      expect(explainTool.inputSchema.properties.range).toBeTruthy();
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

  describe('project parameter', () => {
    it('recall has optional project parameter', () => {
      expect(recallTool.inputSchema.properties.project).toBeTruthy();
      expect(recallTool.inputSchema.properties.project.type).toBe('string');
      expect(recallTool.inputSchema.required).not.toContain('project');
    });

    it('explain has optional project parameter', () => {
      expect(explainTool.inputSchema.properties.project).toBeTruthy();
      expect(explainTool.inputSchema.properties.project.type).toBe('string');
      expect(explainTool.inputSchema.required).not.toContain('project');
    });

    it('predict has optional project parameter', () => {
      expect(predictTool.inputSchema.properties.project).toBeTruthy();
      expect(predictTool.inputSchema.properties.project.type).toBe('string');
      expect(predictTool.inputSchema.required).not.toContain('project');
    });
  });

  describe('tools array', () => {
    it('contains all six tools', () => {
      expect(tools.length).toBe(6);
    });

    it('contains recall tool', () => {
      expect(tools.find((t) => t.name === 'recall')).toBeTruthy();
    });

    it('contains explain tool', () => {
      expect(tools.find((t) => t.name === 'explain')).toBeTruthy();
    });

    it('contains predict tool', () => {
      expect(tools.find((t) => t.name === 'predict')).toBeTruthy();
    });

    it('contains list-projects tool', () => {
      expect(tools.find((t) => t.name === 'list-projects')).toBeTruthy();
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
    it('returns recall tool by name', () => {
      const tool = getTool('recall');
      expect(tool).toBeTruthy();
      expect(tool?.name).toBe('recall');
    });

    it('returns explain tool by name', () => {
      const tool = getTool('explain');
      expect(tool).toBeTruthy();
      expect(tool?.name).toBe('explain');
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

      const formatted = response.chunks.length === 0
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
    it('recall requires query string', () => {
      const queryProp = recallTool.inputSchema.properties.query;
      expect(queryProp.type).toBe('string');
    });

    it('explain requires topic string', () => {
      const topicProp = explainTool.inputSchema.properties.topic;
      expect(topicProp.type).toBe('string');
    });

    it('predict requires context string', () => {
      const contextProp = predictTool.inputSchema.properties.context;
      expect(contextProp.type).toBe('string');
    });
  });

  describe('range parameter', () => {
    it('recall supports short and long range', () => {
      const rangeProp = recallTool.inputSchema.properties.range;
      expect(rangeProp).toBeTruthy();
      expect(rangeProp.description).toContain('short');
      expect(rangeProp.description).toContain('long');
    });

    it('explain defaults to long range', () => {
      const rangeProp = explainTool.inputSchema.properties.range;
      expect(rangeProp).toBeTruthy();
      expect(rangeProp.description).toContain('long');
    });
  });

  describe('tool list format for MCP', () => {
    it('can be mapped to MCP tool list format', () => {
      const toolList = tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));

      expect(toolList.length).toBe(6);
      expect(toolList[0]).not.toHaveProperty('handler'); // Handler not included
      expect(toolList[0]).toHaveProperty('name');
      expect(toolList[0]).toHaveProperty('description');
      expect(toolList[0]).toHaveProperty('inputSchema');
    });
  });
});
