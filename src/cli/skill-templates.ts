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
  {
    dirName: 'causantic-resume',
    content: `---
name: causantic-resume
description: "Resume interrupted work by reconstructing context from recent sessions. Use at the start of a session or when asked 'where did I leave off?'"
argument-hint: [topic or time range]
---

# Resume Work

Reconstruct context from the most recent session(s) to help the user pick up where they left off.

## Usage

\`\`\`
/causantic-resume
/causantic-resume the API refactor
/causantic-resume from yesterday
\`\`\`

## Workflow

1. **Identify the project**: Derive from the current working directory (use \`list-projects\` if ambiguous)
2. **Reconstruct the last session**: Use \`reconstruct\` with \`previous_session: true\` to get the most recent session before this one
3. **Summarize for the user**:
   - What was being worked on (key topics/tasks)
   - What was completed vs in progress
   - Any explicit next steps or TODOs mentioned
   - Any open issues or blockers
4. **If the user provided a topic**: Also run \`recall\` with that topic scoped to the project

## Interpreting User Intent

| User says | Action |
|-----------|--------|
| (nothing) | \`reconstruct\` with \`previous_session: true\` |
| "yesterday" / "last week" | \`reconstruct\` with appropriate \`days_back\` |
| a topic name | \`reconstruct\` last session + \`recall\` with that topic, \`range: "long"\` |

## Output Format

Present a concise briefing:
- **Last session**: date and duration
- **Key work**: 1-3 bullet points
- **Status**: what was completed, what was in progress
- **Next steps**: any mentioned next steps or TODOs
- **Open issues**: any blockers or unresolved problems

## Guidelines

- Keep the summary actionable, not exhaustive
- Highlight unfinished work prominently — that's what the user needs most
- If the last session ended mid-task, flag that clearly
`,
  },
  {
    dirName: 'causantic-debug',
    content: `---
name: causantic-debug
description: "Search past sessions for prior encounters with the current error, bug pattern, or issue. Use when stuck on an error or debugging a recurring problem."
argument-hint: [error message or description]
---

# Debug with Memory

Search past sessions for prior encounters with the current error, bug pattern, or issue.

## Usage

\`\`\`
/causantic-debug
/causantic-debug SQLITE_BUSY database is locked
/causantic-debug the embedder crashes on large files
\`\`\`

## Workflow

1. **Extract the error**: If no argument provided, extract the most recent error message or stack trace from the current conversation. If an argument is provided, use that as the search query.
2. **Search for the error/issue**: Use \`recall\` with the error text, \`range: "long"\` to search broadly across sessions
3. **Check for related patterns**: Use \`predict\` with the same context to surface tangentially related issues
4. **Present findings**:
   - Prior occurrences of this or similar errors
   - What was tried (including failed approaches)
   - What ultimately resolved it

## Parameters

- **recall**: query = error text (from argument or extracted from conversation), range = "long", project = current project
- **predict**: context = same error text, project = current project

## Output Format

- **Prior Occurrences**: matching past encounters with dates
- **What Was Tried**: approaches attempted, including failures
- **Resolution**: what ultimately worked
- **Related Issues**: other potentially connected problems

If no matches found, say so clearly — do not fabricate matches.

## Guidelines

- When invoked with no arguments, scan the current conversation for the most recent error, stack trace, or failing test output and use that automatically
- Include failed approaches — knowing what didn't work is as valuable as what did
- Quote relevant snippets from past sessions rather than paraphrasing
- If memory shows a recurring pattern, flag it: "This error has appeared N times"
`,
  },
  {
    dirName: 'causantic-context',
    content: `---
name: causantic-context
description: "Deep dive into a codebase area by combining decision history, evolution, and recent activity from memory. Use when you need comprehensive background on a module, feature, or design."
argument-hint: [area or topic]
---

# Deep Context

Build comprehensive context about a codebase area by combining decision history, evolution, and recent activity from memory.

## Usage

\`\`\`
/causantic-context the authentication module
/causantic-context src/storage/chunk-store.ts
/causantic-context how we handle encryption
\`\`\`

## Workflow

1. **Get decision history**: Use \`explain\` with the topic for historical narrative and rationale
2. **Get recent work**: Use \`recall\` with the topic and \`range: "short"\` for recent changes
3. **Present as a structured briefing**

## Output Format

- **Purpose**: What this area does (from memory's perspective)
- **Key Decisions**: Decisions that shaped this area, with rationale
- **Evolution**: Major changes over time
- **Constraints & Tech Debt**: Known limitations or workarounds
- **Recent Activity**: What was recently changed or discussed

## Guidelines

- Focus on the "why" — the user can read the code for the "what"
- If memory has conflicting information across time, present the most recent and note the evolution
- If memory has little context for the area, say so honestly
`,
  },
  {
    dirName: 'causantic-crossref',
    content: `---
name: causantic-crossref
description: "Search memory across all projects to find relevant patterns, solutions, or approaches. Use for cross-project knowledge transfer and finding reusable solutions."
argument-hint: [pattern or topic]
---

# Cross-Project Reference

Search memory across all projects to find relevant patterns, solutions, or approaches.

## Usage

\`\`\`
/causantic-crossref rate limiting implementation
/causantic-crossref how we handle database migrations
/causantic-crossref error retry patterns
\`\`\`

## Workflow

1. **Search all projects**: Use \`recall\` WITHOUT a project filter, \`range: "long"\`
2. **Surface related patterns**: Use \`predict\` without a project filter
3. **Group by project**: Organize results by which project they came from
4. **Highlight transferable insights**: Focus on what can be reused or adapted

## Output Format

Group findings by project:
- **[Project A]**: relevant findings
- **[Project B]**: relevant findings
- **Transferable Patterns**: what can be reused or adapted

## Guidelines

- Always attribute findings to their source project
- Highlight patterns that transfer well vs project-specific details
- This is inherently a broad search — expect some noise
`,
  },
  {
    dirName: 'causantic-retro',
    content: `---
name: causantic-retro
description: "Analyze patterns across past sessions to surface recurring themes, problems, and decisions. Use for retrospectives, sprint reviews, or understanding work patterns."
argument-hint: [time range or topic]
---

# Retrospective Analysis

Analyze patterns across past sessions to surface recurring themes, problems, and decisions.

## Usage

\`\`\`
/causantic-retro
/causantic-retro past month
/causantic-retro deployment issues
\`\`\`

## Workflow

1. **Determine scope**:
   - Time range specified → use \`list-sessions\` with that window
   - Topic specified → use \`recall\` with \`range: "long"\`
   - Neither → default to \`days_back: 30\`
2. **Gather context**: Use \`recall\` with \`range: "long"\` across the scope
3. **Synthesize patterns**: Analyze for recurring themes

## Output Format

- **Sessions Analyzed**: count and date range
- **Recurring Patterns**: themes across multiple sessions
- **Decisions Made**: key decisions with dates and context
- **Recurring Issues**: problems that came up more than once
- **Observations**: notable patterns in how work was done

## Guidelines

- Synthesize, don't just dump raw memory
- Look for patterns across sessions, not just within them
- Be honest about gaps: if memory is sparse for a period, note it
- Works best with 5+ sessions of history
`,
  },
  {
    dirName: 'causantic-cleanup',
    content: `---
name: causantic-cleanup
description: "Memory-informed codebase review and cleanup plan. Combines comprehensive code analysis with historical context from Causantic memory to create an actionable cleanup plan."
---

# Codebase Cleanup & Architecture Review

Perform a comprehensive codebase review and create a cleanup plan aligned to clean code and clean architecture principles, enriched with historical context from Causantic memory.

## Invoke Planning Mode

**Before any analysis, enter planning mode.** The output of this skill is a plan for user approval, not immediate code changes.

---

## Phase 1: Codebase Discovery

### 1.1 Project Structure Analysis
- Map the directory structure and identify architectural layers
- Identify entry points, core domain, and infrastructure boundaries
- Note the tech stack, frameworks, and key dependencies
- Find existing tests and assess current coverage

### 1.2 Dependency Analysis
- Map internal dependencies between modules/packages
- Identify circular dependencies
- Check for dependency direction violations (dependencies should point inward)
- Note external dependencies and their coupling

### 1.3 Code Metrics Gathering
- Identify large files (>300 lines) and complex functions (>30 lines)
- Find files with high cyclomatic complexity
- Locate code with deep nesting (>3 levels)
- Note long parameter lists (>4 parameters)

\`\`\`
✓ CHECKPOINT: Phase 1 complete - Codebase Discovery
\`\`\`

---

## Phase 2: Memory-Informed Context Gathering

**This phase uses Causantic memory to enrich the review with historical context.**

### 2.1 Decision History
- Use \`explain\` to retrieve the history behind major architectural decisions
- Use \`recall\` with \`range: "long"\` to find past discussions about code quality, tech debt, and refactoring
- Document: why things are the way they are, what was tried before, what constraints exist

### 2.2 Known Tech Debt
- Use \`recall\` with queries like "tech debt", "TODO", "workaround", "hack", "temporary" scoped to the project
- Use \`predict\` to surface areas that memory suggests are problematic
- Cross-reference memory findings with current code state

### 2.3 Past Cleanup Attempts
- Use \`recall\` to search for previous refactoring or cleanup work
- Note what was done before, what worked, and what was abandoned
- Avoid recommending changes that were previously tried and rejected (unless circumstances changed)

\`\`\`
✓ CHECKPOINT: Phase 2 complete - Memory-Informed Context Gathering
\`\`\`

---

## Phase 3: Documentation Review

### 3.1 Documentation Inventory
- Locate all documentation files (README, docs/, wiki, inline docs)
- Identify documentation types: API docs, architecture docs, setup guides
- Map documentation to corresponding code/features
- Note documentation format and tooling

### 3.2 Documentation Quality Assessment
- Check for outdated or stale documentation
- Identify duplicate documentation
- Find conflicting documentation
- Note incomplete documentation
- Assess discoverability

### 3.3 Documentation Consolidation Plan
- Recommend single source of truth for each topic
- Identify documentation to merge, update, or remove
- Suggest documentation structure aligned with project architecture

\`\`\`
✓ CHECKPOINT: Phase 3 complete - Documentation Review
\`\`\`

---

## Phase 4: Pattern Analysis

### 4.1 Duplication Detection
Search for:
- Exact code duplicates (copy-paste)
- Structural duplicates (same logic, different names)
- Semantic duplicates (same purpose, different implementation)
- Repeated patterns that could be abstracted

### 4.2 Dead Code & Artifact Detection

**Dead and Unused Code:**
- Unreachable code paths
- Unused functions, methods, classes, variables, imports
- Vestigial code from removed features
- Commented-out code blocks
- Deprecated code still present

**Debugging Artifacts:**
- Console.log, print statements, debug output
- Hardcoded debug flags or conditions
- Temporary workarounds left in place

**Outdated Artifacts:**
- Old configuration files
- Legacy migration scripts already applied
- Backup files (.bak, .old, .orig)
- Generated files that should be in .gitignore

### 4.3 Architecture Assessment

**Clean Architecture Alignment:**
- Is domain logic independent of frameworks and infrastructure?
- Are use cases clearly defined and separated?
- Do dependencies point inward (toward domain)?
- Is the domain free of I/O and side effects?

**SOLID Principles:**
- **S**: Classes/modules doing too much?
- **O**: Can behaviour be extended without modification?
- **L**: Are substitutions safe across inheritance?
- **I**: Are interfaces minimal and focused?
- **D**: Are high-level modules depending on abstractions?

### 4.4 Code Quality Assessment

**Readability:** Self-documenting names, explicit over implicit, small focused functions, reasonable nesting depth

**Maintainability:** Components understandable in isolation, contained side effects, clear state management, consistent error handling

\`\`\`
✓ CHECKPOINT: Phase 4 complete - Pattern Analysis
\`\`\`

---

## Phase 5: Testability Analysis

### 5.1 Current Test Assessment
- Document existing test coverage
- Identify test types present (unit, integration, e2e)
- Note testing frameworks and patterns
- Find untested critical paths

### 5.2 Testability Barriers
- Tight coupling to infrastructure
- Hidden dependencies (singletons, global state)
- Side effects mixed with business logic
- Large functions doing multiple things
- Missing dependency injection

### 5.3 Coverage Gap Analysis
Prioritise untested areas by: business criticality, change frequency, complexity/risk, ease of testing

\`\`\`
✓ CHECKPOINT: Phase 5 complete - Testability Analysis
\`\`\`

---

## Phase 6: Cleanup Plan Creation

### 6.1 Dead Code & Artifact Removal

**Immediate Removal** (safe): Commented-out code, unused imports/variables, debug statements, backup files, orphaned test files

**Careful Removal** (verify first): Unused functions (check dynamic calls), vestigial feature code, old configuration, deprecated code

### 6.2 Refactoring Opportunities

**Quick Wins** (low effort, high impact): Remove dead code, extract duplicates, rename unclear names, fix obvious SOLID violations

**Structural Improvements** (medium effort): Extract classes from large files, introduce missing abstractions, separate pure logic from side effects, add dependency injection

**Architectural Changes** (high effort): Restructure to proper layers, extract bounded contexts, introduce interfaces/ports

### 6.3 Testing Strategy

**Testing Pyramid Target:**
- Unit tests: 70-80% (fast, isolated)
- Integration tests: 15-25% (component boundaries)
- E2E tests: 5-10% (critical paths only)

### 6.4 Prioritised Backlog

Order by: 1) Dead code removal, 2) Unlocks testing, 3) Documentation consolidation, 4) High duplication, 5) High complexity, 6) Architectural violations, 7) Tech debt hotspots

\`\`\`
✓ CHECKPOINT: Phase 6 complete - Cleanup Plan Creation
\`\`\`

---

## Output Format

Write the plan to \`CLEANUP_PLAN.md\` in project root with sections:
- Executive Summary
- Current State (architecture, coverage, documentation, top issues)
- Memory Context (decisions from history, known tech debt, past attempts)
- Dead Code & Artifact Removal (immediate + careful)
- Documentation Consolidation
- Refactoring Roadmap (phases 1-4)
- Testing Strategy
- Target State
- Risks & Considerations

---

## Guidelines

### Do
- Be specific with file paths and line references
- Quantify duplication ("duplicated in 5 places")
- List every piece of dead code found
- Check memory before recommending changes to understand why code exists as-is
- Note when memory shows a decision was deliberate vs accidental
- Prioritise changes that unlock testing

### Don't
- Recommend rewrites when refactoring suffices
- Suggest changes that break existing tests
- Over-abstract prematurely
- Recommend removing code that memory shows was deliberately written to handle a specific edge case
- Recommend an approach that memory shows was tried and abandoned
- Create a plan too large to execute incrementally
`,
  },
];

/**
 * Returns a CLAUDE.md reference block for Causantic.
 * Lists all skills and provides proactive memory usage guidance.
 */
export function getMinimalClaudeMdBlock(): string {
  const CAUSANTIC_START = '<!-- CAUSANTIC_MEMORY_START -->';
  const CAUSANTIC_END = '<!-- CAUSANTIC_MEMORY_END -->';

  return `${CAUSANTIC_START}
## Memory (Causantic)

Long-term memory is available via the \`causantic\` MCP server.

### Skills
- \`/causantic-resume\` — Resume interrupted work (start-of-session briefing)
- \`/causantic-recall [query]\` — Look up context from past sessions
- \`/causantic-explain [topic]\` — Understand history behind decisions
- \`/causantic-predict\` — Surface relevant past context proactively
- \`/causantic-debug [error]\` — Search for prior encounters with an error (auto-extracts from conversation if no argument)
- \`/causantic-context [area]\` — Deep dive into a codebase area's history
- \`/causantic-crossref [pattern]\` — Search across all projects
- \`/causantic-retro [scope]\` — Retrospective pattern analysis
- \`/causantic-cleanup\` — Memory-informed codebase review and cleanup plan
- \`/causantic-list-projects\` — Discover available projects
- \`/causantic-reconstruct [time range]\` — Reconstruct session context by time

### Proactive Memory Usage

**Check memory automatically (no skill needed) when:**
- Before saying "I don't have context from previous sessions" — always try \`recall\` first
- User references past work ("remember when...", "like we did before", "that bug from last week")
- When stuck on an error after 2 failed attempts — use \`recall\` with the error text before trying a 3rd approach
- User asks "why" about existing code or architecture — use \`explain\` before guessing
- Before making significant architectural decisions — use \`recall\` to check for prior discussions

**Skip memory (avoid latency) when:**
- The full context is already in the conversation
- Simple file operations where memory adds no value
- Git operations handled by /commit, /pr, /merge, /qa
- The user explicitly provides all needed context
- First attempt at resolving a new error (try solving it first, check memory if stuck)

### Combining Memory with Other Tools

Memory provides historical context, not current code state. After retrieving memory:
- Use file search (grep/glob) to verify remembered code still exists
- Use \`git log\` to check if remembered decisions were superseded
- Do not treat memory as authoritative for current file contents — always verify against the actual codebase
${CAUSANTIC_END}`;
}
