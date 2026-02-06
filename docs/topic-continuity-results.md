# Topic Continuity Detection Experiment Results

## Overview

This experiment evaluates classifiers for detecting whether a user's message **continues** the previous conversation topic or **starts a new topic**. This directly supports the D-T-D model's edge creation logic: continuations create causal edges from previous assistant chunks to the new user chunk; new topics do not.

## Dataset

**Source**: 30 Claude Code sessions from `~/.claude/projects/`

| Metric | Count |
|--------|-------|
| Total transitions | 1,538 |
| Valid (with prior context) | 1,407 |
| Continuations | 1,428 (93%) |
| New topics | 110 (7%) |
| High confidence labels | 812 (53%) |

### Label Distribution by Source

| Source | Count | Label | Confidence |
|--------|-------|-------|------------|
| Same-session adjacent | 660 | continuation | medium |
| Tool/file references | 409 | continuation | high |
| Explicit continuation markers | 359 | continuation | high |
| Time gap (>30 min) | 66 | new_topic | medium |
| Session boundaries | 26 | new_topic | high |
| Explicit shift markers | 18 | new_topic | high |

The dataset is imbalanced (93% continuations), reflecting the reality that most adjacent turns in coding sessions continue the same topic.

## Classifiers Evaluated

### 1. Embedding-Only
- Compute angular distance between user text embedding and previous assistant output embedding
- Score = 1 - distance (higher = more likely continuation)

### 2. Lexical-Only
- Time gap threshold (>30 minutes suggests new topic)
- Topic-shift markers: `/^actually,?\s*(let's|can we)/i`, `/^(new|different) (question|topic)/i`, etc.
- Continuation markers: `/^(yes|no|right|correct)/i`, `/^(the|your) (error|output|result)/i`, etc.
- File path overlap between assistant output and user input
- Keyword overlap (Jaccard coefficient)

### 3. Hybrid
- Weighted combination of embedding distance and lexical features
- Default weights: embedding (0.5), topic-shift (0.2), continuation (0.15), time-gap (0.05), paths (0.05), keywords (0.05)

## Model Comparison

All 4 registered embedding models were evaluated:

| Model | Dims | Embedding AUC | Hybrid AUC | Hybrid F1 |
|-------|------|--------------|------------|-----------|
| **nomic-v1.5** | 768 | 0.573 | **0.934** | 0.969 |
| jina-small | 512 | 0.536 | 0.933 | **0.981** |
| bge-small | 384 | 0.539 | 0.918 | 0.973 |
| jina-code | 768 | 0.542 | 0.874 | 0.901 |

**Lexical-only** achieves **0.999 AUC** across all configurations.

### Key Observations

1. **Embedding-only is barely above random** (~0.54 AUC vs 0.5 random baseline)
2. **Lexical features dominate** — near-perfect classification without embeddings
3. **Hybrid improves +0.37 AUC** on average over embedding-only
4. **nomic-v1.5 performs best** in hybrid mode despite similar embedding-only performance
5. **jina-code underperforms** despite being code-specialized

## Feature Ablation Study

Using nomic-v1.5 as the embedding baseline:

| Configuration | ROC AUC | Delta vs Embedding |
|---------------|---------|-------------------|
| All lexical features | 1.000 | +0.427 |
| **Time gap only** | **0.891** | **+0.319** |
| Embedding + time gap | 0.821 | +0.249 |
| Embedding + markers | 0.770 | +0.198 |
| All features (hybrid) | 0.934 | +0.362 |
| Shift markers only | 0.604 | +0.031 |
| Continuation markers only | 0.603 | +0.030 |
| Embedding only | 0.573 | baseline |
| Keyword overlap only | 0.541 | -0.032 |
| File path overlap only | 0.461 | -0.111 |

### Feature Importance Ranking

1. **Time gap** — Single most powerful signal (+0.319 AUC)
2. **Topic-shift markers** — Explicit signals like "new question", "actually, let's..." (+0.031)
3. **Continuation markers** — "yes", "the error", "thanks" (+0.030)
4. **Embedding distance** — Marginal contribution when combined with time gap
5. **Keyword overlap** — Slightly harmful alone (-0.032)
6. **File path overlap** — Harmful alone (-0.111), likely creates false positives

## Threshold Analysis

### Time Gap Threshold
The experiment used 30 minutes as the default time gap threshold. Results suggest this is reasonable:
- 66 transitions labeled as `new_topic` due to time gap
- Time gap alone achieves 0.891 AUC

### Classification Threshold
Optimal thresholds found via Youden's J statistic:

| Classifier | Optimal Threshold | Precision | Recall | F1 |
|------------|------------------|-----------|--------|-----|
| Lexical-only | 0.400 | 0.999 | 0.999 | 0.999 |
| Hybrid (nomic) | 0.606 | 0.973 | 0.965 | 0.969 |
| Embedding-only | 0.639 | 0.927 | 0.586 | 0.546 |

## Recommendations

### For Production Use

1. **Use lexical features as primary signal** — Time gap + explicit markers achieve near-perfect classification
2. **Time gap threshold of 30 minutes** is effective for coding sessions
3. **Embeddings provide minimal value** for this task but may help edge cases

### Recommended Configuration

```typescript
// Simple, effective approach
function isTopicContinuation(
  prevTurn: Turn,
  nextTurn: Turn,
  timeGapMs: number,
): boolean {
  const timeGapMinutes = timeGapMs / (1000 * 60);

  // Large time gap strongly suggests new topic
  if (timeGapMinutes > 30) return false;

  // Explicit topic-shift markers
  if (hasTopicShiftMarker(nextTurn.userText)) return false;

  // Explicit continuation markers
  if (hasContinuationMarker(nextTurn.userText)) return true;

  // References to files/tools from previous turn
  if (hasToolOrFileReference(nextTurn.userText)) return true;

  // Default: same-session adjacent turns continue
  return true;
}
```

### For Edge Detection in D-T-D

When creating edges in the Document-Turn-Document model:
- **Continuation** → Create causal edges from previous assistant chunks to user chunk
- **New topic** → No backward edges; user chunk starts a new subgraph

## Limitations

1. **Label leakage** — Labels derived from heuristics that classifiers also use
2. **Class imbalance** — 93% continuations may inflate metrics
3. **Domain-specific** — Results specific to Claude Code coding sessions
4. **No human labels** — Ground truth is heuristic-based, not human-annotated

## Future Work

1. **Human annotation** — Sample ~500 transitions for manual labeling to validate heuristics
2. **Cross-domain evaluation** — Test on non-coding conversations
3. **Finer-grained labels** — Distinguish "related but different subtask" from "completely new topic"
4. **Embedding fine-tuning** — Train embeddings specifically for topic continuity

## Reproduction

```bash
# Run experiment with default settings
npm run topic-continuity

# Run with more sessions
npm run topic-continuity -- --max-sessions 50

# Export labeled dataset only
npm run topic-continuity -- --export-only --output ./data
```

## Files

- `src/eval/experiments/topic-continuity/` — Experiment implementation
- `benchmark-results/topic-continuity-*.json` — Full results JSON
- `scripts/run-topic-continuity.ts` — CLI entry point
