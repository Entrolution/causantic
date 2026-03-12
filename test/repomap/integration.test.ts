/**
 * Integration test: build repo map of causantic itself.
 */

import { describe, it, expect } from 'vitest';
import { buildRepoMap, findSymbol, clearAllCaches } from '../../src/repomap/index.js';

const PROJECT_ROOT = process.cwd();

describe('buildRepoMap integration', () => {
  it('scans causantic and produces a map', async () => {
    const result = await buildRepoMap(PROJECT_ROOT, { maxTokens: 1024 });

    expect(result.fileCount).toBeGreaterThan(50);
    expect(result.definitionCount).toBeGreaterThan(100);
    expect(result.edgeCount).toBeGreaterThan(50);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('includes key definitions like IngestSession types', async () => {
    const result = await buildRepoMap(PROJECT_ROOT, { maxTokens: 4096 });

    // Should include important project types somewhere in the definitions
    const allDefs: string[] = [];
    for (const node of result.graph.nodes.values()) {
      for (const def of node.definitions) {
        allDefs.push(def.name);
      }
    }

    expect(allDefs).toContain('getDb');
    expect(allDefs).toContain('getConfig');
    expect(allDefs).toContain('MemoryConfig');
  });

  it('respects token budget', async () => {
    const result = await buildRepoMap(PROJECT_ROOT, { maxTokens: 256 });

    // Text output should be roughly within budget (approximation)
    // We allow some slack since approximateTokens is heuristic
    const chars = result.text.length;
    const approxTokens = Math.ceil(chars / 3.5);
    expect(approxTokens).toBeLessThan(300);
  });

  it('uses cache on second run', async () => {
    // Clear cache to ensure a fresh cold run
    clearAllCaches();

    // First run — everything parsed
    const r1 = await buildRepoMap(PROJECT_ROOT, { maxTokens: 512 });
    expect(r1.parsedCount).toBeGreaterThan(0);

    // Second run — all cached
    const r2 = await buildRepoMap(PROJECT_ROOT, { maxTokens: 512 });
    expect(r2.parsedCount).toBe(0);
    expect(r2.durationMs).toBeLessThan(r1.durationMs);
  });

  it('boosts focus files to top of output', async () => {
    const result = await buildRepoMap(PROJECT_ROOT, {
      maxTokens: 2048,
      focusFiles: ['src/repomap/parser.ts'],
    });

    // parser.ts should appear near the top
    const parserIdx = result.text.indexOf('src/repomap/parser.ts');
    expect(parserIdx).toBeGreaterThan(-1);
    expect(parserIdx).toBeLessThan(200); // Should be in first ~200 chars
  });

  it('findSymbol locates known definitions', async () => {
    const result = await buildRepoMap(PROJECT_ROOT, { maxTokens: 256 });

    const found = findSymbol(result.graph, 'getDb');
    expect(found).not.toBeNull();
    expect(found!.file).toBe('src/storage/db.ts');
    expect(found!.type).toBe('function');
    expect(found!.line).toBeGreaterThan(0);
  });

  it('findSymbol returns null for non-existent symbols', async () => {
    const result = await buildRepoMap(PROJECT_ROOT, { maxTokens: 256 });

    const found = findSymbol(result.graph, 'nonExistentSymbolXYZ123');
    expect(found).toBeNull();
  });
});
