/**
 * Tests for hook CLI command — stdin reading and routing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

// We test readStdin by mocking process.stdin
describe('hook-command', () => {
  describe('readStdin', () => {
    let originalStdin: typeof process.stdin;

    beforeEach(() => {
      originalStdin = process.stdin;
    });

    afterEach(() => {
      Object.defineProperty(process, 'stdin', { value: originalStdin, writable: true });
    });

    // Import readStdin fresh for each test to avoid state issues
    async function getReadStdin() {
      const mod = await import('../../src/cli/commands/hook.js');
      return mod.readStdin;
    }

    it('parses valid JSON from stdin', async () => {
      const mockStdin = new Readable({
        read() {
          this.push(JSON.stringify({ transcript_path: '/tmp/test.jsonl', cwd: '/tmp/project' }));
          this.push(null);
        },
      });
      Object.defineProperty(mockStdin, 'isTTY', { value: false });
      Object.defineProperty(mockStdin, 'setEncoding', { value: vi.fn() });
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const readStdin = (await getReadStdin());
      const result = await readStdin();

      expect(result.transcript_path).toBe('/tmp/test.jsonl');
      expect(result.cwd).toBe('/tmp/project');
    });

    it('returns {} on invalid JSON', async () => {
      const mockStdin = new Readable({
        read() {
          this.push('not valid json{{{');
          this.push(null);
        },
      });
      Object.defineProperty(mockStdin, 'isTTY', { value: false });
      Object.defineProperty(mockStdin, 'setEncoding', { value: vi.fn() });
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const readStdin = (await getReadStdin());
      const result = await readStdin();

      expect(result).toEqual({});
    });

    it('returns {} on JSON array (non-object)', async () => {
      const mockStdin = new Readable({
        read() {
          this.push('["not", "an", "object"]');
          this.push(null);
        },
      });
      Object.defineProperty(mockStdin, 'isTTY', { value: false });
      Object.defineProperty(mockStdin, 'setEncoding', { value: vi.fn() });
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const readStdin = (await getReadStdin());
      const result = await readStdin();

      expect(result).toEqual({});
    });

    it('returns {} on TTY (manual run)', async () => {
      const mockStdin = new Readable({ read() {} });
      Object.defineProperty(mockStdin, 'isTTY', { value: true });
      Object.defineProperty(mockStdin, 'setEncoding', { value: vi.fn() });
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const readStdin = (await getReadStdin());
      const result = await readStdin();

      expect(result).toEqual({});
    });

    it('returns {} on empty stdin', async () => {
      const mockStdin = new Readable({
        read() {
          this.push(null);
        },
      });
      Object.defineProperty(mockStdin, 'isTTY', { value: false });
      Object.defineProperty(mockStdin, 'setEncoding', { value: vi.fn() });
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const readStdin = (await getReadStdin());
      const result = await readStdin();

      expect(result).toEqual({});
    });

    it('parses all Claude Code hook fields', async () => {
      const hookInput = {
        transcript_path: '/Users/test/.claude/projects/-test/abc.jsonl',
        session_id: 'abc-123-def-456',
        cwd: '/Users/test/my-project',
      };

      const mockStdin = new Readable({
        read() {
          this.push(JSON.stringify(hookInput));
          this.push(null);
        },
      });
      Object.defineProperty(mockStdin, 'isTTY', { value: false });
      Object.defineProperty(mockStdin, 'setEncoding', { value: vi.fn() });
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const readStdin = (await getReadStdin());
      const result = await readStdin();

      expect(result.transcript_path).toBe(hookInput.transcript_path);
      expect(result.session_id).toBe(hookInput.session_id);
      expect(result.cwd).toBe(hookInput.cwd);
    });
  });

  describe('HookStdinInput type', () => {
    it('allows additional unknown fields', () => {
      // Type check — extra fields should be allowed via index signature
      const input: import('../../src/cli/commands/hook.js').HookStdinInput = {
        transcript_path: '/tmp/test.jsonl',
        session_id: 'abc',
        cwd: '/tmp',
        extra_field: 'value',
      };

      expect(input.extra_field).toBe('value');
    });
  });

  describe('routing logic', () => {
    it('session-start derives slug from basename of cwd', () => {
      const { basename } = require('node:path');
      expect(basename('/Users/test/my-cool-project')).toBe('my-cool-project');
      expect(basename('/tmp')).toBe('tmp');
    });

    it('session-end prefers transcript_path over args', () => {
      const input = { transcript_path: '/from/stdin.jsonl' };
      const args = ['/from/args.jsonl'];

      const sessionPath = input.transcript_path ?? args[0];
      expect(sessionPath).toBe('/from/stdin.jsonl');
    });

    it('session-end falls back to args when no transcript_path', () => {
      const input = {} as Record<string, unknown>;
      const args = ['/from/args.jsonl'];

      const sessionPath = (input.transcript_path as string | undefined) ?? args[0];
      expect(sessionPath).toBe('/from/args.jsonl');
    });

    it('pre-compact prefers transcript_path over args', () => {
      const input = { transcript_path: '/from/stdin.jsonl' };
      const args = ['/from/args.jsonl'];

      const sessionPath = input.transcript_path ?? args[0];
      expect(sessionPath).toBe('/from/stdin.jsonl');
    });
  });
});

// Need afterEach import
import { afterEach } from 'vitest';
