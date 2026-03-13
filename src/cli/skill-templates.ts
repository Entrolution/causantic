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
description: "Walk causal chains in Causantic memory to reconstruct how something happened. Use for topic-specific questions like 'how did we solve X?' or 'what led to this decision?' — NOT for 'what did we do last/recently' (use reconstruct or resume for that)."
argument-hint: [query]
---

# Recall Past Context

Use the \`recall\` MCP tool from \`causantic\` to trace causal chains for specific topics or decisions.

## Usage

\`\`\`
/causantic-recall how did we solve the auth bug?
/causantic-recall authentication implementation decisions
/causantic-recall that migration bug we fixed last week
\`\`\`

## Parameters

Pass these to the \`recall\` MCP tool:

- **query** (required): A specific topic, decision, or problem to trace
- **project**: Filter to a specific project slug (use \`/causantic-list-projects\` to discover names)
- **agent**: Filter to a specific agent (e.g., "researcher"). Use for team sessions to scope recall to a single agent's work. The filter applies to seed selection only — chain walking crosses agent boundaries freely.

## When to Use

- User asks HOW something was solved or WHY a decision was made
- Looking up a specific topic, pattern, or decision from past sessions
- Encountering an error or pattern that might have been solved before
- Before saying "I don't have context from previous sessions" — always try recall first

## When NOT to Use

- **"What did we do last?"** / **"What were we working on?"** / **"Show me recent work"** → use \`reconstruct\` or \`resume\` instead (recall is semantic, not time-ordered)
- **"Where did I leave off?"** → use \`resume\`

## Guidelines

- **Always pass the \`project\` parameter** scoped to the current project (derive from the working directory) unless the user explicitly asks for cross-project results
- \`recall\` walks causal chains to reconstruct narrative — use it when you need the story of how something happened
- \`recall\` also searches session summaries — if matching summaries are found, they appear as supplementary context before the chain walk results
- \`recall\` is semantic, NOT time-ordered — it returns whatever matches best regardless of recency
- \`search\` uses keyword-first (BM25) retrieval by default — good for exact matches on function names, error codes, etc.
- For temporal queries ("recently", "last session", "yesterday"), always use \`reconstruct\` or \`resume\`
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
- **agent**: Filter to a specific agent (e.g., "researcher"). Use for team sessions to scope search to a single agent's contributions.

## When to Use

- Broad discovery: "what do I know about X?"
- Finding past context on a topic
- When you need ranked results by semantic relevance
- As a starting point before using \`recall\` for deeper episodic narrative

## Guidelines

- **Always pass the \`project\` parameter** scoped to the current project (derive from the working directory) unless the user explicitly asks for cross-project results
- By default, search uses **hybrid (BM25 + vector)** retrieval with entity boosting — combines exact keyword matching with semantic similarity
- For recent/latest session queries, use \`reconstruct\` instead
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
- **agent**: Filter to a specific agent (e.g., "researcher"). Use for team sessions to scope predictions to a single agent's context.

## When to Use

- At the start of complex tasks to check for relevant prior work
- When encountering an error or pattern that might have been solved before
- When working on something that likely has prior art in past sessions
- To surface context the user might not think to ask about

## Guidelines

- **Always pass the \`project\` parameter** scoped to the current project (derive from the working directory) unless the user explicitly asks for cross-project results
- Always provide a concise summary of the current task as the \`context\` parameter
- Use early in a task to front-load relevant context
- Especially useful when starting unfamiliar work — past sessions may have covered it
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
2. **Get a structured briefing**: Use \`reconstruct\` with \`mode: "briefing"\` for a structured summary combining session state (files touched, outcomes, tasks) with a structural repo map
3. **If briefing mode is unavailable or more detail is needed**: Fall back to \`reconstruct\` with \`previous_session: true\` to get the most recent session before this one
4. **Summarize for the user**:
   - What was being worked on (key topics/tasks)
   - What was completed vs in progress
   - Any explicit next steps or TODOs mentioned
   - Any open issues or blockers
5. **If the user provided a topic**: Also run \`recall\` with that topic scoped to the project

## Interpreting User Intent

| User says | Action |
|-----------|--------|
| (nothing) | \`reconstruct\` with \`mode: "briefing"\` (preferred) or \`previous_session: true\` |
| "yesterday" / "last week" | \`reconstruct\` with appropriate \`days_back\` |
| a topic name | \`reconstruct\` with \`mode: "briefing"\` + \`recall\` with that topic |

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
- For team sessions: note the team composition (which agents were involved), what each agent worked on, and any inter-agent coordination that occurred
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
- **agent**: Filter to a specific agent (e.g., "researcher"). For team sessions, reconstructs only that agent's chunks. Agent boundaries are shown automatically when multiple agents are present.

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
    dirName: 'causantic-cleanup',
    content: `---
name: causantic-cleanup
description: "Multi-agent codebase review and cleanup plan. Spawns specialist agents for infrastructure, design, and documentation analysis, then synthesizes findings into a prioritised CLEANUP_PLAN.md."
---

# Multi-Agent Codebase Cleanup & Architecture Review

Perform a comprehensive, multi-agent review of the codebase and create a cleanup plan aligned to clean code and clean architecture principles, enriched with historical context from Causantic memory.

The work is split across parallel domain-specialist agents, each with a fresh context window, then findings are synthesized into the final CLEANUP_PLAN.md.

Primary goals: audit dependency health (security vulnerabilities, deprecations, unmaintained projects), resolve linting errors and warnings, remove duplication, improve readability, eliminate dead code and artifacts, consolidate documentation, and enable high test coverage (70%+ target, ideally near 100%).

## Invoke Planning Mode

**Before any analysis, enter planning mode.** The output of this skill is a plan for user approval, not immediate code changes.

---

## Phase 1: Reconnaissance (Lead Agent)

Quick scan to gather enough context to brief the specialist agents. Duration: ~2 minutes of globbing/reading.

### 1.1 Tech Stack & Project Structure
- Map the directory structure and identify architectural layers
- Identify the tech stack, frameworks, and package manager
- Locate test framework, linter config, formatter config, CI config
- Find the main entry points and key files

### 1.2 Key File Inventory
- Package manifest (package.json, Cargo.toml, pyproject.toml, go.mod, etc.)
- Linter/formatter configuration files
- CI/CD pipeline configuration
- Test configuration
- Documentation files (README, docs/, CHANGELOG, etc.)

### 1.3 Build Reconnaissance Context Object

Assemble a context object to pass to each specialist:

\`\`\`
Project: [name]
Root: [absolute path]
Tech Stack: [language, framework, package manager]
Test Framework: [framework, config location]
Linter: [tool, config location]
Formatter: [tool, config location]
CI: [tool, config location]
Key Files: [list of paths]
LOC Estimate: [approximate lines of code]
\`\`\`

**For small codebases (<5,000 LOC):** Note that a single-agent approach may be more efficient. Proceed with multi-agent if the user invoked this skill, but mention the option.

\`\`\`
✓ CHECKPOINT: Phase 1 complete - Reconnaissance
\`\`\`

---

## Phase 1.5: Memory Gathering (Lead Agent)

The lead agent has MCP access to Causantic tools — subagents do not. Gather all historical context now and pass it as text to the specialists.

### 1.5.1 Query Memory

Run these queries **sequentially** (do NOT delegate to subagents, do NOT run in parallel). **Always pass \`project\` scoped to the current project** (derive from the working directory) to avoid pulling in memories from other projects.

1. \`search\` with query: "architecture decisions", \`project: "<current-project>"\`, \`max_tokens: 4000\`
2. \`search\` with query: "tech debt", \`project: "<current-project>"\`, \`max_tokens: 4000\`
3. \`search\` with query: "past cleanup findings", \`project: "<current-project>"\`, \`max_tokens: 4000\`

After each query, discard any results that duplicate earlier findings. Stop querying early if accumulated memory exceeds the total cap of 12K tokens.

### 1.5.2 Assemble Memory Context

Summarize memory into a concise bullet list (max 2K tokens) before passing to subagents. Structure it as:

\`\`\`
## Memory Context (from Causantic)

### Architecture Decisions
[summarized results from search "architecture decisions"]

### Known Tech Debt
[summarized results from search "tech debt"]

### Past Cleanup Findings
[summarized results from search "past cleanup findings"]
\`\`\`

If Causantic MCP tools are unavailable, skip this phase and note the gap.

\`\`\`
✓ CHECKPOINT: Phase 1.5 complete - Memory Gathered
\`\`\`

---

## Phase 2: Spawn Specialist Agents

Spawn 3 specialist agents **in parallel** using the Task tool. Each agent is \`subagent_type: "general-purpose"\` (full tool access).

Pass each agent:
1. The reconnaissance context from Phase 1
2. The memory context from Phase 1.5 (as text — agents do not have MCP access to Causantic)
3. Their domain-specific prompt (copied from the Specialist Prompts section below)

\`\`\`
✓ CHECKPOINT: Phase 2 complete - Specialists Spawned
\`\`\`

---

## Phase 3: Synthesis (Lead Agent)

Collect the 3 specialist reports and synthesize into the final plan.

### 3.1 Map Specialist Outputs
Map each specialist's output sections into the CLEANUP_PLAN.md template structure.

### 3.2 Memory Cross-Referencing
For each infrastructure/design/docs finding, check if the memory context from Phase 1.5 provides historical context that modifies the recommendation:
- Dependency pinned for a compatibility reason → note in Version Bumps table
- Suppression added deliberately for an edge case → mark as "valid" in Suppression Audit
- Architecture chosen for a specific reason → note in Architecture Assessment

### 3.3 Contradiction Resolution
When memory contradicts a specialist finding:
- Include both perspectives
- Add a "⚠️ Requires human decision" flag
- Default to the safer option (e.g., keep the pin, keep the suppression)

### 3.4 Deduplication
- Dead code findings from Infrastructure + unused code from Design → merge into single Dead Code section
- When the same item appears from multiple specialists with different severity assessments, take the highest severity and annotate with the contributing perspectives
- Lint findings from Infrastructure + complexity findings from Design → merge categories

### 3.5 Prioritised Backlog
Merge all findings into 13-tier priority ordering:
1. **Security vulnerability fixes** — patch or bump dependencies with known CVEs (critical/high first)
2. **Lint errors & correctness warnings** — fix compiler/linter errors and correctness-category warnings (likely bugs)
3. **At-risk dependency mitigation** — replace, embed, or fork unmaintained/deprecated dependencies
4. **Dead code removal** — quick wins that reduce noise
5. **Formatter & style lint fixes** — run formatter, fix style warnings (standalone PR, no logic changes)
6. **Dependency version bumps** — bring dependencies up to date (group minor/patch bumps)
7. **Suppression audit** — remove stale lint suppressions
8. **Unlocks testing** — refactors that enable high-value tests
9. **Documentation consolidation** — reduce confusion and maintenance burden
10. **High duplication** — consolidation opportunities
11. **High complexity** — simplification targets
12. **Architectural violations** — dependency direction fixes
13. **Technical debt hotspots** — frequently changed problem areas

\`\`\`
✓ CHECKPOINT: Phase 3 complete - Synthesis
\`\`\`

---

## Phase 4: Write CLEANUP_PLAN.md

Write the synthesized plan to \`CLEANUP_PLAN.md\` in the project root using the Output Format below.

Present a brief summary to the user and prompt for review.

\`\`\`
✓ CHECKPOINT: Phase 4 complete - CLEANUP_PLAN.md Written
\`\`\`

---

## Specialist Prompts

Each prompt below is a complete, self-contained block. Copy the entire section content (everything under the heading) into the Task tool's \`prompt\` parameter when spawning the specialist. Replace \`[INSERT RECONNAISSANCE CONTEXT HERE]\` with the actual reconnaissance context from Phase 1.

### Specialist: Infrastructure

You are the Infrastructure Specialist for a codebase cleanup review. Your job is to perform mechanical, tool-heavy analysis of the project's external dependencies, security posture, linting health, and dead artifacts.

**Project Context:**
[INSERT RECONNAISSANCE CONTEXT HERE]

**Your Scope:**
You are responsible for the following analyses. Be thorough and report everything you find.

#### 1. External Dependency Health Audit

**1.1 Version Currency & Updates**
- List all direct dependencies with current pinned version vs latest available
- Identify dependencies more than one major version behind
- Flag deprecated dependencies (marked deprecated by maintainers)
- Check for pending breaking changes in the next major version

**1.2 Security Vulnerabilities**
- Run ecosystem security audit tools (\`npm audit\`, \`cargo audit\`, \`pip-audit\`, \`govulncheck\`, etc.)
- Classify findings by severity: critical, high, medium, low
- For each vulnerability, note whether a patched version exists
- Check transitive (indirect) dependencies for vulnerabilities

**1.3 Project Health & Sustainability**
For each dependency, assess maintenance health signals:
- **Last release date** — flag if >12 months since last publish
- **Last commit date** — flag if >6 months since last commit
- **Open issues / PRs** — flag accumulating unanswered issues
- **Bus factor** — flag single-maintainer projects for critical dependencies
- **Ecosystem signals** — archived repos, "looking for maintainer" notices, successor projects

**1.4 Risk Classification**
Classify each flagged dependency:

| Risk Level | Criteria |
|-----------|----------|
| **Low** | Actively maintained, multiple contributors, no known CVEs |
| **Medium** | Maintained but single maintainer, infrequent releases, or minor CVEs patched |
| **High** | Unmaintained (>12 months), single maintainer gone, unpatched CVEs, deprecated |
| **Critical** | Known exploited vulnerabilities, abandoned with no successor, archived |

**1.5 Mitigation Strategies (for High/Critical only)**
For each, recommend one of:
1. **Bump** — newer version resolves the issue
2. **Replace** — suggest well-maintained alternative
3. **Fork** — if no alternative exists
4. **Embed** — for small deps, inline the relevant code
5. **Remove** — if no longer needed

#### 2. Lint & Static Analysis Audit

**2.1 Run Linters**
Detect the project's linting tools and run them in strict/pedantic mode:
- TypeScript/JS: \`eslint . --max-warnings 0\` or \`biome check .\`
- Rust: \`cargo clippy --workspace --all-features -- -W clippy::pedantic\`
- Python: \`ruff check .\` or \`flake8 . --statistics\`
- Go: \`go vet ./...\` and \`staticcheck ./...\`
- Also run any project-specific linters from CI config or pre-commit hooks

**2.2 Classify Findings**
- **Errors** — must be fixed
- **Warnings** — triage by category (correctness, performance, style, complexity, deprecation)
- **Suppressions** — audit each \`eslint-disable\`, \`@ts-ignore\`, \`# noqa\`, \`#[allow(...)]\`, \`//nolint\`:
  - Is it still necessary?
  - Is there an explanatory comment?
  - Can the code be refactored to eliminate the need?

**2.3 Formatter Compliance**
- Run the project formatter in check mode (\`prettier --check\`, \`cargo fmt --check\`, \`black --check\`, etc.)
- List files that don't conform
- Note whether formatting is enforced in CI

#### 3. Dead Code & Artifact Detection

**3.1 Dead Code**
- Unused exports, functions, classes, methods
- Unused variables and imports
- Unreachable code paths
- Commented-out code blocks

**3.2 Debug Artifacts**
- Console.log, print statements, debug output
- Hardcoded debug flags or conditions
- Temporary workarounds left in place

**3.3 Stale Artifacts**
- Orphaned test files for deleted code
- Unused test fixtures and mock data
- Old configuration files for removed tools
- Backup files (.bak, .old, .orig)
- Generated files that should be in .gitignore

#### Output Format

Return your findings as a structured markdown report with these sections:

**Security Fixes**

| Dependency | Current | Fix Version | Vulnerability | Severity |
|-----------|---------|-------------|---------------|----------|

**At-Risk Dependencies**

| Dependency | Risk Level | Issue | Recommended Action | Alternative |
|-----------|-----------|-------|-------------------|-------------|

**Version Bumps**

| Dependency | Current | Latest | Breaking Changes | Notes |
|-----------|---------|--------|------------------|-------|

**Lint Findings — Errors**

| File:Line | Rule | Message |
|-----------|------|---------|

**Lint Findings — Warnings by Category**

| Category | Count | Examples | Suggested Approach |
|----------|-------|---------|-------------------|

**Suppression Audit**

| File:Line | Suppression | Still Needed? | Has Comment? | Action |
|-----------|------------|---------------|-------------|--------|

**Formatter Compliance**
[Files not conforming, CI enforcement status]

**Dead Code**

| Item | Location | Type |
|------|----------|------|

**Debug Artifacts**

| Item | Location | Type |
|------|----------|------|

**Stale Artifacts**

| Item | Location | Type |
|------|----------|------|

**Cap each table at 30 items.** If more exist, note the total count and say "N additional items not shown."

Be specific with file paths and line references. Report facts, not opinions.

### Specialist: Design

You are the Design Specialist for a codebase cleanup review. Your job is to assess code quality, architecture, structure, duplication, and testability — areas that require reading comprehension and judgment rather than running tools.

**Project Context:**
[INSERT RECONNAISSANCE CONTEXT HERE]

**Your Scope:**
You are responsible for the following analyses. Read code thoroughly and provide specific, evidence-based findings.

#### 1. Project Structure & Internal Dependencies

**1.1 Internal Dependency Mapping**
- Map dependencies between modules/packages
- Identify circular dependencies
- Check dependency direction (should point inward toward domain)
- Note coupling between modules

**1.2 Architecture Assessment**

**Clean Architecture Alignment:**
- Is domain logic independent of frameworks and infrastructure?
- Are use cases clearly defined and separated?
- Do dependencies point inward (toward domain)?
- Is the domain free of I/O and side effects?

**SOLID Principles:**
- **S**: Classes/modules doing too much? (list specific violations)
- **O**: Can behaviour be extended without modification?
- **L**: Are substitutions safe across inheritance?
- **I**: Are interfaces minimal and focused?
- **D**: Are high-level modules depending on abstractions?

#### 2. Code Quality Assessment

**2.1 Readability**
- Are names self-documenting?
- Is the code explicit over implicit?
- Are functions small and focused?
- Is nesting depth reasonable? (flag >3 levels)

**2.2 Maintainability**
- Can components be understood in isolation?
- Are side effects contained and explicit?
- Is state management clear?
- Are error paths handled consistently?

**2.3 Code Metrics**
- Identify large files (>300 lines) with reason they're large
- Complex functions (>30 lines) — list each with line count
- Functions with deep nesting (>3 levels)
- Long parameter lists (>4 parameters)

#### 3. Duplication Detection

Search for:
- **Exact duplicates**: copy-pasted code blocks
- **Structural duplicates**: same logic, different names/variables
- **Semantic duplicates**: same purpose, different implementation
- **Repeated patterns**: patterns that could be abstracted (but only if used 3+ times)

For each duplicate found, provide:
- Both locations (file:line)
- Approximate size (lines)
- Suggested consolidation approach

#### 4. Testability Analysis

**4.1 Current Test Assessment**
- Document existing test types (unit, integration, e2e)
- Note testing frameworks and patterns in use
- Find untested critical paths

**4.2 Testability Barriers**
Identify code that is hard to test:
- Tight coupling to infrastructure (DB, APIs, filesystem)
- Hidden dependencies (singletons, global state)
- Side effects mixed with business logic
- Large functions doing multiple things
- Missing dependency injection

**4.3 Coverage Gap Analysis**
Prioritise untested areas by:
1. Business criticality
2. Change frequency
3. Complexity/risk
4. Ease of testing after refactor

#### Output Format

Return your findings as a structured markdown report with these sections:

**Architecture Assessment**
[Clean architecture alignment findings, dependency direction violations]

**Internal Dependencies**
[Module dependency map, circular dependencies, coupling issues]

**SOLID Findings**

| Principle | File:Line | Violation | Severity | Suggestion |
|-----------|-----------|-----------|----------|------------|

**Code Quality**

Large Files:

| File | Lines | Reason |
|------|-------|--------|

Complex Functions:

| Function | File:Line | Lines | Nesting Depth | Issue |
|----------|-----------|-------|---------------|-------|

Long Parameter Lists:

| Function | File:Line | Param Count |
|----------|-----------|-------------|

**Duplication**

| Location 1 | Location 2 | Size (lines) | Type | Consolidation Approach |
|------------|------------|-------------|------|----------------------|

**Testability Report**

Current State:
[Test types present, frameworks, coverage if known]

Barriers:

| Barrier | Location | Type | Impact on Testing |
|---------|----------|------|-------------------|

Coverage Gaps (Prioritised):

| Area | Priority | Reason | Prerequisite Refactor |
|------|----------|--------|----------------------|

Testing Strategy Recommendation:
[Recommended approach per module/layer, testing pyramid target]

**Cap each table at 30 items.** If more exist, note the total count and say "N additional items not shown."

Be specific with file paths and line references. Support findings with evidence from the code.

### Specialist: Documentation

You are the Documentation Specialist for a codebase cleanup review. Your job is to audit all project documentation for accuracy, coverage, and structure — then recommend a consolidation plan.

**Project Context:**
[INSERT RECONNAISSANCE CONTEXT HERE]

**Your Scope:**
You are responsible for the following analyses.

#### 1. Documentation Inventory & Classification

**1.1 Find All Documentation**
Locate all documentation files:
- README files (root and nested)
- docs/ directory contents
- CHANGELOG, CONTRIBUTING, LICENSE, SECURITY, CODE_OF_CONDUCT
- Inline documentation (JSDoc, rustdoc, docstrings, etc.)
- Wiki or external documentation references
- Architecture Decision Records (ADRs)
- Configuration documentation
- API documentation (OpenAPI specs, GraphQL schemas, etc.)

**1.2 Classify Each Document**
For each document, classify as:
- **Active** — describes current functionality, actively maintained
- **Historical** — describes past decisions or deprecated features, kept for reference
- **Generated** — auto-generated (API docs, type docs, etc.)
- **Stale** — has not been updated to match current code
- **Orphaned** — describes features/code that no longer exists

#### 2. Accuracy Audit

**2.1 Cross-Reference Against Implementation**
For each active document:
- Do code examples compile/run?
- Do API descriptions match actual signatures?
- Do configuration references match actual config schemas?
- Do architecture descriptions match actual structure?
- Are version numbers and compatibility claims current?

**2.2 Identify Inaccuracies**
List specific inaccuracies with:
- Document path and section
- What the document says
- What the code actually does
- Suggested correction

#### 3. Coverage Gaps

**3.1 Enumerate Public Surface Area**
- Public APIs, exported functions, CLI commands
- Configuration options
- Environment variables
- Key architectural concepts

**3.2 Identify Undocumented Items**
For each undocumented public item, note:
- What it is and where it lives
- Priority (high = user-facing, low = internal utility)

#### 4. Structure & Normalisation

**4.1 Overlap Analysis**
- Find topics documented in multiple places
- Identify contradictions between documents
- Note redundant content

**4.2 Orphan Detection**
- Documents referencing deleted files or features
- Links to non-existent pages or sections
- Stale cross-references

**4.3 Proposed Hierarchy**
Recommend a documentation structure:
- What is the single source of truth for each topic?
- Which documents should be merged?
- Which should be removed?
- What new documents are needed?

#### Output Format

Return your findings as a structured markdown report with these sections:

**Inventory Summary**

| Document | Path | Type | Classification | Last Updated |
|----------|------|------|---------------|-------------|

**Accuracy Findings**

| Document | Section | Issue | Current Content | Correct Content |
|----------|---------|-------|-----------------|-----------------|

**Coverage Gaps**

| Item | Type | Location | Priority | Notes |
|------|------|----------|----------|-------|

**Structure Recommendations**

Documents to Update:

| Document | Updates Required |
|----------|-----------------|

Documents to Merge:

| Source | Target | Reason |
|--------|--------|--------|

Documents to Remove:

| Document | Reason |
|----------|--------|

New Documents Needed:

| Topic | Priority | Suggested Location |
|-------|----------|-------------------|

**Cap each table at 30 items.** If more exist, note the total count and say "N additional items not shown."

---

## Output Format

Write the plan to \`CLEANUP_PLAN.md\` in the project root with:

\`\`\`markdown
# Codebase Cleanup Plan

## Executive Summary
[2-3 paragraph overview of findings and recommended approach. Note any specialist gaps (agents that failed or returned no findings).]

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

### At-Risk Dependencies
| Dependency | Risk | Issue | Action | Alternative / Notes |
|-----------|------|-------|--------|---------------------|

### Version Bumps
| Dependency | Current | Latest | Breaking | Notes |
|-----------|---------|--------|----------|-------|

## Lint & Static Analysis

### Errors
| File:Line | Rule | Message | Fix |
|-----------|------|---------|-----|

### Warnings (by category)
| Category | Count | Action |
|----------|-------|--------|

### Suppression Audit
| File:Line | Suppression | Verdict | Action |
|-----------|------------|---------|--------|

## Dead Code & Artifact Removal

### Immediate Removal
| Item | Location | Type | Notes |
|------|----------|------|-------|

### Verify Before Removal
| Item | Location | Verification Needed |
|------|----------|---------------------|

## Documentation Consolidation

### Documents to Update
| Document | Updates Required |
|----------|------------------|

### Documents to Remove/Merge
| Document | Action | Target |
|----------|--------|--------|

## Refactoring Roadmap

### Phase 0: Dependency Health (Security & Supply Chain)
| Task | Impact | Effort | Dependencies Affected |
|------|--------|--------|----------------------|

### Phase 1: Cleanup (Remove Noise)
| Task | Impact | Effort | Files Affected |
|------|--------|--------|----------------|

### Phase 2: Foundation (Enable Testing)
| Task | Impact | Effort | Unlocks |
|------|--------|--------|---------|

### Phase 3: Consolidation (Remove Duplication)
| Task | Impact | Effort | Files Affected |
|------|--------|--------|----------------|

### Phase 4: Architecture (Clean Structure)
| Task | Impact | Effort | Components |
|------|--------|--------|------------|

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

## Synthesis Rules

1. Map each specialist's output sections into the CLEANUP_PLAN.md template
2. **Memory cross-referencing**: For each infrastructure/design/docs finding, check if the memory context from Phase 1.5 provides historical context that modifies the recommendation (e.g., dependency pinned for compatibility, suppression added deliberately, architecture chosen for specific reason)
3. **Contradiction resolution**: When memory context contradicts a specialist, include both perspectives with a "⚠️ Requires human decision" flag. Default to the safer option.
4. **Deduplication**: Dead code findings from infrastructure + unused code from design — merge into single Dead Code section. When the same item appears from multiple specialists with different severity assessments, take the highest severity and annotate with the contributing perspectives.
5. **Prioritised backlog**: Merge all findings into the 13-tier priority ordering defined in Phase 3.

---

## Error Handling

- If a specialist returns no findings or fails: note the gap in Executive Summary, proceed with available data
- If memory gathering (Phase 1.5) fails: graceful degradation — omit Memory Context section, note gap
- If all specialists fail: fall back to single-agent analysis of highest-priority areas (security, lint errors)
- If the Task tool is unavailable or spawning fails: fall back to single-agent sequential analysis (Phase 1 areas first, then most critical from each specialist domain)

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
- Distinguish between direct and transitive dependency vulnerabilities
- Provide concrete alternatives when flagging at-risk dependencies
- Run linters in strict/pedantic mode to surface the full warning set
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
    dirName: 'causantic-roadmap',
    content: `---
name: causantic-roadmap
description: "Gather deferred work, cleanup findings, and user goals into a phased roadmap. Produces ROADMAP.md — designed to be shaped by human review."
argument-hint: [goal]
---

# Project Roadmap

Gather candidate work items from multiple sources — cleanup findings, memory, codebase TODOs, and user-provided goals — then deduplicate, classify, and organize them into a phased roadmap for human review.

This is a synthesis task. The agent organizes; the human decides.

## Invoke Planning Mode

**Before any analysis, enter planning mode.** The output of this skill is a draft roadmap for user approval and shaping.

---

## Phase 1: Gather Candidate Items

### 1.1 Read Existing CLEANUP_PLAN.md
If \`CLEANUP_PLAN.md\` exists in the project root:
- Extract items from the Prioritised Backlog section
- Tag each with source: "cleanup"
- Only import backlog items, not every individual finding

### 1.2 Read Existing ROADMAP.md
If \`ROADMAP.md\` exists in the project root (updating an existing roadmap):
- Carry forward all existing items
- Preserve their current phase assignments and status
- Tag each with source: "existing-roadmap"

### 1.3 Query Causantic Memory

Run memory queries **sequentially** in the lead agent context. Do not delegate memory queries to subagents — they cannot access MCP tools. Do NOT run these queries in parallel.

After each query, discard any results that duplicate earlier findings. Stop querying early if accumulated memory exceeds the total cap of 16K tokens.

Use the causantic MCP tools to surface deferred and aspirational work. **Always pass \`project\` scoped to the current project** (derive from the working directory) to avoid pulling in memories from other projects.
1. \`search\` query: "deferred TODO future work", \`project: "<current-project>"\`, \`max_tokens: 4000\`
2. \`search\` query: "roadmap milestone release plan", \`project: "<current-project>"\`, \`max_tokens: 4000\`
3. \`recall\` query: "features we want to build", \`project: "<current-project>"\`, \`max_tokens: 4000\`
4. \`predict\` context: "project roadmap and future work", \`project: "<current-project>"\`, \`max_tokens: 4000\`
- Tag each with source: "memory"

If causantic MCP tools are unavailable or return nothing, note the gap and proceed with other sources.

### 1.4 User-Provided Goals
If the user passed arguments when invoking this skill:
- Parse them as goals or feature descriptions
- Tag each with source: "user"

### 1.5 Scan Codebase for TODO/FIXME/HACK/XXX
Search the codebase for inline markers:
- \`TODO\`, \`FIXME\`, \`HACK\`, \`XXX\` comments
- Tag each with source: "codebase-todo"
- Include file path and line number

\`\`\`
✓ CHECKPOINT: Phase 1 complete - Candidates Gathered
\`\`\`

---

## Phase 2: Deduplicate and Classify

### 2.1 Merge and Deduplicate
- Combine all candidate items
- Deduplicate by semantic similarity (same work described differently across sources)
- When merging duplicates, note all contributing sources

### 2.2 Classify Each Item

| Field | Values |
|-------|--------|
| **Type** | security, bug, tech-debt, infrastructure, quality, feature, docs, aspirational |
| **Source** | cleanup, existing-roadmap, memory, user, codebase-todo |
| **Effort** | trivial, small, medium, large, epic |
| **Impact** | low, medium, high, critical |
| **Status** | new, carried-forward, in-progress, blocked |

### 2.3 Group by Theme
Organize items into logical themes (e.g., "Authentication", "Testing", "Performance", "Developer Experience").

\`\`\`
✓ CHECKPOINT: Phase 2 complete - Items Classified
\`\`\`

---

## Phase 3: Dependency Analysis and Ordering

### 3.1 Identify Dependencies
- Which items depend on other items being completed first?
- Which items conflict with each other?

### 3.2 Identify Force Multipliers
- Items that unlock multiple other items
- Infrastructure work that reduces effort for downstream tasks
- Quality improvements that make future work safer

### 3.3 Propose Phased Ordering

| Phase | Name | Focus |
|-------|------|-------|
| 0 | Foundation | Security fixes, blockers, prerequisites |
| 1 | Cleanup | Tech debt, dead code, lint fixes |
| 2 | Infrastructure | Dependencies, CI/CD, test harness |
| 3 | Quality | Coverage, documentation, code quality |
| 4 | Features | New functionality |
| 5 | Aspirational | Nice-to-haves, experiments |

Assign each item to a phase based on its type, dependencies, and impact.

\`\`\`
✓ CHECKPOINT: Phase 3 complete - Items Ordered
\`\`\`

---

## Phase 4: Present Draft for Human Shaping

### 4.1 Write ROADMAP.md
Write the roadmap to \`ROADMAP.md\` in the project root using the Output Format below.

### 4.2 Present Summary
Show the user:
- Total items by phase
- Total items by source
- Key force multipliers
- Items flagged as "Requires human decision"

### 4.3 Prompt for Review
Ask the user to review and adjust:
- Are the phase assignments correct?
- Should any items be deferred or removed?
- Are there missing items to add?
- Is the priority ordering right?

\`\`\`
✓ CHECKPOINT: Phase 4 complete - ROADMAP.md Written
\`\`\`

---

## Output Format

\`\`\`markdown
# Project Roadmap

## Executive Summary
[Brief overview: how many items, where they came from, key themes]

## Sources
| Source | Items |
|--------|-------|
| Cleanup plan | N |
| Memory | N |
| Codebase TODOs | N |
| User goals | N |
| Existing roadmap | N |

## Phase 0: Foundation
| # | Item | Type | Effort | Impact | Source | Unlocks |
|---|------|------|--------|--------|--------|---------|

## Phase 1: Cleanup
| # | Item | Type | Effort | Impact | Source | Unlocks |
|---|------|------|--------|--------|--------|---------|

## Phase 2: Infrastructure
| # | Item | Type | Effort | Impact | Source | Unlocks |
|---|------|------|--------|--------|--------|---------|

## Phase 3: Quality
| # | Item | Type | Effort | Impact | Source | Unlocks |
|---|------|------|--------|--------|--------|---------|

## Phase 4: Features
| # | Item | Type | Effort | Impact | Source | Unlocks |
|---|------|------|--------|--------|--------|---------|

## Phase 5: Aspirational
| # | Item | Type | Effort | Impact | Source | Unlocks |
|---|------|------|--------|--------|--------|---------|

## Deferred / Won't Do
| Item | Reason |
|------|--------|

## Dependencies
[Key dependency chains between items — which items must complete before others can start]

## Notes
[Any caveats, gaps in data sources, or items flagged for human decision]
\`\`\`

---

## Error Handling

- If \`CLEANUP_PLAN.md\` doesn't exist: skip that source, note it in Sources table
- If \`ROADMAP.md\` doesn't exist: this is a new roadmap (not an update)
- If causantic MCP tools fail or return nothing: proceed with cleanup plan + TODOs + user goals, note the gap
- If no sources produce any items: inform the user and suggest running \`/causantic-cleanup\` first

---

## Guidelines

### Do
- Present this as a **draft** for human shaping, not a final plan
- Preserve item provenance (which source each item came from)
- Highlight force multipliers — items that unlock many others
- Group related items to show themes
- Note when memory provides additional context on an item
- Be specific about what each item entails

### Don't
- Include every individual lint warning or dead code instance from cleanup — only import Prioritised Backlog items
- Make priority decisions the human should make — flag them for review instead
- Fabricate items that aren't grounded in sources
- Remove items from an existing roadmap without explanation
- Over-specify effort estimates — use t-shirt sizes, not hours
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

**Retrieval:**
- \`/causantic-recall [query]\` — Reconstruct how something happened — walks backward through causal chains (how did we solve X?)
- \`/causantic-search [query]\` — Broad discovery — find everything memory knows about a topic (what do I know about X?)
- \`/causantic-predict <context>\` — Surface what came after similar past situations — walks forward through causal chains (what's likely relevant next?)

**Session navigation:**
- \`/causantic-resume\` — Resume interrupted work — structured briefing with session state and repo map
- \`/causantic-reconstruct [time range]\` — Replay a past session chronologically, or get recent history
- \`/causantic-list-projects\` — Discover available projects

**Planning:**
- \`/causantic-cleanup\` — Memory-informed codebase review and cleanup plan
- \`/causantic-roadmap [goal]\` — Gather deferred work and goals into a phased roadmap
- \`/causantic-status\` — Check system health and memory statistics

**Memory management:**
- \`/causantic-forget [query or filters]\` — Delete memory by topic, time range, or session (always previews first)

### Quick Decision Guide

| User intent | Skill |
|-------------|-------|
| "What do I know about X?" | \`search\` |
| "How did we solve X?" / "What led to this decision?" | \`recall\` |
| "Why does X work this way?" | \`recall\` |
| "What might be relevant?" | \`predict\` |
| "What happened recently?" / "Show me recent work" | \`reconstruct\` |
| "Where did I leave off?" / "Briefing to continue" | \`resume\` |
| "I keep hitting this error" | \`search\` |
| "What did we accomplish?" | \`reconstruct\` |
| "Review the codebase" | \`cleanup\` |
| "What should we work on next?" / "Build a roadmap" | \`roadmap\` |
| "What projects are in memory?" | \`list-projects\` |
| "Forget/delete memory about X" | \`forget\` |

**Key distinctions:**
- \`recall\` = narrative (how/why X happened) — walks causal chains to reconstruct a story
- \`search\` = discovery (what do I know about X) — broad semantic search without chain walking
- \`reconstruct\`/\`resume\` are time-ordered (finds most recent work). For any question about "last", "recent", or "latest" → use \`reconstruct\` or \`resume\`, never \`recall\`.

**Agent filtering:** For team sessions (multiple agents), all retrieval tools accept an optional \`agent\` parameter to scope results to a specific agent (e.g., "researcher"). Agent boundaries are shown automatically in output when multiple agents contributed.

### Proactive Memory Usage

**Check memory** before saying "I don't have context" or when the user references past work.
Use \`search\` for discovery, \`recall\` for specific decisions, \`reconstruct\` for recent history.

**Skip memory** when context is already in the conversation, for simple operations, or for git workflows.

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
