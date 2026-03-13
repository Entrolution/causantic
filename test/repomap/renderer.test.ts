/**
 * Tests for repo map renderer.
 */

import { describe, it, expect } from 'vitest';
import { renderMap, renderMinimalSummary } from '../../src/repomap/renderer.js';
import { buildGraph } from '../../src/repomap/graph.js';
import type { Tag } from '../../src/repomap/parser.js';
import { approximateTokens } from '../../src/utils/token-counter.js';

function defTag(name: string, file: string, type: Tag['type'] = 'function', line = 1): Tag {
  return { name, kind: 'def', line, file, type };
}

function refTag(name: string, file: string): Tag {
  return { name, kind: 'ref', line: 1, file, type: 'identifier' };
}

function buildTestGraph() {
  const tagsByFile = new Map([
    [
      'src/core.ts',
      [
        defTag('CoreClass', 'src/core.ts', 'class', 5),
        defTag('coreHelper', 'src/core.ts', 'function', 20),
        defTag('CoreType', 'src/core.ts', 'type', 35),
      ],
    ],
    [
      'src/app.ts',
      [
        defTag('AppService', 'src/app.ts', 'class', 10),
        refTag('CoreClass', 'src/app.ts'),
        refTag('coreHelper', 'src/app.ts'),
      ],
    ],
    [
      'src/utils.ts',
      [defTag('utilFn', 'src/utils.ts', 'function', 1), refTag('CoreType', 'src/utils.ts')],
    ],
  ]);

  return buildGraph(tagsByFile);
}

describe('renderMap', () => {
  it('produces non-empty output', () => {
    const graph = buildTestGraph();
    const output = renderMap(graph);
    expect(output.length).toBeGreaterThan(0);
  });

  it('includes file paths', () => {
    const graph = buildTestGraph();
    const output = renderMap(graph);
    expect(output).toContain('src/core.ts');
  });

  it('includes definition names', () => {
    const graph = buildTestGraph();
    const output = renderMap(graph);
    expect(output).toContain('CoreClass');
  });

  it('includes definition types', () => {
    const graph = buildTestGraph();
    const output = renderMap(graph);
    expect(output).toContain('class CoreClass');
  });

  it('includes line numbers by default', () => {
    const graph = buildTestGraph();
    const output = renderMap(graph);
    expect(output).toMatch(/\(\d+\)/);
  });

  it('omits line numbers when disabled', () => {
    const graph = buildTestGraph();
    const output = renderMap(graph, { showLineNumbers: false });
    expect(output).not.toMatch(/\(\d+\)/);
  });

  it('respects token budget', () => {
    const graph = buildTestGraph();
    const output = renderMap(graph, { maxTokens: 50 });
    const tokens = approximateTokens(output);
    expect(tokens).toBeLessThanOrEqual(55); // Small tolerance for approximation
  });

  it('shows highest-ranked file first', () => {
    const graph = buildTestGraph();
    const output = renderMap(graph, { maxTokens: 2000 });
    // core.ts should be first (most referenced)
    const coreIdx = output.indexOf('src/core.ts');
    const appIdx = output.indexOf('src/app.ts');
    expect(coreIdx).toBeLessThan(appIdx);
  });

  it('boosts focus files to top', () => {
    const graph = buildTestGraph();
    const output = renderMap(graph, {
      maxTokens: 2000,
      focusFiles: ['src/utils.ts'],
    });
    // utils.ts should appear before core.ts when focused
    const utilsIdx = output.indexOf('src/utils.ts');
    const coreIdx = output.indexOf('src/core.ts');
    expect(utilsIdx).toBeLessThan(coreIdx);
  });

  it('handles empty graph', () => {
    const graph = buildGraph(new Map());
    const output = renderMap(graph);
    expect(output).toBe('(no definitions found)');
  });

  it('handles files with no definitions', () => {
    const tagsByFile = new Map([['empty.ts', [refTag('SomeRef', 'empty.ts')]]]);
    const graph = buildGraph(tagsByFile);
    const output = renderMap(graph);
    expect(output).toBe('(no definitions found)');
  });
});

describe('renderMinimalSummary', () => {
  it('produces compact file list', () => {
    const graph = buildTestGraph();
    const output = renderMinimalSummary(graph);
    expect(output).toContain('src/core.ts');
    expect(output).toContain('defs');
  });

  it('respects maxFiles parameter', () => {
    const graph = buildTestGraph();
    const output = renderMinimalSummary(graph, 1);
    const lines = output.split('\n').filter(Boolean);
    expect(lines.length).toBe(1);
  });
});
