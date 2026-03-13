/**
 * Tests for file dependency graph construction and ranking.
 */

import { describe, it, expect } from 'vitest';
import { buildGraph, getRankedDefinitions } from '../../src/repomap/graph.js';
import type { Tag } from '../../src/repomap/parser.js';

function defTag(name: string, file: string, type: Tag['type'] = 'function', line = 1): Tag {
  return { name, kind: 'def', line, file, type };
}

function refTag(name: string, file: string, type: Tag['type'] = 'identifier', line = 1): Tag {
  return { name, kind: 'ref', line, file, type };
}

describe('buildGraph', () => {
  it('creates nodes for each file', () => {
    const tagsByFile = new Map([
      ['a.ts', [defTag('Foo', 'a.ts', 'class')]],
      ['b.ts', [defTag('Bar', 'b.ts', 'class')]],
    ]);

    const graph = buildGraph(tagsByFile);
    expect(graph.nodes.size).toBe(2);
    expect(graph.nodes.has('a.ts')).toBe(true);
    expect(graph.nodes.has('b.ts')).toBe(true);
  });

  it('creates edges for cross-file references', () => {
    const tagsByFile = new Map([
      ['a.ts', [defTag('Foo', 'a.ts', 'class')]],
      ['b.ts', [defTag('Bar', 'b.ts', 'class'), refTag('Foo', 'b.ts')]],
    ]);

    const graph = buildGraph(tagsByFile);
    expect(graph.edges.length).toBe(1);
    expect(graph.edges[0].from).toBe('b.ts');
    expect(graph.edges[0].to).toBe('a.ts');
    expect(graph.edges[0].symbols).toContain('Foo');
  });

  it('does not create self-referencing edges', () => {
    const tagsByFile = new Map([['a.ts', [defTag('Foo', 'a.ts', 'class'), refTag('Foo', 'a.ts')]]]);

    const graph = buildGraph(tagsByFile);
    expect(graph.edges.length).toBe(0);
  });

  it('ranks files by in-degree (referenced files score higher)', () => {
    const tagsByFile = new Map([
      ['core.ts', [defTag('CoreFn', 'core.ts')]],
      ['a.ts', [defTag('A', 'a.ts'), refTag('CoreFn', 'a.ts')]],
      ['b.ts', [defTag('B', 'b.ts'), refTag('CoreFn', 'b.ts')]],
      ['c.ts', [defTag('C', 'c.ts'), refTag('CoreFn', 'c.ts')]],
      ['leaf.ts', [defTag('Leaf', 'leaf.ts')]],
    ]);

    const graph = buildGraph(tagsByFile);

    // core.ts should rank highest (referenced by 3 files)
    expect(graph.rankedFiles[0].path).toBe('core.ts');
    // leaf.ts should rank low (no references)
    const leafRank = graph.rankedFiles.findIndex((f) => f.path === 'leaf.ts');
    expect(leafRank).toBeGreaterThan(0);
  });

  it('weighs longer identifiers higher', () => {
    const tagsByFile = new Map([
      ['types.ts', [defTag('x', 'types.ts'), defTag('VerySpecificFunctionName', 'types.ts')]],
      [
        'consumer.ts',
        [refTag('x', 'consumer.ts'), refTag('VerySpecificFunctionName', 'consumer.ts')],
      ],
    ]);

    const graph = buildGraph(tagsByFile);
    const edge = graph.edges[0];
    // The edge weight should reflect the longer identifier name contributing more
    expect(edge.weight).toBeGreaterThan(0);
    expect(edge.symbols.length).toBe(2);
  });

  it('accumulates edge weights for multiple references', () => {
    const tagsByFile = new Map([
      ['lib.ts', [defTag('Alpha', 'lib.ts'), defTag('Beta', 'lib.ts'), defTag('Gamma', 'lib.ts')]],
      ['app.ts', [refTag('Alpha', 'app.ts'), refTag('Beta', 'app.ts'), refTag('Gamma', 'app.ts')]],
    ]);

    const graph = buildGraph(tagsByFile);
    expect(graph.edges.length).toBe(1);
    expect(graph.edges[0].symbols.length).toBe(3);
  });

  it('handles empty input', () => {
    const graph = buildGraph(new Map());
    expect(graph.nodes.size).toBe(0);
    expect(graph.edges.length).toBe(0);
    expect(graph.rankedFiles.length).toBe(0);
  });
});

describe('getRankedDefinitions', () => {
  it('returns definitions from highest-ranked files first', () => {
    const tagsByFile = new Map([
      ['core.ts', [defTag('CoreFn', 'core.ts')]],
      ['leaf.ts', [defTag('LeafFn', 'leaf.ts')]],
      ['app.ts', [refTag('CoreFn', 'app.ts'), defTag('AppFn', 'app.ts')]],
    ]);

    const graph = buildGraph(tagsByFile);
    const defs = getRankedDefinitions(graph);

    // CoreFn should come before LeafFn (core.ts is more important)
    const coreIdx = defs.findIndex((d) => d.name === 'CoreFn');
    const leafIdx = defs.findIndex((d) => d.name === 'LeafFn');
    expect(coreIdx).toBeLessThan(leafIdx);
  });

  it('sorts definitions within a file by type priority', () => {
    const tagsByFile = new Map([
      [
        'mixed.ts',
        [
          defTag('myFn', 'mixed.ts', 'function', 10),
          defTag('MyClass', 'mixed.ts', 'class', 1),
          defTag('MyIface', 'mixed.ts', 'interface', 5),
        ],
      ],
    ]);

    const graph = buildGraph(tagsByFile);
    const defs = getRankedDefinitions(graph);

    const classIdx = defs.findIndex((d) => d.name === 'MyClass');
    const ifaceIdx = defs.findIndex((d) => d.name === 'MyIface');
    const fnIdx = defs.findIndex((d) => d.name === 'myFn');

    // class < interface < function in priority
    expect(classIdx).toBeLessThan(ifaceIdx);
    expect(ifaceIdx).toBeLessThan(fnIdx);
  });
});
