# Session Data Inventory

> Audit of available Claude Code session data for experiments

**Audited**: 2026-02-04
**Location**: `~/.claude/projects/`

---

## Summary

| Metric | Value |
|--------|-------|
| Total project directories | 31 |
| Top-level session files | 248 |
| Subagent task files | 1,246 |
| Total JSONL files | 1,494 |
| Total disk usage | 3.5 GB |
| Date range | 2026-01-05 to 2026-02-04 |
| Largest single session | 121 MB (Ultan) |
| Most sessions | apolitical-assistant (84) |

---

## Projects by Size

| # | Project | Sessions | Total Size | Largest Session | Date Range | Subagent Files |
|---|---------|----------|------------|-----------------|------------|----------------|
| 1 | Ultan | 27 | 963 MB | 121 MB | Jan 22 – Feb 04 | 171 |
| 2 | apolitical-assistant | 84 | 699 MB | 82 MB | Jan 21 – Feb 04 | 257 |
| 3 | katanalog-website | 9 | 627 MB | 109 MB | Jan 13 – Jan 21 | 36 |
| 4 | pde-book | 10 | 305 MB | 75 MB | Jan 14 – Jan 16 | 12 |
| 5 | apolitical-dev-analytics | 8 | 259 MB | 109 MB | Jan 14 – Jan 23 | 20 |
| 6 | cdx-core | 13 | 167 MB | 45 MB | Jan 29 – Feb 04 | 101 |
| 7 | codex-file-format-spec | 29 | 158 MB | 45 MB | Jan 25 – Feb 01 | 128 |
| 8 | speed-read | 7 | 42 MB | 14 MB | Feb 01 – Feb 03 | 246 |
| 9 | iksium | 3 | 21 MB | 17 MB | Jan 30 – Feb 01 | 81 |
| 10 | cdx-pandoc | 8 | 19 MB | 5 MB | Jan 29 – Feb 04 | 24 |
| 11 | baykenClaude | 7 | 16 MB | 13 MB | Jan 21 – Feb 03 | 15 |
| 12 | apolitical-bug-triage | 5 | 15 MB | 9 MB | Feb 03 – Feb 03 | 33 |
| 13 | semansiation | 3 | 13 MB | 7 MB | Feb 03 – Feb 04 | 72 |
| 14 | analytic-methods-in-pde | 3 | 8 MB | 7 MB | Jan 16 – Jan 16 | 2 |
| 15 | ghanalytics | 2 | 7 MB | 7 MB | Jan 09 – Jan 11 | 9 |
| 16 | Dev (root) | 1 | 4 MB | 4 MB | Jan 21 | 0 |
| 17 | file-format | 2 | 4 MB | 3 MB | Jan 25 | 6 |
| 18 | rust-pdf-poc | 2 | 4 MB | 4 MB | Jan 11 | 7 |
| 19 | kanpii | 1 | 3 MB | 3 MB | Jan 19 | 0 |
| 20 | thylacine | 1 | 2 MB | 2 MB | Jan 12 | 6 |
| 21 | box-packing | 2 | 1 MB | 1 MB | Jan 12 – Jan 14 | 4 |
| 22 | bengal-stm | 3 | 1 MB | 1 MB | Jan 10 – Jan 17 | 3 |
| 23 | data-v2 | 4 | 762 KB | 445 KB | Jan 09 | 0 |
| 24 | bayken-data | 1 | 723 KB | 723 KB | Jan 11 | 3 |
| 25 | thought-stream | 1 | 348 KB | 348 KB | Jan 30 | 0 |
| 26 | claude-global-skills | 2 | 206 KB | 186 KB | Jan 23 | 0 |
| 27 | gvn (home) | 2 | 133 KB | 128 KB | Jan 30 | 5 |
| 28 | pi-hole | 6 | 73 KB | 66 KB | Jan 05 – Jan 13 | 0 |
| 29 | platform-v2 | 1 | 67 KB | 67 KB | Jan 14 | 1 |
| 30 | Apolitical (root) | 1 | 9 KB | 9 KB | Jan 22 | 0 |
| 31 | iterm-temp | 1 | 6 KB | 6 KB | Jan 10 | 3 |

---

## Current Benchmark Coverage

The embedding benchmark (Run 2) uses **5 projects, 12 sessions, 294 chunks** — less than 1% of available data.

| Project | Sessions Used | Sessions Available | Notes |
|---------|--------------|-------------------|-------|
| speed-read | 3 | 7 | TypeScript, EPUB/PDF reader |
| semansiation | 2 | 3 | This project (research/NL-heavy) |
| Ultan | 2 | 27 | Swift, bibliography management |
| cdx-core | 2 | 13 | TypeScript, document format tooling |
| apolitical-assistant | 3 | 84 | TypeScript, engineering leadership tool |

---

## Untapped Projects of Interest

### High-value for corpus diversity

- **pde-book** (305 MB, 10 sessions) — Mathematical/academic content. Very different from code-heavy projects. Tests whether embeddings handle non-code technical content.
- **katanalog-website** (627 MB, 9 sessions) — Large sessions (109 MB max). Tests scaling behavior.
- **codex-file-format-spec** (158 MB, 29 sessions) — Spec/design work. Many sessions, good for cross-session pair generation.
- **apolitical-dev-analytics** (259 MB, 8 sessions) — Data/analytics domain.

### Heavily undersampled

- **apolitical-assistant** — Using 3 of 84 sessions. Most sessions and subagent activity of any project.
- **Ultan** — Using 2 of 27 sessions. Largest total data (963 MB). Swift language diversity.

### Small but potentially distinctive

- **bengal-stm**, **box-packing**, **thylacine** — Small projects, possibly different problem types.
- **analytic-methods-in-pde** — Mathematical content, pairs well with pde-book.
- **rust-pdf-poc** — Rust language diversity.

---

## Subagent Data

1,246 subagent JSONL files across 23 projects, stored at:

```
~/.claude/projects/<project>/<session-id>/subagents/agent-<agent-id>.jsonl
```

These represent parallel agent execution (Task tool invocations). Currently unused in the benchmark. Relevant for:
- Testing the causal graph's parallel agent handling
- Validating clock partitioning and merge point detection
- Understanding nested parallelism patterns

Projects with heaviest subagent usage:
- apolitical-assistant: 257 files across 36 session subdirs
- speed-read: 246 files across 6 session subdirs
- Ultan: 171 files across 26 session subdirs
- codex-file-format-spec: 128 files across 27 session subdirs
- cdx-core: 101 files across 13 session subdirs
