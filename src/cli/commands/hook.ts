import { basename } from 'node:path';
import type { Command } from '../types.js';

/**
 * Claude Code hook stdin input shape.
 * Claude Code passes JSON via stdin with fields like transcript_path, session_id, cwd.
 * See: https://docs.anthropic.com/en/docs/claude-code/hooks
 */
export interface HookStdinInput {
  transcript_path?: string;
  session_id?: string;
  cwd?: string;
  [key: string]: unknown;
}

/**
 * Read JSON from stdin (piped by Claude Code hooks).
 * Returns {} on TTY (manual run), invalid JSON, timeout, or error.
 */
export async function readStdin(): Promise<HookStdinInput> {
  return new Promise((resolve) => {
    let data = '';
    const timeout = setTimeout(() => resolve({}), 1000);

    process.stdin.setEncoding('utf-8');

    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });

    process.stdin.on('end', () => {
      clearTimeout(timeout);
      try {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          resolve(parsed as HookStdinInput);
        } else {
          resolve({});
        }
      } catch {
        resolve({});
      }
    });

    process.stdin.on('error', () => {
      clearTimeout(timeout);
      resolve({});
    });

    if (process.stdin.isTTY) {
      clearTimeout(timeout);
      resolve({});
    } else {
      process.stdin.resume();
    }
  });
}

export const hookCommand: Command = {
  name: 'hook',
  description: 'Run a hook manually',
  usage: 'causantic hook <session-start|pre-compact|session-end|claudemd-generator> [path]',
  handler: async (args) => {
    const hookName = args[0];

    // Read stdin once — Claude Code pipes JSON with transcript_path, session_id, cwd
    const input = await readStdin();

    switch (hookName) {
      case 'session-start': {
        // session-start needs the project slug (basename of cwd)
        const projectSlug = basename(input.cwd ?? args[1] ?? process.cwd());

        const { handleSessionStart } = await import('../../hooks/session-start.js');
        const result = await handleSessionStart(projectSlug, {});

        // Output structured JSON for Claude Code hook system
        const output = {
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: `## Memory Context\n\n${result.summary}`,
          },
        };
        console.log(JSON.stringify(output));
        break;
      }
      case 'pre-compact': {
        // pre-compact needs the session JSONL file path
        const sessionPath = input.transcript_path ?? args[1];
        if (!sessionPath) {
          console.error('Error: No transcript_path in stdin and no path argument provided.');
          console.error('Usage: causantic hook pre-compact [path]');
          process.exit(2);
        }

        const project = basename(input.cwd ?? process.cwd());
        const { handlePreCompact } = await import('../../hooks/pre-compact.js');
        await handlePreCompact(sessionPath, { project, sessionId: input.session_id });
        console.log('Pre-compact hook executed.');
        break;
      }
      case 'session-end': {
        // session-end needs the session JSONL file path
        const sessionPath = input.transcript_path ?? args[1];
        if (!sessionPath) {
          console.error('Error: No transcript_path in stdin and no path argument provided.');
          console.error('Usage: causantic hook session-end [path]');
          process.exit(2);
        }

        const project = basename(input.cwd ?? process.cwd());
        const { handleSessionEnd } = await import('../../hooks/session-end.js');
        await handleSessionEnd(sessionPath, { project, sessionId: input.session_id });
        console.log('Session-end hook executed.');
        break;
      }
      case 'claudemd-generator': {
        const projectPath = input.cwd ?? args[1] ?? process.cwd();
        const { updateClaudeMd } = await import('../../hooks/claudemd-generator.js');
        await updateClaudeMd(projectPath, {});
        console.log('CLAUDE.md updated.');
        break;
      }
      default:
        console.error('Error: Unknown hook');
        console.log(
          'Usage: causantic hook <session-start|pre-compact|session-end|claudemd-generator> [path]',
        );
        process.exit(2);
    }
  },
};
