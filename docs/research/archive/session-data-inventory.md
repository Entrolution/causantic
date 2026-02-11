# Session Data Inventory

> Audit of available Claude Code session data for experiments

**Audited**: 2026-02-06
**Location**: `~/.claude/projects/`

---

## Summary

| Metric | Value |
|--------|-------|
| Total project directories | 32 |
| Top-level session files | 251 |
| Subagent task files | 1,421 |
| Total JSONL files | 1,672 |
| Total disk usage | 3.5 GB |
| Date range | 2026-01-05 to 2026-02-06 |
| Largest single session | 121 MB (Ultan) |
| Most sessions | apolitical-assistant (86) |

---

## Projects by Size

| # | Project | Sessions | Total Size | Type | Notes |
|---|---------|----------|------------|------|-------|
| 1 | Ultan | 28 | 1.0 GB | Coding | Swift, bibliography management app |
| 2 | apolitical-assistant | 86 | 751 MB | Coding | TypeScript, engineering leadership tool |
| 3 | katanalog-website | 9 | 639 MB | Coding | Large sessions (109 MB max) |
| 4 | **pde-book** | 10 | 312 MB | **Non-coding** | Mathematical/academic writing |
| 5 | apolitical-dev-analytics | 8 | 267 MB | Coding | Data/analytics, TypeScript |
| 6 | codex-file-format-spec | 29 | 213 MB | Coding | Spec/design work |
| 7 | cdx-core | 13 | 178 MB | Coding | TypeScript, document format tooling |
| 8 | speed-read | 8 | 50 MB | Coding | TypeScript, EPUB/PDF reader |
| 9 | iksium | 4 | 37 MB | Coding | |
| 10 | semansiation | 4 | 29 MB | Coding | This project (research/NL-heavy) |
| 11 | cdx-pandoc | 8 | 24 MB | Coding | Pandoc integration |
| 12 | baykenClaude | 7 | 19 MB | Coding | |
| 13 | apolitical-bug-triage | 5 | 17 MB | Coding | Bug triage tool |
| 14 | ghanalytics | 2 | 9 MB | Coding | GitHub analytics |
| 15 | **analytic-methods-in-pde** | 3 | 8 MB | **Non-coding** | Mathematical research |
| 16 | file-format | 2 | 5 MB | Coding | File format spec |
| 17 | Dev (root) | 1 | 4 MB | Mixed | |
| 18 | rust-pdf-poc | 2 | 4 MB | Coding | Rust, PDF processing |
| 19 | kanpii | 1 | 3 MB | Coding | |
| 20 | thylacine | 1 | 2 MB | Coding | |
| 21 | box-packing | 2 | 2 MB | Coding | Algorithm/optimization |
| 22 | bengal-stm | 3 | 1 MB | Coding | |
| 23 | **Personal-advice** | 1 | 820 KB | **Non-coding** | Personal/relationship guidance |
| 24 | data-v2 | 4 | 772 KB | Mixed | |
| 25 | bayken-data | 1 | 740 KB | Mixed | |
| 26 | platform-v2 | 1 | 596 KB | Coding | |
| 27 | thought-stream | 1 | 352 KB | Mixed | |
| 28 | claude-global-skills | 2 | 216 KB | Coding | |
| 29 | gvn (home) | 2 | 184 KB | Mixed | |
| 30 | pi-hole | 1 | 68 KB | Coding | Network config |
| 31 | iterm-temp | 1 | 20 KB | Coding | |
| 32 | Apolitical (root) | 1 | 12 KB | Mixed | |

---

## Session Type Classification

### Coding Sessions (Majority)
Standard software development conversations involving:
- Code generation, debugging, refactoring
- Tool use (Read, Edit, Bash, Grep, etc.)
- Technical planning and architecture
- Git operations and PR workflows

**Characteristics**: High tool_use density, code blocks, file references

### Non-Coding Sessions (New)

| Project | Sessions | Size | Content Type |
|---------|----------|------|--------------|
| **pde-book** | 10 | 312 MB | Mathematical writing, LaTeX, PDE theory |
| **analytic-methods-in-pde** | 3 | 8 MB | Mathematical research, proofs |
| **Personal-advice** | 1 | 820 KB | Relationship guidance, mental health discussion |

**Characteristics**:
- Low/no tool_use activity
- Longer natural language exchanges
- Different topic continuity patterns (fewer explicit file references)
- More emotionally nuanced content (Personal-advice)

### Why Non-Coding Matters for Experiments

1. **Topic continuity detection**: Non-coding sessions lack file path references, testing whether lexical/embedding features generalize
2. **Relevance decay**: Conversational memory patterns may differ from coding task patterns
3. **Semantic clustering**: Tests whether embeddings trained on general text work for technical math vs. personal discussions

---

## Topic Continuity Experiment Coverage

The topic continuity experiment (Run 1) used **30 sessions, 1,538 transitions** from coding projects only.

| Metric | Value |
|--------|-------|
| Sessions | 30 |
| Transitions | 1,538 |
| Valid (with prior context) | 1,407 |
| Continuations | 1,428 (93%) |
| New topics | 110 (7%) |

**Gap**: Non-coding sessions not yet included. Should add pde-book and Personal-advice for diversity.

---

## Embedding Benchmark Coverage

The embedding benchmark uses **5 projects, 12 sessions, 294 chunks** — less than 1% of available data.

| Project | Sessions Used | Sessions Available |
|---------|--------------|-------------------|
| speed-read | 3 | 8 |
| semansiation | 2 | 4 |
| Ultan | 2 | 28 |
| cdx-core | 2 | 13 |
| apolitical-assistant | 3 | 86 |

---

## Recommended Additions for Edge Decay Experiments

### For relevance decay modeling:

1. **pde-book** (10 sessions, 312 MB)
   - Long-form mathematical discussions
   - Tests whether decay patterns differ for knowledge-building vs. task-execution

2. **Personal-advice** (1 session, 820 KB)
   - Deeply contextual conversation
   - Tests whether emotional/personal content has different relevance decay

3. **katanalog-website** (9 sessions, 639 MB)
   - Large sessions with many turns
   - Good for measuring decay over long time spans within sessions

4. **apolitical-assistant** (86 sessions)
   - Most session count, heavily undersampled
   - Diverse conversation patterns across many sessions

---

## Subagent Data

1,421 subagent JSONL files across 24 projects, stored at:

```
~/.claude/projects/<project>/<session-id>/subagents/agent-<agent-id>.jsonl
```

These represent parallel agent execution (Task tool invocations). Currently unused in experiments. Relevant for:
- Testing the causal graph's parallel agent handling
- Validating clock partitioning and merge point detection
- Understanding nested parallelism patterns

Projects with heaviest subagent usage:
- apolitical-assistant: 257 files
- speed-read: 246 files
- Ultan: 171 files
- codex-file-format-spec: 128 files
- cdx-core: 101 files
