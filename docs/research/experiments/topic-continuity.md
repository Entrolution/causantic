# Topic Continuity Experiments

This document details the experiments for detecting topic/session boundaries in Claude Code conversations.

## Hypothesis

Topic transitions in conversation sessions can be detected using lexical and structural features, enabling accurate D-T-D (Data-Transformation-Data) chunking.

## Methodology

### Dataset

- 75 Claude Code sessions
- 2,817 turn transitions analyzed
- Ground truth labels for topic boundaries

### Features

We evaluated multiple feature types for boundary detection:

| Feature Type | Description |
|--------------|-------------|
| Lexical overlap | Jaccard similarity of tokens |
| Reference continuity | Shared file paths mentioned |
| Turn length delta | Change in message length |
| Tool usage pattern | Same/different tools used |
| Time gap | Seconds between turns |

### Metrics

- **AUC-ROC**: Area under the ROC curve
- **Precision**: True boundary predictions / all boundary predictions
- **Recall**: True boundary predictions / all actual boundaries
- **F1**: Harmonic mean of precision and recall

## Results

### Feature Comparison

| Feature Set | AUC | Precision | Recall | F1 |
|-------------|-----|-----------|--------|-----|
| Lexical only | **0.998** | 0.95 | 0.94 | 0.945 |
| Reference only | 0.923 | 0.89 | 0.85 | 0.869 |
| Time gap only | 0.712 | 0.68 | 0.71 | 0.695 |
| Combined (all) | 0.997 | 0.96 | 0.93 | 0.945 |

**Winner**: Lexical features alone achieve near-perfect AUC (0.998).

### Threshold Analysis

Optimal Jaccard similarity threshold for boundary detection:

| Threshold | Precision | Recall | F1 |
|-----------|-----------|--------|-----|
| 0.1 | 0.78 | 0.98 | 0.869 |
| 0.2 | 0.89 | 0.95 | 0.919 |
| 0.3 | 0.95 | 0.94 | **0.945** |
| 0.4 | 0.97 | 0.89 | 0.928 |
| 0.5 | 0.98 | 0.82 | 0.893 |

**Optimal threshold**: 0.3 (F1=0.945)

## Analysis

### Why Lexical Features Work

Claude Code sessions have distinct lexical signatures:

1. **Topic starts**: New imports, new file paths, new terminology
2. **Topic continues**: Repeated variable names, function names, error messages
3. **Topic ends**: "done", "works", resolution language

### Transition Types

```
Continuation (low boundary score):
  Turn N:   "Fix the authentication bug in login.ts"
  Turn N+1: "The issue is on line 42 of login.ts..."
  Overlap: high (shared: authentication, login.ts, bug)

Boundary (high boundary score):
  Turn N:   "Great, the auth is working now."
  Turn N+1: "Now let's set up the database migrations."
  Overlap: low (no shared technical terms)
```

### Edge Cases

**False positives** (predicted boundary, actually continuation):
- Long explanations with new vocabulary
- Copy-pasted code blocks with different content
- Multi-step debugging with different error messages

**False negatives** (missed boundary):
- Quick topic switches within same file
- Related topics (e.g., auth → session management)

## Implementation

Causantic uses a simple lexical overlap check for chunking:

```typescript
function shouldChunk(prevTurn: Turn, currTurn: Turn): boolean {
  const prevTokens = new Set(tokenize(prevTurn.content));
  const currTokens = new Set(tokenize(currTurn.content));

  const intersection = [...currTokens].filter(t => prevTokens.has(t));
  const union = new Set([...prevTokens, ...currTokens]);

  const jaccard = intersection.length / union.size;

  // Low overlap = likely new topic
  return jaccard < 0.3;
}
```

### D-T-D Pattern

D-T-D (Data-Transformation-Data) abstractly represents any processing step as `f(input) → output`:

```
D = Data (input)
T = Transformation (any processing - Claude, human, tool)
D = Data (output)
```

This representation is useful for graph reasoning without getting into compositional semantics or type systems. Chunks are aligned to D-T-D boundaries for semantic coherence - each complete cycle represents one logical unit of work, regardless of what performed the transformation.

## Reproducibility

Run the topic continuity experiment:

```bash
npm run topic-continuity
```

Results are saved to `benchmark-results/topic-continuity/`.

## Key Insight

Simple lexical features outperform complex models because:

1. **Claude Code is task-focused**: Each topic has distinct vocabulary
2. **Sessions are structured**: Clear intent → analysis → action flow
3. **File context is explicit**: File paths provide strong signal

This finding simplified the chunking implementation significantly.
