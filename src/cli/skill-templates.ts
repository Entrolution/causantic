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
- **project**: Filter to a specific project slug (use \`/causantic-list-projects\` to discover names)

## When to Use

- User asks about recent or past work (e.g., "What did we work on?", "What was decided about X?")
- Starting a task in an unfamiliar area — check if past sessions covered it
- Encountering an error or pattern that might have been solved before
- User references something from a previous session
- Before saying "I don't have context from previous sessions" — always try recall first

## Guidelines

- \`recall\` walks causal chains to reconstruct narrative — use it when you need the story of how something happened
- \`search\` ranks results by semantic relevance — use it for broad discovery ("what do I know about X?")
- Use the \`project\` parameter to scope results to the current project when relevant
- Combine both: \`search\` to discover, then \`recall\` to fill in the narrative
`,
  },
  {
    dirName: 'causantic-search',
    content: `---
name: causantic-search
description: "Search memory semantically to discover relevant past context. Use for broad discovery — 'what do I know about X?'"
argument-hint: [query]
---

# Search Memory

Use the \`search\` MCP tool from \`causantic\` to discover relevant past context semantically.

## Usage

\`\`\`
/causantic-search authentication implementation
/causantic-search database migration patterns
/causantic-search error handling strategies
\`\`\`

## Parameters

Pass these to the \`search\` MCP tool:

- **query** (required): What to search for in memory
- **project**: Filter to a specific project slug (use \`/causantic-list-projects\` to discover names)

## When to Use

- Broad discovery: "what do I know about X?"
- Finding past context on a topic
- When you need ranked results by semantic relevance
- As a starting point before using \`recall\` for deeper episodic narrative

## Guidelines

- Returns ranked results by semantic relevance (vector + keyword fusion)
- Use \`search\` for discovery, \`recall\` for narrative reconstruction
- Combine with \`/causantic-recall\` when you need causal chain context (how things led to outcomes)
`,
  },
  {
    dirName: 'causantic-predict',
    content: `---
name: causantic-predict
description: "Proactively surface relevant past context for a given task or topic using Causantic long-term memory. Use at the start of complex tasks to surface prior work, related decisions, or known pitfalls."
argument-hint: <context>
---

# Predict Relevant Context

Use the \`predict\` MCP tool from \`causantic\` to proactively surface relevant past context based on the current task.

## Usage

\`\`\`
/causantic-predict refactoring the auth module
/causantic-predict debugging the embedder timeout issue
\`\`\`

## Parameters

Pass these to the \`predict\` MCP tool:

- **context** (required): A concise summary of the current task, topic, or question
- **project**: Filter to a specific project slug

## When to Use

- At the start of complex tasks to check for relevant prior work
- When encountering an error or pattern that might have been solved before
- When working on something that likely has prior art in past sessions
- To surface context the user might not think to ask about

## Guidelines

- Always provide a concise summary of the current task as the \`context\` parameter
- Use early in a task to front-load relevant context
- Especially useful when starting unfamiliar work — past sessions may have covered it
`,
  },
  {
    dirName: 'causantic-explain',
    content: `---
name: causantic-explain
description: "Answer 'why' questions and explore codebase areas using memory. Handles both focused decision questions and comprehensive area briefings."
argument-hint: [question or area]
---

# Explain & Explore

Answer "why" questions about code and architecture, or build comprehensive context about a codebase area — both by reconstructing narratives from memory.

## Usage

\`\`\`
/causantic-explain why does the chunker split on tool boundaries?
/causantic-explain what led to the RRF fusion approach?
/causantic-explain the authentication module
/causantic-explain src/storage/chunk-store.ts
\`\`\`

## Intent Detection

| User asks | Mode | Output format |
|-----------|------|---------------|
| "Why does X..." / "What led to..." | Focused decision | Decision narrative |
| "Tell me about X" / area name / file path | Area briefing | Comprehensive briefing |

## Workflow

1. **Reconstruct the narrative**: Use \`recall\` with the topic to walk causal chains — problem, alternatives, what was chosen and why
2. **Gather broad context**: Use \`search\` with the topic for semantically related past context, evolution, and related discussions

## Output Format: Focused Decision

Use when the query is a specific "why" or "what led to" question:

- **Decision**: What was decided
- **Context**: The problem or need that prompted it
- **Alternatives Considered**: Other approaches that were evaluated
- **Rationale**: Why this approach was chosen
- **Trade-offs**: Known downsides or limitations accepted

## Output Format: Area Briefing

Use when the query names an area, module, file, or broad topic:

- **Purpose**: What this area does (from memory's perspective)
- **Key Decisions**: Decisions that shaped this area, with rationale
- **Evolution**: Major changes over time
- **Constraints & Tech Debt**: Known limitations or workarounds
- **Recent Activity**: What was recently changed or discussed

## When to Use

- User asks "why does X work this way?"
- User asks "what led to this decision?"
- User asks "tell me about X" or names a codebase area
- Before changing existing architecture — understand the reasoning first
- When code seems surprising or non-obvious
- When starting work in an unfamiliar area

## Guidelines

- Present the narrative as a story: what was the problem, what was tried, what stuck
- If memory shows the decision evolved over time, show the progression
- For area briefings, focus on the "why" — the user can read the code for the "what"
- If memory has conflicting information across time, present the most recent and note the evolution
- If memory has no context, say so — do not fabricate rationale
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
2. **Search for the error/issue**: Use \`recall\` with the error text to search broadly across sessions
3. **Check for related patterns**: Use \`predict\` with the same context to surface tangentially related issues
4. **Present findings**:
   - Prior occurrences of this or similar errors
   - What was tried (including failed approaches)
   - What ultimately resolved it

## Parameters

- **recall**: query = error text (from argument or extracted from conversation), project = current project
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
| a topic name | \`reconstruct\` last session + \`recall\` with that topic |

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
- For broader context beyond the last session, use timeline mode: call \`reconstruct\` with just \`project\` (no \`previous_session\`)
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
/causantic-reconstruct
/causantic-reconstruct what did I work on yesterday?
/causantic-reconstruct last session
/causantic-reconstruct past 3 days
/causantic-reconstruct session abc12345
\`\`\`

## Workflow

1. **Identify the project**: Use \`list-projects\` if the user hasn't specified one
2. **For simple recent history** (no args or "recently"): Call \`reconstruct\` with just \`project\` — timeline mode fills backwards from now until the token budget is full
3. **For specific sessions or time ranges**: Use \`list-sessions\` to browse, then \`reconstruct\` with appropriate parameters

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
| (nothing) / "recently" | just \`project\` (timeline mode — fills backwards from now) |
| "yesterday" | \`days_back: 1\` |
| "past 3 days" | \`days_back: 3\` |
| "last session" | \`previous_session: true\` + current session ID |
| "session abc123" | \`session_id: "abc123"\` |
| "this week" | \`days_back: 7\` |
| "January 15" | \`from: "2025-01-15T00:00:00Z", to: "2025-01-16T00:00:00Z"\` |

## Guidelines

- For simple recent history (no args), call \`reconstruct\` with just \`project\` — no need to browse sessions first
- For specific time ranges or session exploration, start with \`list-sessions\` to give the user an overview
- When the user says "last session", use \`previous_session: true\` — this finds the session before the current one
- Token budget is applied automatically — newest chunks are kept by default
- Results include session boundary markers for easy navigation
`,
  },
  {
    dirName: 'causantic-list-projects',
    content: `---
name: causantic-list-projects
description: "List all projects stored in Causantic long-term memory with chunk counts and date ranges. Use to discover available project names for filtering search/recall/predict queries."
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

- Before using project-filtered queries with \`/causantic-recall\`, \`/causantic-search\`, or \`/causantic-predict\`
- To see what projects have been ingested into memory
- To check the coverage and recency of memory for a specific project
`,
  },
  {
    dirName: 'causantic-status',
    content: `---
name: causantic-status
description: "Check Causantic system health: hook status, memory statistics, and version info. Use to diagnose setup issues or get an overview of the memory system."
---

# System Status

Check Causantic system health by combining hook status and memory statistics.

## Usage

\`\`\`
/causantic-status
\`\`\`

## Workflow

1. Call the \`hook-status\` MCP tool from \`causantic\` to check when hooks last ran and whether they succeeded
2. Call the \`stats\` MCP tool from \`causantic\` to get version, chunk/edge/cluster counts, and per-project breakdowns
3. Present a combined health report

## Output Format

- **Version**: Causantic version
- **Hook Status**: For each hook (session-start, session-end, pre-compact, claudemd-generator) — last run time, success/failure, duration
- **Memory Statistics**: Chunk, edge, and cluster counts
- **Projects**: Per-project chunk counts and date ranges

## When to Use

- After running \`causantic init\` to verify hooks are firing
- When memory seems stale or missing — check if hooks are running
- To get an overview of how much memory is stored
- To diagnose issues with the memory system

## Guidelines

- If hooks show errors, suggest common fixes (re-run init, check permissions)
- If memory stats are empty, suggest running batch-ingest
- Present the report concisely — this is a diagnostic tool
`,
  },
  {
    dirName: 'causantic-summary',
    content: `---
name: causantic-summary
description: "Summarize recent work across sessions for a project. Use to review accomplishments, track in-progress work, and identify patterns over a time period."
argument-hint: [time range]
---

# Work Summary

Summarize recent work across sessions by combining session browsing with context reconstruction.

## Usage

\`\`\`
/causantic-summary
/causantic-summary today
/causantic-summary this week
/causantic-summary past 3 days
\`\`\`

## Workflow

1. **Identify the project**: Derive from the current working directory (use \`list-projects\` if ambiguous)
2. **Determine time range**: Map the user's intent to a \`days_back\` value
3. **Browse sessions**: Use \`list-sessions\` with the project and time range to see all sessions
4. **Reconstruct context**: Use \`reconstruct\` with the project and time range to get the raw session content
5. **Synthesize**: Analyze the reconstructed context and produce a structured summary

## Interpreting User Intent

| User says | days_back |
|-----------|-----------|
| (nothing) / "recently" | 3 |
| "today" | 1 |
| "yesterday" | 2 |
| "this week" | 7 |
| "past N days" | N |
| "this month" | 30 |
| "this sprint" | 14 |

## Output Format

- **Period**: Date range and number of sessions
- **Accomplishments**: Completed work, merged PRs, resolved issues
- **In Progress**: Work that was started but not finished
- **Patterns**: Recurring themes, frequently touched areas, common decisions
- **Blockers / Open Issues**: Problems that came up and may still need attention
- **Next Steps**: Explicit TODOs or natural continuations

## Guidelines

- Synthesize across sessions — don't just list each session separately
- Focus on outcomes and decisions, not individual tool calls or file edits
- Group related work across sessions (e.g., "Authentication refactor" spanning 3 sessions)
- Highlight work that was started but not completed — this is the most actionable info
- If the time range has many sessions, prioritize breadth over depth
- If no sessions found for the time range, suggest widening the range
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

Search memory across all projects to find relevant patterns, solutions, or approaches. Explicitly queries each project to ensure comprehensive coverage.

## Usage

\`\`\`
/causantic-crossref rate limiting implementation
/causantic-crossref how we handle database migrations
/causantic-crossref error retry patterns
\`\`\`

## Workflow

1. **Discover projects**: Call \`list-projects\` to get all available projects
2. **Search each project**: For each relevant project (up to 5), call \`search\` with the query and that project's slug as the \`project\` filter
3. **Deepen promising hits**: For projects with strong search results, call \`recall\` with the query and project filter to reconstruct the narrative
4. **Compare across projects**: Analyze findings across projects, highlighting shared patterns, differences, and transferable solutions

## Output Format

For each project with relevant findings:
- **[Project Name]** (N chunks matched)
  - Key findings and context
  - Relevant decisions or patterns

Then synthesize:
- **Shared Patterns**: approaches used across multiple projects
- **Transferable Solutions**: what can be reused or adapted
- **Project-Specific Details**: approaches that are context-dependent

## When to Use

- Looking for how something was solved in other projects
- Checking if a pattern or approach has been used before
- Cross-project knowledge transfer
- Finding reusable code or design patterns

## Guidelines

- Always start with \`list-projects\` — don't assume which projects exist
- Use project-filtered searches for precision (avoid noise from unfiltered broad search)
- Limit to 5 most relevant projects to keep response focused
- Always attribute findings to their source project
- Highlight patterns that transfer well vs project-specific details
- If no projects have relevant context, say so clearly
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
   - Topic specified → use \`recall\` with the topic
   - Neither → default to \`days_back: 30\`
2. **Gather context**: Use \`recall\` across the scope
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

Perform a comprehensive review of the codebase and create a cleanup plan aligned to clean code and clean architecture principles, enriched with historical context from Causantic memory. Primary goals: audit dependency health (security vulnerabilities, deprecations, unmaintained projects), resolve linting errors and warnings, remove duplication, improve readability, eliminate dead code and artifacts, consolidate documentation, and enable high test coverage (70%+ target, ideally near 100%).

## Invoke Planning Mode

**Before any analysis, enter planning mode.** The output of this skill is a plan for user approval, not immediate code changes.

---

## Phase 1: Codebase Discovery

### 1.1 Project Structure Analysis
- Map the directory structure and identify architectural layers
- Identify entry points, core domain, and infrastructure boundaries
- Note the tech stack, frameworks, and key dependencies
- Find existing tests and assess current coverage

### 1.2 Internal Dependency Analysis
- Map internal dependencies between modules/packages
- Identify circular dependencies
- Check for dependency direction violations (dependencies should point inward)
- Note coupling between modules

### 1.3 External Dependency Health Audit

**Version Currency & Updates:**
- List all direct dependencies with current pinned version vs latest available
- Identify dependencies more than one major version behind
- Flag any dependencies with pending breaking changes in the next major version
- Check for deprecated dependencies (marked deprecated by maintainers)

**Security Vulnerabilities:**
- Run ecosystem security audit tools (\`cargo audit\`, \`npm audit\`, \`pip-audit\`, \`govulncheck\`, etc.)
- Cross-reference dependencies against known vulnerability databases (RustSec, GitHub Advisory, NIST NVD)
- Classify findings by severity: critical, high, medium, low
- For each vulnerability, note whether a patched version exists
- Check transitive (indirect) dependencies for vulnerabilities — not just direct ones

**Project Health & Sustainability:**
For each dependency, assess maintenance health signals:
- **Last release date** — flag if >12 months since last publish
- **Last commit date** — flag if >6 months since last commit to default branch
- **Open issues / PRs** — flag accumulating unanswered issues
- **Bus factor** — flag single-maintainer projects for critical dependencies
- **Download trends** — flag declining adoption (ecosystem-specific: crates.io, npm, PyPI)
- **Funding / backing** — note whether the project has organisational support or is volunteer-only
- **Ecosystem signals** — check for "looking for maintainer" notices, archived repos, or successor projects

**Risk Classification:**
Classify each dependency into:
| Risk Level | Criteria |
|-----------|----------|
| **Low** | Actively maintained, multiple contributors, backed by org, no known CVEs |
| **Medium** | Maintained but single maintainer, or infrequent releases, or minor CVEs patched |
| **High** | Unmaintained (>12 months), single maintainer gone, unpatched CVEs, or deprecated |
| **Critical** | Known exploited vulnerabilities, abandoned with no successor, or archived |

**Mitigation Strategies for High/Critical Risk:**
For each high/critical risk dependency, recommend one of:
1. **Bump** — newer version resolves the issue
2. **Replace** — suggest well-maintained alternative with migration path
3. **Fork** — if no alternative exists, consider maintaining a fork
4. **Embed** — for small or thin dependencies, inline the relevant code to eliminate the external dependency entirely (reduces supply chain risk)
5. **Remove** — if the dependency is no longer needed

### 1.4 Linter & Static Analysis Audit

**Run all configured linters with warnings enabled:**
Detect the project's linting tools and run them in strict/pedantic mode to surface the full picture:

| Ecosystem | Lint Command | Notes |
|-----------|-------------|-------|
| Rust | \`cargo clippy --workspace --all-features -- -W clippy::pedantic\` | Run both default and pedantic; separate findings by severity |
| TypeScript/JS | \`eslint . --max-warnings 0\` or \`biome check .\` | Check for \`eslint-disable\` comments and \`@ts-ignore\` / \`@ts-expect-error\` suppressions |
| Python | \`ruff check .\` or \`flake8 . --statistics\` | Also check \`mypy\`/\`pyright\` type errors |
| Go | \`go vet ./...\` and \`staticcheck ./...\` | Check for \`//nolint\` directives |
| General | Any project-specific linters in CI config or pre-commit hooks | Match what CI enforces |

**Classify findings:**
- **Errors** — code that won't compile, type errors, or lint rules configured as errors. These must be fixed.
- **Warnings** — potential bugs, style issues, or best practice violations. Triage by category.
- **Suppressions** — \`#[allow(...)]\`, \`// eslint-disable\`, \`@ts-ignore\`, \`# noqa\`, \`//nolint\`, etc. Audit each:
  - Is the suppression still necessary? (The underlying issue may have been fixed)
  - Is there a comment explaining why it's suppressed?
  - Can the code be refactored to eliminate the need for suppression?

**Categorise lint findings:**

| Category | Examples | Priority |
|----------|---------|----------|
| **Correctness** | Unused results, unchecked errors, unreachable code, type mismatches | High — likely bugs |
| **Performance** | Unnecessary allocations, redundant clones, inefficient patterns | Medium — profile first |
| **Style & Idiom** | Non-idiomatic patterns, naming conventions, import ordering | Low — batch fix |
| **Complexity** | Overly complex expressions, deeply nested logic, long functions | Medium — readability |
| **Deprecation** | Use of deprecated APIs, functions, or language features | High — will break on upgrade |

**Formatter compliance:**
- Run the project formatter (\`cargo fmt\`, \`prettier\`, \`black\`, \`gofmt\`, etc.) in check mode
- Note any files that don't conform
- Check if formatting is enforced in CI — if not, recommend adding it

### 1.5 Code Metrics Gathering
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
- Use \`recall\` to retrieve the episodic history behind major architectural decisions
- Use \`search\` to find past discussions about code quality, tech debt, and refactoring
- Document: why things are the way they are, what was tried before, what constraints exist

### 2.2 Known Tech Debt
- Use \`recall\` with queries like "tech debt", "TODO", "workaround", "hack", "temporary" scoped to the project
- Use \`predict\` to surface areas that memory suggests are problematic
- Cross-reference memory findings with current code state

### 2.3 Past Cleanup Attempts
- Use \`recall\` to search for previous refactoring or cleanup work
- Note what was done before, what worked, and what was abandoned
- Avoid recommending changes that were previously tried and rejected (unless circumstances changed)

### 2.4 Dependency History
- Use \`recall\` to search for past dependency upgrade attempts, compatibility issues, or migration discussions
- Use \`recall\` to understand why specific dependency versions may be pinned
- Cross-reference memory findings with current dependency state — avoid recommending upgrades that were previously tried and caused issues

### 2.5 Lint & Suppression History
- Use \`recall\` to search for past discussions about lint suppressions, intentional \`eslint-disable\` or \`@ts-ignore\` additions
- Check if past sessions document why certain warnings were left unfixed
- Note when memory shows a suppression was deliberately added for a specific edge case

\`\`\`
✓ CHECKPOINT: Phase 2 complete - Memory-Informed Context Gathering
\`\`\`

---

## Phase 3: Documentation Review

### 3.1 Documentation Inventory
- Locate all documentation files (README, docs/, wiki, inline docs)
- Identify documentation types: API docs, architecture docs, setup guides, user guides
- Map documentation to corresponding code/features
- Note documentation format and tooling (markdown, JSDoc, Sphinx, etc.)

### 3.2 Documentation Quality Assessment
- Check for outdated or stale documentation (doesn't match current code)
- Identify duplicate documentation (same info in multiple places)
- Find conflicting documentation (contradictory information)
- Note incomplete documentation (missing critical sections)
- Assess documentation accessibility and discoverability

### 3.3 Documentation Consolidation Plan
- Recommend single source of truth for each topic
- Identify documentation to merge, update, or remove
- Suggest documentation structure aligned with project architecture
- Propose automation for keeping docs in sync (doc generation, CI checks)

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
- Unused functions, methods, and classes
- Unused variables and imports
- Vestigial code from removed features
- Commented-out code blocks
- Deprecated code still present

**Debugging Artifacts:**
- Console.log, print statements, and debug output
- Hardcoded debug flags or conditions
- Debug-only code paths
- Temporary workarounds left in place

**Testing Artifacts:**
- Orphaned test files for deleted code
- Test fixtures no longer used
- Mock data files that are stale
- Test utilities that aren't called

**Outdated Artifacts:**
- Old configuration files (for removed tools/services)
- Legacy migration scripts that have been applied
- Backup files (.bak, .old, .orig)
- Generated files that should be in .gitignore
- Old build outputs or cache directories
- Stale lock files or dependency snapshots

### 4.3 Architecture Assessment

**Clean Architecture Alignment:**
- Is domain logic independent of frameworks and infrastructure?
- Are use cases clearly defined and separated?
- Do dependencies point inward (toward domain)?
- Is the domain free of I/O and side effects?

**SOLID Principles:**
- **S**: Are there classes/modules doing too much?
- **O**: Can behaviour be extended without modification?
- **L**: Are substitutions safe across inheritance?
- **I**: Are interfaces minimal and focused?
- **D**: Are high-level modules depending on abstractions?

### 4.4 Code Quality Assessment

**Readability:**
- Are names self-documenting?
- Is the code explicit over implicit?
- Are functions small and focused?
- Is nesting depth reasonable?

**Maintainability:**
- Can components be understood in isolation?
- Are side effects contained and explicit?
- Is state management clear?
- Are error paths handled consistently?

\`\`\`
✓ CHECKPOINT: Phase 4 complete - Pattern Analysis
\`\`\`

---

## Phase 5: Testability Analysis

### 5.1 Current Test Assessment
- Document existing test coverage percentage
- Identify test types present (unit, integration, e2e)
- Note testing frameworks and patterns in use
- Find untested critical paths

### 5.2 Testability Barriers
Identify code that is hard to test:
- Tight coupling to infrastructure (DB, APIs, filesystem)
- Hidden dependencies (singletons, global state)
- Side effects mixed with business logic
- Large functions doing multiple things
- Missing dependency injection

### 5.3 Coverage Gap Analysis
Prioritise untested areas by:
1. Business criticality
2. Change frequency
3. Complexity/risk
4. Ease of testing after refactor

\`\`\`
✓ CHECKPOINT: Phase 5 complete - Testability Analysis
\`\`\`

---

## Phase 6: Cleanup Plan Creation

### 6.1 Dependency Actions

**Immediate Security Fixes:**
| Dependency | Current | Fix Version | Vulnerability | Severity |
|-----------|---------|-------------|---------------|----------|
| ... | ... | ... | CVE-... | critical/high |

**Version Bumps:**
| Dependency | Current | Latest | Breaking Changes | Notes |
|-----------|---------|--------|------------------|-------|
| ... | ... | ... | yes/no | ... |

**At-Risk Dependencies:**
| Dependency | Risk Level | Issue | Recommended Action |
|-----------|-----------|-------|-------------------|
| ... | high/critical | unmaintained/deprecated/... | replace with X / embed / fork / remove |

For each at-risk dependency, include:
- Why it's flagged (specific health signals)
- Recommended alternative (if replacing), with brief comparison
- Migration complexity estimate (trivial / moderate / significant)
- If recommending embed: identify the specific functions/types used and estimate the inlining effort

### 6.2 Lint & Static Analysis Cleanup

**Errors (must fix):**
| File | Line | Lint Rule | Message | Fix |
|------|------|-----------|---------|-----|
| ... | ... | ... | ... | ... |

**Warnings by category:**
| Category | Count | Examples | Suggested Approach |
|----------|-------|---------|-------------------|
| Correctness | N | unused Result in \`foo.ts:42\` | Fix individually — likely bugs |
| Deprecation | N | \`old_api()\` in \`bar.ts:15\` | Migrate to replacement API |
| Performance | N | unnecessary clone in \`baz.ts:88\` | Batch fix, profile first |
| Style/Idiom | N | non-idiomatic match in \`qux.ts:20\` | Batch fix in single commit |
| Complexity | N | cognitive complexity 25 in \`parse()\` | Refactor as part of Phase 4 |

**Suppression audit:**
| File | Line | Suppression | Still Needed? | Action |
|------|------|------------|---------------|--------|
| ... | ... | \`// eslint-disable\` | yes/no | keep with comment / remove / refactor |

**Formatter fixes:**
- List files not conforming to project formatter
- Recommend: run formatter and commit as standalone PR (no logic changes)

### 6.3 Dead Code & Artifact Removal

**Immediate Removal** (safe to delete):
- Commented-out code (preserved in version control)
- Unused imports and variables
- Debug statements and logging
- Backup and temporary files
- Orphaned test files

**Careful Removal** (verify before deleting):
- Unused functions (check for dynamic calls)
- Vestigial feature code (confirm feature is truly removed)
- Old configuration (ensure not referenced)
- Deprecated code (check for external consumers)

### 6.4 Documentation Updates

**Documentation Actions:**
| Document | Action | Reason |
|----------|--------|--------|
| ... | Keep/Update/Merge/Remove | ... |

**Consolidation Tasks:**
- Merge duplicate docs into single source
- Update outdated documentation
- Remove documentation for deleted features
- Add missing critical documentation

### 6.5 Refactoring Opportunities

Categorise findings into:

**Quick Wins** (low effort, high impact)
- Remove dead code, unused imports, and debug statements
- Extract duplicated code into shared utilities
- Rename unclear variables/functions
- Fix obvious SOLID violations

**Structural Improvements** (medium effort)
- Extract classes/modules from large files
- Introduce missing abstractions
- Separate pure logic from side effects
- Add dependency injection where missing

**Architectural Changes** (high effort)
- Restructure to proper layers
- Extract bounded contexts
- Introduce proper interfaces/ports
- Migrate to cleaner patterns

### 6.6 Testing Strategy

For each area, recommend:
- What test types to add (unit/integration/e2e)
- What refactoring enables testing
- Order of test introduction
- Target coverage per module

**Testing Pyramid Target:**
- Unit tests: 70-80% of tests (fast, isolated)
- Integration tests: 15-25% (component boundaries)
- E2E tests: 5-10% (critical paths only)

### 6.7 Prioritised Backlog

Create a prioritised list considering:
1. **Security vulnerability fixes** — patch or bump dependencies with known CVEs (critical/high first)
2. **Lint errors & correctness warnings** — fix compiler/linter errors and correctness-category warnings (likely bugs)
3. **At-risk dependency mitigation** — replace, embed, or fork unmaintained/deprecated dependencies
4. **Dead code removal** — quick wins that reduce noise
5. **Formatter & style lint fixes** — run formatter, fix style warnings (standalone PR, no logic changes)
6. **Dependency version bumps** — bring dependencies up to date (group minor/patch bumps)
7. **Suppression audit** — remove stale \`eslint-disable\` / \`@ts-ignore\` / \`# noqa\` directives
8. **Unlocks testing** — refactors that enable high-value tests
9. **Documentation consolidation** — reduce confusion and maintenance burden
10. **High duplication** — consolidation opportunities
11. **High complexity** — simplification targets (also addresses complexity lint warnings)
12. **Architectural violations** — dependency direction fixes
13. **Technical debt hotspots** — frequently changed problem areas

\`\`\`
✓ CHECKPOINT: Phase 6 complete - Cleanup Plan Creation
\`\`\`

---

## Output Format

Write the plan to \`CLEANUP_PLAN.md\` in project root with:

\`\`\`markdown
# Codebase Cleanup Plan

## Executive Summary
[2-3 paragraph overview of findings and recommended approach]

## Current State
- **Architecture**: [assessment]
- **Test Coverage**: [current %]
- **Documentation**: [assessment]
- **Dependency Health**: [assessment — e.g., "3 critical CVEs, 5 outdated, 2 unmaintained"]
- **Lint Health**: [assessment — e.g., "0 errors, 12 warnings (3 correctness, 9 style), 5 stale suppressions"]
- **Key Issues**: [top 5-7 problems]

## Memory Context
- **Decisions from History**: [relevant architectural decisions from memory]
- **Known Tech Debt**: [tech debt items surfaced from memory]
- **Past Attempts**: [previous cleanup/refactoring attempts and outcomes]
- **Dependency History**: [past upgrade attempts, pinning reasons]
- **Lint/Suppression History**: [deliberate suppressions, unfixed warnings context]

## Dependency Health

### Security Fixes (Priority)
| Dependency | Current | Fix Version | Vulnerability | Severity |
|-----------|---------|-------------|---------------|----------|
| ... | ... | ... | CVE-... | critical/high/medium |

### At-Risk Dependencies
| Dependency | Risk | Issue | Action | Alternative / Notes |
|-----------|------|-------|--------|---------------------|
| ... | high/critical | unmaintained since YYYY | replace / embed / fork | ... |

### Version Bumps
| Dependency | Current | Latest | Breaking | Notes |
|-----------|---------|--------|----------|-------|
| ... | ... | ... | yes/no | ... |

## Lint & Static Analysis

### Errors
| File:Line | Rule | Message | Fix |
|-----------|------|---------|-----|
| ... | ... | ... | ... |

### Warnings (by category)
| Category | Count | Action |
|----------|-------|--------|
| Correctness | N | Fix individually |
| Deprecation | N | Migrate APIs |
| Performance | N | Profile then fix |
| Style | N | Batch fix |
| Complexity | N | Refactor in Phase 4 |

### Suppression Audit
| File:Line | Suppression | Verdict | Action |
|-----------|------------|---------|--------|
| ... | \`// eslint-disable\` | stale/valid | remove / keep with comment |

## Dead Code & Artifact Removal

### Immediate Removal
| Item | Location | Type | Notes |
|------|----------|------|-------|
| ... | ... | dead code/debug/artifact | ... |

### Verify Before Removal
| Item | Location | Verification Needed |
|------|----------|---------------------|
| ... | ... | ... |

## Documentation Consolidation

### Documents to Update
| Document | Updates Required |
|----------|------------------|
| ... | ... |

### Documents to Remove/Merge
| Document | Action | Target |
|----------|--------|--------|
| ... | merge into | ... |

## Refactoring Roadmap

### Phase 0: Dependency Health (Security & Supply Chain)
| Task | Impact | Effort | Dependencies Affected |
|------|--------|--------|----------------------|
| ... | ... | ... | ... |

### Phase 1: Cleanup (Remove Noise)
| Task | Impact | Effort | Files Affected |
|------|--------|--------|----------------|
| ... | ... | ... | ... |

### Phase 2: Foundation (Enable Testing)
| Task | Impact | Effort | Unlocks |
|------|--------|--------|---------|
| ... | ... | ... | ... |

### Phase 3: Consolidation (Remove Duplication)
| Task | Impact | Effort | Files Affected |
|------|--------|--------|----------------|
| ... | ... | ... | ... |

### Phase 4: Architecture (Clean Structure)
| Task | Impact | Effort | Components |
|------|--------|--------|------------|
| ... | ... | ... | ... |

## Testing Strategy
[Detailed testing approach per module/layer]

## Target State
- **Test Coverage**: [target %]
- **Architecture**: [target state description]
- **Documentation**: [target state]
- **Key Improvements**: [expected outcomes]

## Risks & Considerations
[Migration risks, breaking changes, dependencies]
\`\`\`

---

## Guidelines

### Do
- Be specific with file paths and line references
- Quantify duplication (e.g., "duplicated in 5 places")
- List every piece of dead code found
- Note all debug statements for removal
- Explain the "why" behind each recommendation
- Consider incremental refactoring paths
- Check memory before recommending changes to understand why code exists as-is
- Note when memory shows a decision was deliberate vs accidental
- Prioritise changes that unlock testing
- Run ecosystem-specific audit tools (cargo audit, npm audit, etc.) for security findings
- Check GitHub/registry pages for dependency health signals (last release, contributors, issues)
- Distinguish between direct and transitive dependency vulnerabilities
- Provide concrete alternatives when flagging at-risk dependencies
- Estimate migration effort when suggesting dependency replacements
- Run linters in strict/pedantic mode to surface the full warning set, not just what CI enforces
- Audit every lint suppression — check if still needed and has an explanatory comment
- Categorise lint findings (correctness vs style vs performance) so fixes can be batched sensibly
- Recommend formatter-only commits as standalone PRs to keep diffs reviewable

### Don't
- Recommend rewrites when refactoring suffices
- Suggest changes that break existing tests
- Over-abstract prematurely
- Ignore existing team conventions without discussion
- Recommend removing code that memory shows was deliberately written to handle a specific edge case
- Recommend an approach that memory shows was tried and abandoned
- Create a plan too large to execute incrementally
- Remove code without checking for dynamic references
- Delete documentation without confirming it's truly outdated
- Bump major versions without noting breaking changes and migration steps
- Flag a dependency as "unmaintained" just because it's stable and feature-complete (some mature libraries are intentionally low-activity)
- Recommend replacing a dependency without verifying the alternative covers the actual usage
- Blindly fix all pedantic lint warnings — some are noise; triage by category first
- Remove lint suppressions without checking if the underlying issue is actually fixed
- Mix formatter changes with logic changes in the same commit (keep diffs reviewable)

### Clean Code Principles to Apply
- Functions should do one thing
- Names should reveal intent
- Comments explain "why", code explains "what"
- Error handling is a separate concern
- Tests are first-class citizens
- Boy Scout Rule: leave code cleaner than you found it
- No dead code, no commented-out code, no debug leftovers

### Clean Architecture Principles to Apply
- Independence from frameworks
- Testability without external elements
- Independence from UI
- Independence from database
- Independence from external agencies
- Dependency Rule: source code dependencies point inward

---

## Notes

- This skill produces a **plan**, not immediate changes
- User approval required before implementing any refactoring
- Large codebases may need multiple planning sessions by area
- Consider breaking the plan into separate PRs for review
- Dead code removal is often safest to do first as a separate PR
- Documentation updates can be done in parallel with code changes
`,
  },
  {
    dirName: 'causantic-forget',
    content: `---
name: causantic-forget
description: "Delete old or unwanted memory by project, time range, session, or topic. Always previews before deleting. Use when asked to forget, clean up, or remove specific memory."
argument-hint: [query or filters]
---

# Forget Memory

Use the \`forget\` MCP tool from \`causantic\` to delete chunks from memory. Supports deletion by time range, session, or semantic topic query. Always defaults to dry-run preview.

## Usage

\\\`\\\`\\\`
/causantic-forget authentication flow
/causantic-forget everything before January
/causantic-forget session abc12345
/causantic-forget old deployment scripts
\\\`\\\`\\\`

## Workflow

1. **Identify the project**: Derive from the current working directory, or ask the user. Use \`list-projects\` if ambiguous.
2. **Determine deletion mode** based on user intent (see table below)
3. **Always preview first**: Call \`forget\` with \`dry_run: true\` (the default)
4. **Show the user what would be deleted** and ask for confirmation
5. **Only after explicit confirmation**: Call \`forget\` with \`dry_run: false\`

## Interpreting User Intent

| User says | Parameters |
|-----------|-----------|
| "forget about authentication" | \`query: "authentication", project: "..."\` |
| "forget everything before January" | \`before: "2025-01-01T00:00:00Z", project: "..."\` |
| "forget session abc123" | \`session_id: "abc123", project: "..."\` |
| "forget old auth stuff from December" | \`query: "authentication", after: "2024-12-01T00:00:00Z", before: "2025-01-01T00:00:00Z", project: "..."\` |
| "forget everything about X but be selective" | \`query: "X", threshold: 0.8, project: "..."\` |

## Parameters

Pass these to the \`forget\` MCP tool:

- **project** (required): Project slug. Use \`/causantic-list-projects\` to discover names.
- **query**: Semantic query for topic-based deletion. Finds similar chunks by embedding similarity.
- **threshold**: Similarity threshold (0–1, default 0.6). Higher = more selective. Values >1 treated as percentages (e.g., 60 → 0.6).
- **before**: Delete chunks before this ISO 8601 date.
- **after**: Delete chunks on or after this ISO 8601 date.
- **session_id**: Delete chunks from a specific session.
- **dry_run**: Preview without deleting (default: true). Set to false only after user confirmation.

When \`query\` is combined with time/session filters, they intersect (AND logic).

## Threshold Tuning

- Default 0.6 is conservative — includes moderately related chunks
- Use 0.7–0.8 for more selective deletion
- Use 0.5 for broader cleanup
- The dry-run preview shows score distribution (min/max/median) to help tune
- When >20 chunks match, the preview suggests higher thresholds

## When to Use

- User asks to forget, remove, or clean up specific memory
- User wants to delete memory about a topic ("forget everything about auth")
- User wants to delete old memory by time range
- User wants to delete a specific session's memory
- Memory contains incorrect or outdated information the user wants removed

## Guidelines

- **Always preview first** — never skip the dry-run step
- **Always confirm** — show the user what will be deleted and wait for explicit approval
- Semantic deletion uses vector-only search (no keyword/RRF) for precision
- Time and session filters can be combined with semantic query for targeted deletion
- After deletion, vectors, edges, clusters, and FTS entries are all cleaned up
- Deletion is irreversible — emphasise this to the user before confirming

## Recovery

If chunks are accidentally deleted, they can be recovered by re-ingesting the original session transcripts:

\\\`\\\`\\\`
npx causantic batch-ingest
\\\`\\\`\\\`

This re-reads session files from \`~/.claude/projects/\` and re-creates chunks, embeddings, and edges. Only missing chunks are created (existing ones are skipped via checkpoints).
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

**Core retrieval:**
- \`/causantic-recall [query]\` — Reconstruct how something happened — walks backward through causal chains (how did we solve X?)
- \`/causantic-search [query]\` — Broad discovery — find everything memory knows about a topic (what do I know about X?)
- \`/causantic-predict <context>\` — Surface what came after similar past situations — walks forward through causal chains (what's likely relevant next?)

**Understanding & analysis:**
- \`/causantic-explain [question]\` — Answer "why" questions using memory + codebase (why does X work this way?)
- \`/causantic-debug [error]\` — Search for prior encounters with an error (auto-extracts from conversation if no argument)

**Session & project navigation:**
- \`/causantic-resume\` — Resume interrupted work — start-of-session briefing
- \`/causantic-reconstruct [time range]\` — Replay a past session chronologically, or get recent history
- \`/causantic-summary [time range]\` — Factual recap of what was done across recent sessions
- \`/causantic-list-projects\` — Discover available projects
- \`/causantic-status\` — Check system health and memory statistics

**Cross-cutting analysis:**
- \`/causantic-crossref [pattern]\` — Search across all projects for reusable patterns
- \`/causantic-retro [scope]\` — Surface recurring patterns, problems, and decisions across sessions
- \`/causantic-cleanup\` — Memory-informed codebase review and cleanup plan

**Memory management:**
- \`/causantic-forget [query or filters]\` — Delete memory by topic, time range, or session (always previews first)

### Quick Decision Guide

| User intent | Skill |
|-------------|-------|
| "What do I know about X?" | \`search\` |
| "How did we solve X?" | \`recall\` |
| "Why does X work this way?" | \`explain\` |
| "What might be relevant?" | \`predict\` |
| "What happened recently?" / "Show me recent work" | \`reconstruct\` |
| "Forget/delete memory about X" | \`forget\` |

### Proactive Memory Usage

**Check memory automatically (no skill needed) when:**
- Before saying "I don't have context from previous sessions" — always try \`recall\` first
- User references past work ("remember when...", "like we did before", "that bug from last week")
- When stuck on an error after 2 failed attempts — use \`recall\` with the error text before trying a 3rd approach
- User asks "why" about existing code or architecture — use \`explain\` before guessing
- Starting work in an unfamiliar area — use \`search\` for broad discovery
- Before making significant architectural decisions — use \`recall\` to check for prior discussions
- When the user asks about recent work or session history — use \`reconstruct\` with just \`project\` for timeline mode

**Skip memory (avoid latency) when:**
- The full context is already in the conversation
- Simple file operations where memory adds no value
- Git operations handled by /commit, /pr, /merge, /qa
- The user explicitly provides all needed context
- First attempt at resolving a new error (try solving it first, check memory if stuck)

### CLI Commands

When the user asks to run Causantic operations from the command line:

\`\`\`
npx causantic init                  — Setup wizard (MCP, hooks, skills, import)
npx causantic serve                 — Start the MCP server
npx causantic dashboard             — Launch the web dashboard
npx causantic batch-ingest [dir]    — Ingest all sessions from a directory
npx causantic ingest <path>         — Ingest a single session or project
npx causantic recall <query>        — Query memory from the CLI
npx causantic stats                 — Show memory statistics
npx causantic health                — Check system health
npx causantic config [subcommand]   — Manage configuration
npx causantic maintenance [status|run|daemon] — Maintenance tasks
npx causantic benchmark-collection [--quick|--standard|--full] — Run benchmarks
npx causantic encryption [subcommand] — Manage database encryption
npx causantic export                — Export memory data
npx causantic import <file>         — Import memory data
npx causantic hook <name>           — Run a hook manually
npx causantic uninstall             — Remove Causantic and all its artifacts
\`\`\`

Run \`npx causantic <command> --help\` for command-specific options.

### Combining Memory with Other Tools

Memory provides historical context, not current code state. After retrieving memory:
- Use file search (grep/glob) to verify remembered code still exists
- Use \`git log\` to check if remembered decisions were superseded
- Do not treat memory as authoritative for current file contents — always verify against the actual codebase
${CAUSANTIC_END}`;
}
