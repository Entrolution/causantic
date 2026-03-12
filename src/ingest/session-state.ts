/**
 * Session state extraction from transcripts.
 *
 * Deterministically extracts structured state from tool_use blocks:
 * - Files touched: paths from Read/Write/Edit/Glob tool calls
 * - Errors: tool_result blocks with is_error: true
 * - Outcomes: git commit/push/gh pr create from Bash tool calls
 * - Tasks: TaskCreate/TaskUpdate tool calls
 */

import type { Turn, ToolExchange } from '../parser/types.js';

/** An error encountered during a session. */
export interface SessionError {
  /** The tool that produced the error. */
  tool: string;
  /** The error message (truncated). */
  message: string;
  /** Brief resolution attempt from next assistant message, if any. */
  resolution?: string;
}

/** A task created or updated during a session. */
export interface SessionTask {
  /** Task description/subject. */
  description: string;
  /** Last known status. */
  status: string;
}

/** Extracted session state from a transcript. */
export interface SessionState {
  /** Files that were read, written, or edited. Deduplicated. */
  filesTouched: string[];
  /** Errors encountered during the session. */
  errors: SessionError[];
  /** Key outcomes (commits, pushes, PRs created). */
  outcomes: string[];
  /** Tasks created or updated. */
  tasks: SessionTask[];
}

/** Max length for error messages to avoid bloating storage. */
const MAX_ERROR_MESSAGE_LENGTH = 200;

/** Max length for resolution text. */
const MAX_RESOLUTION_LENGTH = 150;

/** Tools that touch files. */
const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'Glob', 'NotebookEdit']);

/** Patterns that indicate key git outcomes in Bash commands. */
const OUTCOME_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /git\s+commit\b/, label: 'git commit' },
  { pattern: /git\s+push\b/, label: 'git push' },
  { pattern: /gh\s+pr\s+create\b/, label: 'gh pr create' },
  { pattern: /gh\s+pr\s+merge\b/, label: 'gh pr merge' },
  { pattern: /npm\s+publish\b/, label: 'npm publish' },
];

/**
 * Extract file paths from a tool exchange's input.
 */
function extractFilePaths(exchange: ToolExchange): string[] {
  const paths: string[] = [];
  const input = exchange.input;

  // Read, Write, Edit, NotebookEdit — file_path parameter
  if (typeof input.file_path === 'string' && input.file_path) {
    paths.push(input.file_path);
  }

  // Glob — pattern + path (directory)
  if (typeof input.pattern === 'string' && typeof input.path === 'string' && input.path) {
    paths.push(input.path);
  }

  return paths;
}

/**
 * Extract outcome labels from a Bash command string.
 */
function extractOutcomes(command: string): string[] {
  const outcomes: string[] = [];
  for (const { pattern, label } of OUTCOME_PATTERNS) {
    if (pattern.test(command)) {
      outcomes.push(label);
    }
  }
  return outcomes;
}

/**
 * Extract a brief resolution from assistant text blocks following an error.
 */
function extractResolution(turn: Turn, exchangeIndex: number): string | undefined {
  // Look at text blocks in the same turn after this tool exchange
  // The assistant's response after an error typically addresses it
  const textBlocks = turn.assistantBlocks.filter((b) => b.type === 'text');
  if (textBlocks.length === 0) return undefined;

  // Use the last text block as the resolution attempt
  const lastText = textBlocks[textBlocks.length - 1];
  if (lastText.type !== 'text') return undefined;

  const text = lastText.text.trim();
  if (!text) return undefined;

  return text.length > MAX_RESOLUTION_LENGTH
    ? text.slice(0, MAX_RESOLUTION_LENGTH) + '...'
    : text;
}

/**
 * Extract structured session state from parsed turns.
 *
 * This is a deterministic extraction — no LLM calls needed.
 * Walks through all turns and their tool exchanges to collect:
 * - File paths from Read/Write/Edit/Glob calls
 * - Errors from failed tool results
 * - Git/publish outcomes from Bash commands
 * - Tasks from TaskCreate/TaskUpdate calls
 */
export function extractSessionState(turns: Turn[]): SessionState {
  const fileSet = new Set<string>();
  const errors: SessionError[] = [];
  const outcomeSet = new Set<string>();
  const taskMap = new Map<string, SessionTask>();

  for (const turn of turns) {
    for (let i = 0; i < turn.toolExchanges.length; i++) {
      const exchange = turn.toolExchanges[i];

      // 1. File paths
      if (FILE_TOOLS.has(exchange.toolName)) {
        for (const path of extractFilePaths(exchange)) {
          fileSet.add(path);
        }
      }

      // 2. Errors
      if (exchange.isError && exchange.result) {
        const message = exchange.result.length > MAX_ERROR_MESSAGE_LENGTH
          ? exchange.result.slice(0, MAX_ERROR_MESSAGE_LENGTH) + '...'
          : exchange.result;

        errors.push({
          tool: exchange.toolName,
          message,
          resolution: extractResolution(turn, i),
        });
      }

      // 3. Bash outcomes
      if (exchange.toolName === 'Bash' || exchange.toolName === 'bash') {
        const command = typeof exchange.input.command === 'string'
          ? exchange.input.command
          : '';
        for (const outcome of extractOutcomes(command)) {
          outcomeSet.add(outcome);
        }
      }

      // 4. Tasks
      if (exchange.toolName === 'TaskCreate') {
        const subject = typeof exchange.input.subject === 'string'
          ? exchange.input.subject
          : 'Unknown task';
        const id = exchange.toolUseId;
        taskMap.set(id, { description: subject, status: 'pending' });
      }

      if (exchange.toolName === 'TaskUpdate') {
        const taskId = typeof exchange.input.taskId === 'string'
          ? exchange.input.taskId
          : '';
        const status = typeof exchange.input.status === 'string'
          ? exchange.input.status
          : undefined;
        const subject = typeof exchange.input.subject === 'string'
          ? exchange.input.subject
          : undefined;

        // Update existing task or create placeholder
        const existing = taskMap.get(taskId);
        if (existing) {
          if (status) existing.status = status;
          if (subject) existing.description = subject;
        } else if (subject || status) {
          taskMap.set(taskId, {
            description: subject ?? 'Updated task',
            status: status ?? 'unknown',
          });
        }
      }
    }
  }

  return {
    filesTouched: [...fileSet].sort(),
    errors,
    outcomes: [...outcomeSet],
    tasks: [...taskMap.values()],
  };
}
