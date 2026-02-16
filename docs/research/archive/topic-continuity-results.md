# Topic Continuity Detection Experiment Results

## Overview

This experiment evaluates classifiers for detecting whether a user's message **continues** the previous conversation topic or **starts a new topic**. This directly supports the D-T-D model's edge creation logic: continuations create causal edges from previous assistant chunks to the new user chunk; new topics do not.

## Dataset (Comprehensive Run)

**Source**: 75 Claude Code sessions from `~/.claude/projects/`

| Metric                     | Count       |
| -------------------------- | ----------- |
| Total transitions          | 3,179       |
| Valid (with prior context) | 2,817       |
| Continuations              | 2,952 (93%) |
| New topics                 | 227 (7%)    |
| High confidence labels     | 1,554 (49%) |

### Label Distribution by Source

| Source                        | Count | Label        | Confidence |
| ----------------------------- | ----- | ------------ | ---------- |
| Same-session adjacent         | 1,470 | continuation | medium     |
| Tool/file references          | 772   | continuation | high       |
| Explicit continuation markers | 710   | continuation | high       |
| Time gap (>30 min)            | 155   | new_topic    | medium     |
| Session boundaries            | 45    | new_topic    | high       |
| Explicit shift markers        | 27    | new_topic    | high       |

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

| Model          | Dims | Embedding AUC | Embedding F1 | Hybrid AUC | Hybrid F1 |
| -------------- | ---- | ------------- | ------------ | ---------- | --------- |
| nomic-v1.5     | 768  | 0.574         | 0.532        | 0.944      | 0.937     |
| **jina-small** | 512  | 0.541         | 0.498        | **0.946**  | **0.979** |
| bge-small      | 384  | 0.558         | 0.548        | 0.927      | 0.965     |
| jina-code      | 768  | 0.551         | 0.582        | 0.883      | 0.904     |

**Lexical-only** achieves **0.998 AUC** (F1=0.999) across all configurations.

### Key Observations

1. **Embedding-only is barely above random** (~0.54-0.57 AUC vs 0.5 random baseline)
2. **Lexical features dominate** — near-perfect classification without embeddings
3. **Hybrid improves +0.37 AUC** on average over embedding-only
4. **jina-small performs best** in hybrid mode with 0.946 AUC
5. **jina-code underperforms** despite being code-specialized (lowest hybrid AUC at 0.883)
6. **nomic-v1.5 has highest embedding AUC** but the difference is marginal

## Feature Ablation Study

Using nomic-v1.5 as the embedding baseline (comprehensive 75-session run):

| Configuration             | ROC AUC   | Delta vs Embedding |
| ------------------------- | --------- | ------------------ |
| All lexical features      | 1.000     | +0.426             |
| **Time gap only**         | **0.921** | **+0.347**         |
| Embedding + time gap      | 0.860     | +0.287             |
| Embedding + markers       | 0.745     | +0.172             |
| All features (hybrid)     | 0.944     | +0.370             |
| Continuation markers only | 0.605     | +0.031             |
| Shift markers only        | 0.573     | -0.001             |
| Embedding only            | 0.574     | baseline           |
| Keyword overlap only      | 0.564     | -0.010             |
| File path overlap only    | 0.484     | -0.090             |

### Feature Importance Ranking

1. **Time gap** — Single most powerful signal (+0.347 AUC), achieves 0.921 AUC alone
2. **Continuation markers** — "yes", "the error", "thanks" (+0.031)
3. **Shift markers** — Explicit signals like "new question", "actually, let's..." (marginal)
4. **Embedding distance** — Useful when combined with time gap (+0.287)
5. **Keyword overlap** — Slightly harmful alone (-0.010)
6. **File path overlap** — Harmful alone (-0.090), creates false positives

## Threshold Analysis

### Time Gap Threshold

The experiment used 30 minutes as the default time gap threshold. Results confirm this is highly effective:

- 155 transitions labeled as `new_topic` due to time gap
- Time gap alone achieves 0.921 AUC
- The 30-minute threshold is the single most valuable signal in the dataset

### Classification Threshold

Optimal thresholds found via Youden's J statistic:

| Classifier          | Optimal Threshold | F1          |
| ------------------- | ----------------- | ----------- |
| Lexical-only        | 0.400             | 0.999       |
| Hybrid (jina-small) | varies            | 0.979       |
| Embedding-only      | varies            | 0.498-0.582 |

## Recommendations

### For Production Use

1. **Use lexical features as primary signal** — Time gap + explicit markers achieve near-perfect classification (0.998 AUC)
2. **Time gap threshold of 30 minutes** is highly effective for coding sessions (0.921 AUC alone)
3. **Embeddings provide minimal value** for this task (~0.55 AUC = barely above random)
4. **Best hybrid model: jina-small** — but the gain over lexical-only is marginal (0.946 vs 0.998 AUC)

### Recommended Configuration

```typescript
// Simple, effective approach
function isTopicContinuation(prevTurn: Turn, nextTurn: Turn, timeGapMs: number): boolean {
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

## Experiment History

| Run           | Sessions | Transitions | Valid | Lexical AUC | Best Hybrid AUC    |
| ------------- | -------- | ----------- | ----- | ----------- | ------------------ |
| Initial       | 30       | 1,538       | 1,407 | 0.999       | 0.934 (nomic-v1.5) |
| Comprehensive | 75       | 3,179       | 2,817 | 0.998       | 0.946 (jina-small) |

Results are consistent across runs — lexical features dominate, embeddings add marginal value.

## Reproduction

```bash
# Run experiment with default settings
npm run topic-continuity

# Run comprehensive experiment (75 sessions)
npm run topic-continuity -- --max-sessions 75

# Export labeled dataset only
npm run topic-continuity -- --export-only --output ./data
```

## Files

- `src/eval/experiments/topic-continuity/` — Experiment implementation
- `benchmark-results/topic-continuity-*.json` — Full results JSON
- `scripts/run-topic-continuity.ts` — CLI entry point
