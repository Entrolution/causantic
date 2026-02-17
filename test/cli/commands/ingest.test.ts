/**
 * Tests for the ingest and batch-ingest CLI command handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the commands
vi.mock('../../../src/ingest/ingest-session.js', () => ({
  ingestSession: vi.fn(),
}));

vi.mock('../../../src/ingest/batch-ingest.js', () => ({
  batchIngestDirectory: vi.fn(),
}));

import { ingestCommand, batchIngestCommand } from '../../../src/cli/commands/ingest.js';
import { ingestSession } from '../../../src/ingest/ingest-session.js';
import { batchIngestDirectory } from '../../../src/ingest/batch-ingest.js';

const mockIngestSession = vi.mocked(ingestSession);
const mockBatchIngestDirectory = vi.mocked(batchIngestDirectory);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});

describe('ingestCommand', () => {
  it('has correct name and usage', () => {
    expect(ingestCommand.name).toBe('ingest');
    expect(ingestCommand.usage).toContain('path');
  });

  it('calls ingestSession with the provided path', async () => {
    mockIngestSession.mockResolvedValue(undefined as never);

    await ingestCommand.handler(['/tmp/session.jsonl']);

    expect(mockIngestSession).toHaveBeenCalledWith('/tmp/session.jsonl');
    expect(console.log).toHaveBeenCalledWith('Ingestion complete.');
  });

  it('exits with code 2 when no path provided', async () => {
    await ingestCommand.handler([]);

    expect(console.error).toHaveBeenCalledWith('Error: Path required');
    expect(process.exit).toHaveBeenCalledWith(2);
  });
});

describe('batchIngestCommand', () => {
  it('has correct name and usage', () => {
    expect(batchIngestCommand.name).toBe('batch-ingest');
    expect(batchIngestCommand.usage).toContain('directory');
  });

  it('calls batchIngestDirectory with the provided directory', async () => {
    mockBatchIngestDirectory.mockResolvedValue({
      successCount: 5,
      failureCount: 0,
      skippedCount: 0,
      sessions: [],
    } as never);

    await batchIngestCommand.handler(['/tmp/sessions']);

    expect(mockBatchIngestDirectory).toHaveBeenCalledWith('/tmp/sessions', {});
    expect(console.log).toHaveBeenCalledWith('Batch ingestion complete: 5 sessions processed.');
  });

  it('exits with code 2 when no directory provided', async () => {
    await batchIngestCommand.handler([]);

    expect(console.error).toHaveBeenCalledWith('Error: Directory required');
    expect(process.exit).toHaveBeenCalledWith(2);
  });
});
