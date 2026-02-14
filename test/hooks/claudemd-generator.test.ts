/**
 * Tests for CLAUDE.md memory section generator.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('../../src/hooks/session-start.js', () => ({
  generateMemorySection: vi.fn(),
}));

vi.mock('../../src/hooks/hook-utils.js', () => ({
  executeHook: vi.fn(async (_name: string, fn: () => Promise<unknown>, _opts?: unknown) => {
    const result = await fn();
    return { result, metrics: { durationMs: 10 } };
  }),
  logHook: vi.fn(),
  isTransientError: vi.fn(() => false),
}));

import {
  updateClaudeMd,
  removeMemorySection,
  hasMemorySection,
} from '../../src/hooks/claudemd-generator.js';
import { generateMemorySection } from '../../src/hooks/session-start.js';

const mockedGenerateMemorySection = vi.mocked(generateMemorySection);

describe('claudemd-generator', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'claudemd-test-'));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('updateClaudeMd', () => {
    it('returns not-updated when generateMemorySection returns null', async () => {
      mockedGenerateMemorySection.mockResolvedValue('');
      const claudeMdPath = join(tempDir, 'CLAUDE.md');

      const result = await updateClaudeMd(tempDir, { claudeMdPath });

      expect(result.updated).toBe(false);
      expect(result.created).toBe(false);
      expect(result.tokenCount).toBe(0);
    });

    it('creates file when createIfMissing is true', async () => {
      mockedGenerateMemorySection.mockResolvedValue('## Memory\nSome content');
      const claudeMdPath = join(tempDir, 'CLAUDE.md');

      const result = await updateClaudeMd(tempDir, {
        claudeMdPath,
        createIfMissing: true,
      });

      expect(result.updated).toBe(true);
      expect(result.created).toBe(true);
      expect(result.path).toBe(claudeMdPath);

      const content = await readFile(claudeMdPath, 'utf-8');
      expect(content).toContain('<!-- MEMORY_START -->');
      expect(content).toContain('## Memory\nSome content');
      expect(content).toContain('<!-- MEMORY_END -->');
    });

    it('does not create file when createIfMissing is false (default)', async () => {
      mockedGenerateMemorySection.mockResolvedValue('## Memory\nSome content');
      const claudeMdPath = join(tempDir, 'CLAUDE.md');

      const result = await updateClaudeMd(tempDir, { claudeMdPath });

      expect(result.updated).toBe(false);
      expect(result.created).toBe(false);
      expect(result.tokenCount).toBe(0);
    });

    it('replaces existing memory section between markers', async () => {
      const claudeMdPath = join(tempDir, 'CLAUDE.md');
      const existingContent = [
        '# My Project',
        '',
        '<!-- MEMORY_START -->',
        '## Old Memory',
        'Old content',
        '<!-- MEMORY_END -->',
        '',
        '## Other Section',
      ].join('\n');
      await writeFile(claudeMdPath, existingContent, 'utf-8');

      mockedGenerateMemorySection.mockResolvedValue('## New Memory\nNew content');

      const result = await updateClaudeMd(tempDir, { claudeMdPath });

      expect(result.updated).toBe(true);
      expect(result.created).toBe(false);

      const content = await readFile(claudeMdPath, 'utf-8');
      expect(content).toContain('# My Project');
      expect(content).toContain('<!-- MEMORY_START -->');
      expect(content).toContain('## New Memory\nNew content');
      expect(content).toContain('<!-- MEMORY_END -->');
      expect(content).toContain('## Other Section');
      expect(content).not.toContain('Old content');
    });

    it('appends memory section when no markers exist', async () => {
      const claudeMdPath = join(tempDir, 'CLAUDE.md');
      const existingContent = '# My Project\n\nSome existing content.';
      await writeFile(claudeMdPath, existingContent, 'utf-8');

      mockedGenerateMemorySection.mockResolvedValue('## Memory\nAppended content');

      const result = await updateClaudeMd(tempDir, { claudeMdPath });

      expect(result.updated).toBe(true);
      expect(result.created).toBe(false);

      const content = await readFile(claudeMdPath, 'utf-8');
      expect(content).toContain('# My Project');
      expect(content).toContain('Some existing content.');
      expect(content).toContain('<!-- MEMORY_START -->');
      expect(content).toContain('## Memory\nAppended content');
      expect(content).toContain('<!-- MEMORY_END -->');
    });

    it('does not write when content unchanged', async () => {
      const memoryText = '## Memory\nSame content';
      const claudeMdPath = join(tempDir, 'CLAUDE.md');
      const existingContent = `<!-- MEMORY_START -->\n${memoryText}\n<!-- MEMORY_END -->`;
      await writeFile(claudeMdPath, existingContent, 'utf-8');

      mockedGenerateMemorySection.mockResolvedValue(memoryText);

      const result = await updateClaudeMd(tempDir, { claudeMdPath });

      expect(result.updated).toBe(false);
      expect(result.created).toBe(false);
      // Token count is still estimated even when not updated
      expect(result.tokenCount).toBe(memoryText.length / 4);
    });

    it('estimates token count as memorySection.length / 4', async () => {
      const memoryText = 'A'.repeat(100); // 100 chars => 25 tokens
      const claudeMdPath = join(tempDir, 'CLAUDE.md');
      await writeFile(claudeMdPath, 'existing', 'utf-8');

      mockedGenerateMemorySection.mockResolvedValue(memoryText);

      const result = await updateClaudeMd(tempDir, { claudeMdPath });

      expect(result.tokenCount).toBe(25);
    });
  });

  describe('removeMemorySection', () => {
    it('removes markers and content from file', async () => {
      const claudeMdPath = join(tempDir, 'CLAUDE.md');
      const content = [
        '# Project',
        '',
        '<!-- MEMORY_START -->',
        '## Memory',
        'Content here',
        '<!-- MEMORY_END -->',
        '',
        '## Footer',
      ].join('\n');
      await writeFile(claudeMdPath, content, 'utf-8');

      const removed = await removeMemorySection(claudeMdPath);

      expect(removed).toBe(true);

      const updated = await readFile(claudeMdPath, 'utf-8');
      expect(updated).not.toContain('<!-- MEMORY_START -->');
      expect(updated).not.toContain('<!-- MEMORY_END -->');
      expect(updated).not.toContain('Content here');
      expect(updated).toContain('# Project');
      expect(updated).toContain('## Footer');
    });

    it('returns false for non-existent file', async () => {
      const claudeMdPath = join(tempDir, 'nonexistent.md');

      const removed = await removeMemorySection(claudeMdPath);

      expect(removed).toBe(false);
    });

    it('returns false when no markers exist in file', async () => {
      const claudeMdPath = join(tempDir, 'CLAUDE.md');
      await writeFile(claudeMdPath, '# No markers here\n', 'utf-8');

      const removed = await removeMemorySection(claudeMdPath);

      expect(removed).toBe(false);
    });
  });

  describe('hasMemorySection', () => {
    it('returns true when both markers exist', async () => {
      const claudeMdPath = join(tempDir, 'CLAUDE.md');
      const content = '# Title\n<!-- MEMORY_START -->\nstuff\n<!-- MEMORY_END -->\n';
      await writeFile(claudeMdPath, content, 'utf-8');

      const has = await hasMemorySection(claudeMdPath);

      expect(has).toBe(true);
    });

    it('returns false when no markers exist', async () => {
      const claudeMdPath = join(tempDir, 'CLAUDE.md');
      await writeFile(claudeMdPath, '# Title\nNo markers.\n', 'utf-8');

      const has = await hasMemorySection(claudeMdPath);

      expect(has).toBe(false);
    });

    it('returns false for non-existent file', async () => {
      const claudeMdPath = join(tempDir, 'missing.md');

      const has = await hasMemorySection(claudeMdPath);

      expect(has).toBe(false);
    });

    it('returns false when only start marker exists', async () => {
      const claudeMdPath = join(tempDir, 'CLAUDE.md');
      await writeFile(claudeMdPath, '<!-- MEMORY_START -->\nstuff\n', 'utf-8');

      const has = await hasMemorySection(claudeMdPath);

      expect(has).toBe(false);
    });

    it('returns false when only end marker exists', async () => {
      const claudeMdPath = join(tempDir, 'CLAUDE.md');
      await writeFile(claudeMdPath, 'stuff\n<!-- MEMORY_END -->\n', 'utf-8');

      const has = await hasMemorySection(claudeMdPath);

      expect(has).toBe(false);
    });
  });
});
