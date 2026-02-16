# Research Archive

These are the original working documents from the Causantic research and design phase (February 2026). They contain the raw analysis, experiment data, and design thinking that shaped the final implementation.

For distilled, up-to-date documentation, see the parent [Research](../README.md) section.

## Documents

| Document                                                         | Description                                                                                                                                         |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [feasibility-study.md](feasibility-study.md)                     | Initial feasibility analysis including competitor landscape, integration points, causal graph formalism, and architecture recommendation            |
| [pre-implementation-plan.md](pre-implementation-plan.md)         | Prioritized checklist of ~25 open questions organized into P0/P1/P2, with resolved answers from experiments                                         |
| [edge-decay-model.md](edge-decay-model.md)                       | Comprehensive design document for temporal decay curves including multi-linear, delayed linear, and exponential models with full experiment results |
| [session-data-inventory.md](session-data-inventory.md)           | Audit of 32 projects, 251 sessions, 3.5 GB of Claude Code session data used for experiments                                                         |
| [embedding-benchmark-results.md](embedding-benchmark-results.md) | Two-run embedding model benchmark (66 → 294 chunks) plus 5 follow-up experiments on jina-small                                                      |
| [topic-continuity-results.md](topic-continuity-results.md)       | Topic boundary detection experiment across 75 sessions, 2,817 transitions — lexical-only achieves 0.998 AUC                                         |
| [vector-clocks.md](vector-clocks.md)                             | D-T-D vector clock model for logical distance — replaced by chain walking in v0.3                                                                   |
| [decay-models.md](decay-models.md)                               | Hop-based decay models (exponential backward, linear forward) — removed in v0.3                                                                     |
| [decay-curves.md](decay-curves.md)                               | Decay curve experiments: 9 models, 30 sessions, MRR analysis — superseded by chain walking                                                          |

## Relationship to Current Docs

Key findings from these documents have been extracted into the distilled research documentation:

- **Competitor analysis** → [Landscape Analysis](../approach/landscape-analysis.md)
- **Design decisions** → [Design Decision Log](../decisions.md)
- **Embedding experiment results** → [Embedding Models](../experiments/embedding-models.md)
- **Topic continuity results** → [Topic Continuity](../experiments/topic-continuity.md)
- **What didn't work** → [Lessons Learned](../experiments/lessons-learned.md)
