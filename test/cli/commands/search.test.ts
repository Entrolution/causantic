/**
 * Tests for the recall CLI command handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/retrieval/context-assembler.js', () => ({
  recall: vi.fn(),
}));

import { recallCommand } from '../../../src/cli/commands/search.js';
import { recall } from '../../../src/retrieval/context-assembler.js';

const mockRecall = vi.mocked(recall);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});

describe('recallCommand', () => {
  it('has correct name and description', () => {
    expect(recallCommand.name).toBe('recall');
    expect(recallCommand.description).toContain('memory');
  });

  it('exits with code 2 when no query provided', async () => {
    await recallCommand.handler([]);

    expect(console.error).toHaveBeenCalledWith('Error: Query required');
    expect(process.exit).toHaveBeenCalledWith(2);
  });

  it('calls recall with joined args and prints JSON results', async () => {
    const mockResults = { chunks: [{ id: '1', content: 'test' }] };
    mockRecall.mockResolvedValue(mockResults as ReturnType<typeof recall> extends Promise<infer T> ? T : never);

    await recallCommand.handler(['how', 'did', 'we', 'solve', 'this']);

    expect(mockRecall).toHaveBeenCalledWith('how did we solve this', { vectorSearchLimit: 10 });
    expect(console.log).toHaveBeenCalledWith(JSON.stringify(mockResults, null, 2));
  });

  it('calls recall with single-word query', async () => {
    mockRecall.mockResolvedValue({} as any);

    await recallCommand.handler(['authentication']);

    expect(mockRecall).toHaveBeenCalledWith('authentication', { vectorSearchLimit: 10 });
  });
});
