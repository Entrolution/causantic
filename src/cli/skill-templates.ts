/**
 * SKILL.md templates for Causantic Claude Code skills.
 *
 * These get installed to ~/.claude/skills/causantic-<name>/SKILL.md
 * by the `causantic init` wizard, replacing the old CLAUDE.md injection approach.
 */

export interface SkillTemplate {
  /** Directory name under ~/.claude/skills/ */
  dirName: string;
  /** Full SKILL.md content (frontmatter + markdown) */
  content: string;
}

export const CAUSANTIC_SKILLS: SkillTemplate[] = [
  {
    dirName: 'causantic-recall',
    content: `---
name: causantic-recall
description: "Look up context from past sessions using Causantic long-term memory. Use when asked about recent or past work, previous decisions, errors solved before, or context from prior sessions."
argument-hint: [query]
---

# Recall Past Context

Use the \`recall\` MCP tool from \`causantic\` to look up specific context from past sessions.

## Usage

\`\`\`
/causantic-recall What did we work on recently?
/causantic-recall authentication implementation decisions
/causantic-recall that migration bug we fixed last week
\`\`\`

## Parameters

Pass these to the \`recall\` MCP tool:

- **query** (required): Natural language question about past work
- **range**: \`"short"\` for recent work (last few sessions), \`"long"\` for historical context
- **project**: Filter to a specific project slug (use \`/causantic-list-projects\` to discover names)

## When to Use

- User asks about recent or past work (e.g., "What did we work on?", "What was decided about X?")
- Starting a task in an unfamiliar area — check if past sessions covered it
- Encountering an error or pattern that might have been solved before
- User references something from a previous session
- Before saying "I don't have context from previous sessions" — always try recall first

## Guidelines

- Use \`range: "short"\` for recent work, \`range: "long"\` for historical context
- Use the \`project\` parameter to scope results to the current project when relevant
- Combine with \`/causantic-explain\` when the user needs deeper understanding of why something was done
`,
  },
  {
    dirName: 'causantic-explain',
    content: `---
name: causantic-explain
description: "Explain the history behind a topic, decision, or implementation using Causantic long-term memory. Use when asked 'why' something was done, 'how we got here', or to trace the evolution of a feature."
argument-hint: [topic]
---

# Explain History

Use the \`explain\` MCP tool from \`causantic\` to understand the history and rationale behind topics and decisions.

## Usage

\`\`\`
/causantic-explain why we chose SQLite for the database
/causantic-explain how the authentication system evolved
/causantic-explain the reasoning behind the project labels design
\`\`\`

## Parameters

Pass these to the \`explain\` MCP tool:

- **query** (required): Topic, decision, or feature to explain
- **project**: Filter to a specific project slug

## When to Use

- User asks "why" or "how did we get here"
- Need to understand rationale behind past architectural decisions
- Tracing the evolution of a feature or design pattern
- Investigating why a particular approach was chosen over alternatives

## Guidelines

- Defaults to long-range retrieval for comprehensive history
- Returns chronological narrative of relevant context
- Best for understanding decision-making, not just facts
`,
  },
  {
    dirName: 'causantic-predict',
    content: `---
name: causantic-predict
description: "Proactively surface relevant past context based on the current discussion using Causantic long-term memory. Use at the start of complex tasks to surface prior work, related decisions, or known pitfalls."
argument-hint: [context]
---

# Predict Relevant Context

Use the \`predict\` MCP tool from \`causantic\` to proactively surface relevant past context based on the current discussion.

## Usage

\`\`\`
/causantic-predict
/causantic-predict refactoring the auth module
\`\`\`

## Parameters

Pass these to the \`predict\` MCP tool:

- **query** (optional): Current task or topic context. If omitted, uses the current discussion.
- **project**: Filter to a specific project slug

## When to Use

- At the start of complex tasks to check for relevant prior work
- When encountering an error or pattern that might have been solved before
- When working on something that likely has prior art in past sessions
- To surface context the user might not think to ask about

## Guidelines

- Use early in a task to front-load relevant context
- Especially useful when starting unfamiliar work — past sessions may have covered it
`,
  },
  {
    dirName: 'causantic-list-projects',
    content: `---
name: causantic-list-projects
description: "List all projects stored in Causantic long-term memory with chunk counts and date ranges. Use to discover available project names for filtering recall/explain/predict queries."
---

# List Memory Projects

Use the \`list-projects\` MCP tool from \`causantic\` to see all projects in memory.

## Usage

\`\`\`
/causantic-list-projects
\`\`\`

## Output

Returns a list of projects with:
- Project name (slug)
- Number of memory chunks
- Date range (first seen to last seen)

## When to Use

- Before using project-filtered queries with \`/causantic-recall\`, \`/causantic-explain\`, or \`/causantic-predict\`
- To see what projects have been ingested into memory
- To check the coverage and recency of memory for a specific project
`,
  },
  {
    dirName: 'causantic-reconstruct',
    content: `---
name: causantic-reconstruct
description: "Reconstruct session context from Causantic long-term memory. Use to rebuild what was worked on yesterday, show the last session, or reconstruct context from a time range."
argument-hint: [time range or description]
---

# Reconstruct Session Context

Use the \`list-sessions\` and \`reconstruct\` MCP tools from \`causantic\` to rebuild session context chronologically.

## Usage

\`\`\`
/causantic-reconstruct what did I work on yesterday?
/causantic-reconstruct last session
/causantic-reconstruct past 3 days
/causantic-reconstruct session abc12345
\`\`\`

## Workflow

1. **Identify the project**: Use \`list-projects\` if the user hasn't specified one
2. **Browse sessions**: Use \`list-sessions\` to see available sessions and their time ranges
3. **Reconstruct**: Use \`reconstruct\` with appropriate parameters

## Parameters for \`list-sessions\`

- **project** (required): Project slug
- **from**: Start date (ISO 8601)
- **to**: End date (ISO 8601)
- **days_back**: Look back N days

## Parameters for \`reconstruct\`

- **project** (required): Project slug
- **session_id**: Specific session ID
- **from** / **to**: Time range (ISO 8601)
- **days_back**: Look back N days
- **previous_session**: Get the session before the current one (set to \`true\`)
- **current_session_id**: Required when \`previous_session\` is true
- **keep_newest**: Keep newest chunks when truncating (default: true)

## Interpreting User Intent

| User says | Parameters |
|-----------|-----------|
| "yesterday" | \`days_back: 1\` |
| "past 3 days" | \`days_back: 3\` |
| "last session" | \`previous_session: true\` + current session ID |
| "session abc123" | \`session_id: "abc123"\` |
| "this week" | \`days_back: 7\` |
| "January 15" | \`from: "2025-01-15T00:00:00Z", to: "2025-01-16T00:00:00Z"\` |

## Guidelines

- Always start with \`list-sessions\` to give the user an overview before reconstructing
- When the user says "last session", use \`previous_session: true\` — this finds the session before the current one
- Token budget is applied automatically — newest chunks are kept by default
- Results include session boundary markers for easy navigation
`,
  },
];

/**
 * Returns a minimal CLAUDE.md reference block for Causantic.
 * This replaces the verbose instructions that are now in skills.
 */
export function getMinimalClaudeMdBlock(): string {
  const CAUSANTIC_START = '<!-- CAUSANTIC_MEMORY_START -->';
  const CAUSANTIC_END = '<!-- CAUSANTIC_MEMORY_END -->';

  return `${CAUSANTIC_START}
## Memory (Causantic)

Long-term memory is available via the \`causantic\` MCP server and Causantic skills:
- \`/causantic-recall [query]\` — Look up context from past sessions
- \`/causantic-explain [topic]\` — Understand history behind decisions
- \`/causantic-predict\` — Surface relevant past context proactively
- \`/causantic-list-projects\` — Discover available projects
- \`/causantic-reconstruct [time range]\` — Reconstruct session context by time

Always try memory tools before saying "I don't have context from previous sessions."
${CAUSANTIC_END}`;
}
