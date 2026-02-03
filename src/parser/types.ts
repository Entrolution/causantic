/**
 * Core types for Claude Code session parsing.
 *
 * These mirror the JSONL format written by Claude Code at
 * ~/.claude/projects/<project>/<session>.jsonl
 */

// ── Raw JSONL line types ────────────────────────────────

export type RawMessageType = 'user' | 'assistant' | 'progress' | 'file-history-snapshot';

/** A single content block inside an assistant message. */
export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | ToolResultBlock;

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface MessagePayload {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
  model?: string;
  id?: string;
  stop_reason?: string | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/** A single line parsed from the session JSONL. */
export interface RawMessage {
  type: RawMessageType;
  uuid: string;
  timestamp: string;
  sessionId: string;
  parentUuid: string | null;
  isSidechain: boolean;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  slug?: string;
  userType?: string;
  message?: MessagePayload;
  toolUseResult?: string | Record<string, unknown>;
  sourceToolAssistantUUID?: string;
  planContent?: string;
  // progress-specific
  data?: Record<string, unknown>;
  parentToolUseID?: string;
  toolUseID?: string;
  // file-history-snapshot-specific
  messageId?: string;
  snapshot?: Record<string, unknown>;
  isSnapshotUpdate?: boolean;
}

// ── Parsed / assembled types ────────────────────────────

/** A conversational turn: one user prompt + its assistant response + tool exchanges. */
export interface Turn {
  /** Ordinal position in the session. */
  index: number;
  /** ISO timestamp of the first message in this turn. */
  startTime: string;
  /** The user's initiating message (text content only). */
  userText: string;
  /** All assistant content blocks in this turn. */
  assistantBlocks: ContentBlock[];
  /** Tool use / result pairs in order. */
  toolExchanges: ToolExchange[];
  /** Whether this turn contains thinking blocks. */
  hasThinking: boolean;
  /** Raw messages composing this turn (for traceability). */
  rawMessages: RawMessage[];
}

export interface ToolExchange {
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
  result: string;
  isError: boolean;
}

// ── Chunk types ─────────────────────────────────────────

export type RenderMode = 'full' | 'summary' | 'code-focused';

export interface ChunkMetadata {
  sessionId: string;
  sessionSlug: string;
  turnIndices: number[];
  startTime: string;
  endTime: string;
  codeBlockCount: number;
  toolUseCount: number;
  hasThinking: boolean;
  renderMode: RenderMode;
  /** Approximate token count of the rendered text. */
  approxTokens: number;
}

export interface Chunk {
  /** Unique identifier for this chunk. */
  id: string;
  /** The rendered text to embed. */
  text: string;
  /** Metadata for evaluation and tracing. */
  metadata: ChunkMetadata;
}

// ── Session-level types ─────────────────────────────────

export interface SessionInfo {
  sessionId: string;
  slug: string;
  cwd: string;
  messageCount: number;
  startTime: string;
  endTime: string;
  filePath: string;
}
