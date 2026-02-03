# Embedding Model Benchmark Results

> Evaluating embedding model candidates for Claude Code session memory

**Date**: 2026-02-03
**Status**: Benchmark Complete (two runs + follow-up experiments)

---

## Table of Contents

1. [Summary](#summary)
2. [Methodology](#methodology)
3. [Corpus](#corpus)
4. [Results](#results)
5. [Run 1 vs Run 2 Comparison](#run-1-vs-run-2-comparison)
6. [Model Analysis](#model-analysis)
7. [Cluster Quality](#cluster-quality)
8. [Context Window Impact](#context-window-impact)
9. [Follow-Up Experiments](#follow-up-experiments)
10. [Limitations and Caveats](#limitations-and-caveats)
11. [Recommendations](#recommendations)
12. [Next Steps](#next-steps)

---

## Summary

Four embedding models were benchmarked across two runs of increasing scale against real Claude Code session data:

- **Run 1**: 66 chunks, 93 pairs, 2 projects (speed-read, semansiation)
- **Run 2**: 294 chunks, 197 pairs, 5 projects (speed-read, semansiation, Ultan, cdx-core, apolitical-assistant)

**jina-small** (`Xenova/jina-embeddings-v2-small-en`) is the strongest model overall — it had the highest ROC AUC in both runs (0.794 → 0.715), the highest silhouette score in both runs (0.432 → 0.384), and found semantically coherent clusters across diverse project types. At 512ms/chunk it is 4-5x faster than the 768-dim models.

**bge-small** (`Xenova/bge-small-en-v1.5`) remains the fastest option (51ms/chunk) but its discrimination **dropped significantly** at scale (0.730 → 0.632), and its clustering is polluted by a "session continuation boilerplate" problem where truncated chunks that all start with "This session is being continued..." get falsely grouped.

**Recommendation**: **jina-small for production**. The 10x inference penalty over bge-small is acceptable (~2.5 minutes for a 294-chunk corpus), its discrimination holds up at scale, and its 8,192-token context avoids the truncation artifacts that hurt bge-small.

Follow-up experiments confirmed this choice and identified three actionable improvements: (1) removing thinking blocks before embedding improves ROC AUC by +0.063, (2) increasing `minClusterSize` from 3 to 4 improves silhouette from 0.384 to 0.438, and (3) stripping session-continuation boilerplate provides a small but consistent gain (+0.004 AUC, +0.011 silhouette). A same-model truncation test confirmed jina-small's 8K context is valuable: truncating to 512 tokens drops AUC by -0.044 and silhouette by -0.155.

---

## Methodology

### Test Harness

The benchmark harness consists of:

- **Session parser**: Streams Claude Code JSONL session files, assembles messages into conversational turns, then chunks turns into embeddable text with structure markers (`[User]`, `[Assistant]`, `[Tool:Read]`, `[Result]`)
- **Corpus builder**: Samples chunks uniformly across the code-ratio spectrum per session; sessions sorted by file size descending to prioritize the richest content
- **Auto-labeler**: Generates labeled pairs without manual annotation:
  - Same-session adjacent chunks → `related` (high confidence)
  - Same-project cross-session chunks → `related` (medium confidence)
  - Cross-project random pairings → `unrelated` (high confidence)
  - Adjacent code/NL chunk pairs → `code-nl-pair`
- **Evaluation suite**: ROC AUC, HDBSCAN clustering, silhouette score, code-NL alignment, per-chunk inference timing, memory profiling

### Metrics Definitions

| Metric | Description |
|--------|-------------|
| **ROC AUC** | Area under ROC curve. Related pairs scored by angular distance vs unrelated. Higher = better discrimination. |
| **Cluster count** | Number of clusters found by HDBSCAN (`minClusterSize=3`). |
| **Noise ratio** | Proportion of chunks HDBSCAN could not assign to any cluster. Lower = more structure found. |
| **Silhouette score** | Cluster cohesion vs separation, range [-1, 1]. Higher = tighter, better-separated clusters. |
| **Code-NL alignment** | Ratio of mean code-NL pair distance to mean random pair distance. Lower = better code/NL alignment. |
| **ms/chunk** | Mean inference time per chunk. |
| **Heap (MB)** | Heap memory delta after model load. |

### Distance Metric

All distance calculations use **angular distance**: `arccos(cosine_similarity) / pi`, yielding [0, 1]. This is a proper metric (satisfies triangle inequality). HDBSCAN runs on the raw normalized embeddings using Euclidean distance, which is monotonically related to angular distance for unit vectors: `||a - b||^2 = 2(1 - cos(a,b))`.

---

## Corpus

### Run 2 Sessions (expanded)

| Session | Project | Messages | Turns | Chunks | Sampled |
|---------|---------|----------|-------|--------|---------|
| wild-churning-stream | speed-read | 3,041 | 118 | 69 | 30 |
| wild-churning-stream | speed-read | 2,493 | 108 | 55 | 30 |
| wild-churning-stream | speed-read | 1,099 | 22 | 23 | 23 |
| curried-wishing-star | semansiation | 518 | 33 | 23 | 23 |
| curried-wishing-star | semansiation | 229 | 8 | 4 | 4 |
| magical-marinating-wolf | Ultan | 2,002 | 46 | 49 | 30 |
| magical-marinating-wolf | Ultan | 800 | 24 | 24 | 24 |
| shiny-sniffing-forest | cdx-core | 2,098 | 39 | 45 | 30 |
| shiny-sniffing-forest | cdx-core | 543 | 16 | 11 | 11 |
| snuggly-wandering-porcupine | apolitical-assistant | 2,036 | 42 | 58 | 30 |
| tingly-brewing-lantern | apolitical-assistant | 2,514 | 73 | 60 | 30 |
| encapsulated-noodling-valley | apolitical-assistant | 1,153 | 70 | 29 | 29 |

**Total**: 294 chunks from 12 sessions across 5 projects.

**Project diversity**:
- **speed-read**: TypeScript, EPUB/PDF reader web component (code-heavy)
- **semansiation**: Research/design for this project (conversational, NL-heavy)
- **Ultan**: Swift, bibliography management app (code-heavy, different language)
- **cdx-core**: TypeScript, document format tooling (mixed code/config)
- **apolitical-assistant**: TypeScript, engineering leadership tool (API integrations, conversational)

### Labeled Pairs

| Category | Run 1 | Run 2 |
|----------|-------|-------|
| Same-session adjacent (related) | 30 | 60 |
| Same-project cross-session (related) | 20 | 40 |
| Cross-project random (unrelated) | 40 | 80 |
| Code-NL pairs | 3 | 17 |
| **Total** | **93** | **197** |

Run 2's 17 code-NL pairs (vs 3 in Run 1) gives much better reliability for the alignment metric.

---

## Results

### Run 2 — Primary Results (294 chunks, 5 projects)

| Model | Dims | Context | ROC AUC | Clusters | Noise % | Silhouette | Code-NL | ms/chunk | Load (s) | Heap (MB) |
|-------|------|---------|---------|----------|---------|------------|---------|----------|----------|-----------|
| **jina-small** | 512 | 8,192 | **0.715** | 7 | 88.4% | **0.384** | 0.922 | 512 | 0.1 | ~0 |
| nomic-v1.5 | 768 | 8,192 | 0.683 | 2 | 95.9% | 0.310 | 0.974 | 2,083 | 0.3 | 19 |
| jina-code | 768 | 8,192 | 0.639 | **17** | **78.6%** | 0.327 | **0.863** | 2,356 | 0.4 | 30 |
| bge-small | 384 | 512 | 0.632 | 13 | 83.7% | 0.272 | 0.865 | **51** | 0.1 | ~0 |

### Run 1 — Initial Results (66 chunks, 2 projects)

| Model | Dims | Context | ROC AUC | Clusters | Noise % | Silhouette | Code-NL | ms/chunk |
|-------|------|---------|---------|----------|---------|------------|---------|----------|
| **jina-small** | 512 | 8,192 | **0.794** | 2 | 87.9% | **0.432** | 1.059 | 613 |
| bge-small | 384 | 512 | 0.730 | 4 | **75.8%** | 0.260 | **0.898** | **60** |
| jina-code | 768 | 8,192 | 0.721 | 4 | 80.3% | 0.383 | 0.954 | 2,670 |
| nomic-v1.5 | 768 | 8,192 | 0.605 | 3 | 84.8% | 0.381 | 1.088 | 2,261 |

---

## Run 1 vs Run 2 Comparison

The expanded corpus changed the picture materially:

| Model | ROC AUC (R1) | ROC AUC (R2) | Delta | Interpretation |
|-------|-------------|-------------|-------|----------------|
| jina-small | 0.794 | 0.715 | -0.079 | Moderate drop — still best. Expected regression with harder cross-project pairs. |
| bge-small | 0.730 | 0.632 | **-0.098** | Largest drop. Truncation hurts more with diverse projects. |
| jina-code | 0.721 | 0.639 | -0.082 | Similar drop to jina-small despite 8K context. |
| nomic-v1.5 | 0.605 | 0.683 | **+0.078** | Improved — more projects means more obviously-unrelated cross-project pairs, which nomic separates better than same-project related pairs. |

**Key takeaway**: All models' AUCs dropped when moving from 2 to 5 projects, which is expected — cross-project "unrelated" pairs from 5 diverse projects are a harder test than 2 similar TypeScript projects. The important signal is **relative ordering held**: jina-small remained on top. bge-small's steeper decline suggests its 512-token truncation loses discriminative information that matters more with project diversity.

### Clustering Scale-Up

| Model | Clusters (R1) | Clusters (R2) | Noise (R1) | Noise (R2) |
|-------|--------------|--------------|-----------|-----------|
| jina-code | 4 | 17 | 80.3% | 78.6% |
| bge-small | 4 | 13 | 75.8% | 83.7% |
| jina-small | 2 | 7 | 87.9% | 88.4% |
| nomic-v1.5 | 3 | 2 | 84.8% | 95.9% |

jina-code found the most clusters (17) with the lowest noise (78.6%) — its code specialization may help it differentiate tool-heavy conversations at scale. bge-small went from lowest noise to second-highest, confirming that truncation becomes more problematic with diverse content. nomic-v1.5 collapsed to just 2 clusters at 96% noise — essentially failing to find structure.

---

## Model Analysis

### jina-small — Recommended

**Strengths**:
- Highest ROC AUC in both runs (0.794 → 0.715) — best pair discrimination
- Highest silhouette in both runs (0.432 → 0.384) — tightest clusters
- 8,192-token context avoids truncation artifacts
- Fast load (<0.1s cached), negligible memory
- 512ms/chunk is ~4x faster than the 768-dim models

**Clustering at scale** (7 clusters, 34 chunks assigned):
- Cluster 0 (7 chunks): PR completions, CI passing, build summaries — cross-project "done" pattern
- Cluster 5 (4 chunks): Implementation summaries from Ultan (cdx-core) — build results
- Cluster 6 (3 chunks): Semansiation research doc-editing turns
- Cluster 1 (4 chunks): cdx-core PR merges and git operations
- Cluster 3 (6 chunks): Apolitical-assistant Humaans API integration turns
- Cluster 4 (7 chunks): Apolitical-assistant setup/config turns (MCP, OAuth, Slack)
- Cluster 2 (3 chunks): cdx-core session continuations + plan execution

**Assessment**: The clusters are semantically coherent and cross-project where appropriate (Cluster 0 groups "completion" turns from multiple projects). The conservative noise ratio (88.4%) means it doesn't force borderline chunks into clusters.

### bge-small — Fast but Limited

**Strengths**:
- 51ms/chunk — by far the fastest
- Good code-NL alignment (0.865)
- Most clusters found in Run 1 (4 clusters, 24.2% assigned)

**Weaknesses exposed at scale**:
- ROC AUC dropped most steeply (0.730 → 0.632) — worst discrimination at scale
- **Boilerplate clustering problem**: Cluster 3 groups 4 chunks that all begin with "This session is being continued from a previous conversation..." — the model can only see the first 512 tokens, and these session-continuation messages all start identically. The actual content after the boilerplate is truncated away.
- Cluster 2 groups commit-related turns ("commit these changes", "let's do a commit") — surface-level similarity rather than deep semantic grouping
- Cluster 7 groups plan execution starts ("Implement the following plan:") from different projects — same boilerplate, different meaning

**Assessment**: The 512-token truncation, which seemed acceptable at 2-project scale, creates systematic problems at 5-project scale. Boilerplate openings ("This session is being continued...", "Implement the following plan:") dominate the embedding when the distinctive content is truncated. Not recommended as primary model.

### jina-code — Surprising Cluster Density

**Run 2 changed the picture for jina-code**:
- Found 17 clusters (most of any model) with 78.6% noise (lowest)
- ROC AUC (0.639) is mediocre, but the clustering tells a different story
- Cluster composition is semantically rich:
  - Cluster 1 (6 chunks): speed-read codebase cleanup — plan, execution, commits, summary
  - Cluster 6 (4 chunks): Ultan implementation summaries
  - Cluster 12 (6 chunks): apolitical-assistant Humaans integration
  - Cluster 8 (4 chunks): apolitical-assistant setup/CI
  - Cluster 16 (4 chunks): semansiation doc-editing research

**Assessment**: jina-code's code specialization helps it differentiate tool-heavy conversations, which is why it found more clusters. But the ROC AUC is poor because it struggles with the related/unrelated distinction when cross-project pairs share code patterns. The 2.4s/chunk inference makes it impractical for production.

### nomic-v1.5 — Not Suited

- ROC AUC improved at scale (0.605 → 0.683) but still weakest
- Collapsed to 2 clusters with 96% noise — failed to find meaningful structure
- Cluster 0 (9 chunks) is a grab-bag of "completion summary" turns — less coherent than other models
- 2s/chunk inference, 19MB heap

**Assessment**: The task-prefix design (`search_document:`, `search_query:`) is optimized for asymmetric retrieval, not the symmetric document-document similarity we need. Not recommended.

---

## Cluster Quality

### Cross-Model Consensus

Some groupings recur across 3+ models, suggesting genuine semantic structure:

1. **"Work complete" summaries**: PR merges, test passes, build confirmations cluster together in jina-small, jina-code, and nomic. These share a common pattern: enumeration of what was done, status indicators, git operations.

2. **"Add to doc" turns**: Semansiation research turns where the user dictates ideas to add to the feasibility study. Clustered in jina-small, jina-code, and bge-small.

3. **API integration turns**: Apolitical-assistant Humaans API work clusters in jina-small (Cluster 3), jina-code (Cluster 12), and bge-small (Cluster 8).

4. **Session continuations**: The "This session is being continued..." boilerplate consistently groups in bge-small (where it's a truncation artifact) and sometimes in jina-code (where it co-occurs with other structural similarity). jina-small does not cluster these together, which is correct behavior — it sees past the boilerplate to the actual content.

### Cluster Size Distribution (Run 2)

| Model | Clusters | Sizes | Total clustered | % clustered |
|-------|----------|-------|-----------------|-------------|
| jina-code | 17 | 6,6,4,4,4,4,4,4,3,3,3,3,3,3,3,3,3 | 63 | 21.4% |
| bge-small | 13 | 6,4,4,4,4,4,4,3,3,3,3,3,3 | 48 | 16.3% |
| jina-small | 7 | 7,7,6,4,4,3,3 | 34 | 11.6% |
| nomic-v1.5 | 2 | 9,3 | 12 | 4.1% |

jina-code finds the most structure, but jina-small's fewer clusters are individually more coherent (higher silhouette).

---

## Context Window Impact

### Cross-Model Drift (Run 2)

| Chunk type | Count | Mean drift |
|------------|-------|------------|
| Long (>512 tokens) | 288 | 0.491 |
| Short (≤512 tokens) | 6 | 0.497 |

98% of chunks exceed 512 tokens. The drift metric compares bge-small vs nomic-v1.5 embeddings, which inhabit different spaces, so the ~0.49 values reflect architectural differences rather than truncation impact.

### Practical Evidence of Truncation Impact

More informative than the drift metric is the behavioral difference between runs:

- bge-small's ROC AUC dropped **0.098** (Run 1 → Run 2), the steepest decline
- bge-small clusters session-continuation boilerplate together — a truncation artifact
- bge-small clusters "commit these changes" turns together regardless of what's being committed

These are symptoms of losing tail content: when the model can only see the first ~512 tokens, the user's opening message and any boilerplate dominate the embedding. With 2 projects this was tolerable; with 5 diverse projects it creates false groupings.

jina-small sees the full context and correctly separates these cases.

---

## Follow-Up Experiments

Five targeted experiments were run on jina-small to validate the production recommendation and quantify the impact of chunking parameters. All experiments reuse the existing 294-chunk corpus.

### Summary Table

| Experiment | Baseline AUC | Variant AUC | dAUC | Baseline Silh. | Variant Silh. | dSilh. |
|------------|-------------|-------------|------|----------------|---------------|--------|
| Truncation (512 tokens) | 0.715 | 0.671 | **-0.044** | 0.384 | 0.229 | **-0.155** |
| Boilerplate filter | 0.715 | 0.720 | +0.004 | 0.384 | 0.395 | +0.011 |
| Thinking ablation | 0.715 | 0.778 | **+0.063** | 0.384 | 0.376 | -0.009 |
| Code-focused mode | 0.715 | 0.761 | +0.045 | 0.384 | 0.356 | -0.028 |

### Experiment 1: Same-Model Truncation Test

**Question**: How much does jina-small's 8K context actually help vs 512-token truncation?

Hard-truncated all chunk text to ~512 tokens (1,792 characters) before embedding. 288 of 294 chunks (98%) were affected.

**Result**: Truncation drops ROC AUC by -0.044 and silhouette by -0.155. This is a much more informative test than the cross-model drift comparison (bge-small vs nomic-v1.5) reported in the initial benchmark, because it isolates the truncation effect from architecture differences. The 8K context window is clearly earning its keep — the tail content of chunks carries significant discriminative information.

### Experiment 2: HDBSCAN minClusterSize Sweep

**Question**: Is `minClusterSize=3` optimal, or are we leaving structure on the table?

Swept `minClusterSize` from 2 to 10, re-clustering the same jina-small embeddings each time.

| minClusterSize | Clusters | Noise % | Silhouette |
|---------------|----------|---------|------------|
| 2 | 22 | 78.9% | 0.283 |
| 3 | 7 | 88.4% | 0.384 |
| **4** | **6** | **89.8%** | **0.438** |
| 5 | 5 | 87.8% | 0.380 |
| 6 | 6 | 86.1% | 0.373 |
| 7 | 5 | 85.4% | 0.336 |
| 8 | 4 | 88.8% | 0.381 |
| 9 | 3 | 89.1% | 0.356 |
| 10 | 3 | 87.8% | 0.286 |

**Result**: `minClusterSize=4` produces the best silhouette (0.438, up from 0.384 at 3), with 6 clusters instead of 7. The value of 2 produces 22 fragmented clusters with poor cohesion. Values above 5 start losing structure. **Recommendation: use `minClusterSize=4` in production.**

### Experiment 3: Boilerplate Filtering

**Question**: Does stripping "This session is being continued..." boilerplate improve discrimination?

Stripped 5 known boilerplate patterns from chunk text before embedding. 28 of 294 chunks (9.5%) contained boilerplate.

**Result**: Small but consistent improvement: +0.004 ROC AUC, +0.011 silhouette. The effect is modest because jina-small's 8K context already sees past the boilerplate to the distinctive content — unlike bge-small, where boilerplate dominates the truncated embedding. Still worth doing in production as a low-cost preprocessing step.

### Experiment 4: Thinking Block Ablation

**Question**: Do thinking blocks help or hurt embedding quality?

Rebuilt the corpus with `includeThinking=false`, re-generated labeled pairs, and re-embedded. The variant corpus had 279 chunks (vs 294) because removing thinking blocks changes chunk boundaries.

**Result**: Removing thinking blocks produced the largest ROC AUC improvement of any experiment: **+0.063** (0.715 → 0.778). Silhouette was essentially unchanged (-0.009). Thinking blocks appear to add noise to embeddings — they contain model reasoning that is semantically diffuse (planning, self-correction, uncertainty) and dilutes the signal from the actual user request and assistant response. **Recommendation: exclude thinking blocks from chunk text before embedding.**

### Experiment 5: Code-Focused Render Mode

**Question**: Does stripping NL commentary and keeping only code-related content help?

Rebuilt the corpus with `renderMode='code-focused'` (only includes Bash, Read, Write, Edit, Grep, Glob tool results; skips non-code tools). Variant corpus: 292 chunks.

**Result**: Improved ROC AUC by +0.045 (0.715 → 0.761) but reduced silhouette by -0.028 (0.384 → 0.356). Stripping NL commentary helps pair discrimination — code patterns are more distinctive than conversational text — but hurts clustering because NL context helps group topically-related chunks. **Recommendation: use `renderMode='full'` for clustering use cases, but consider `'code-focused'` if the primary task is retrieval/similarity search.**

### Experiment Conclusions

The three highest-impact findings for production:

1. **Exclude thinking blocks** (+0.063 AUC) — biggest single improvement
2. **Use `minClusterSize=4`** (+0.054 silhouette) — free improvement, no re-embedding needed
3. **Keep full 8K context** — truncation is costly (-0.044 AUC, -0.155 silhouette)

Boilerplate filtering and code-focused mode are smaller, situational improvements.

---

## Limitations and Caveats

### Auto-Labeled Pairs

The labeled pairs are heuristic, not human-validated:
- "Adjacent chunks are related" assumes topical continuity, which may not hold across topic switches
- "Cross-project chunks are unrelated" may miss genuinely similar patterns (e.g., git operations, session boilerplate appear across all projects)
- 17 code-NL pairs in Run 2 is better but still modest

### Token Counting

Approximate token counting (~3.5 chars/token) was used for chunking and context window analysis. Actual tokenizer-specific counts may differ by 10-20%.

### Single Configuration

~~Only `minClusterSize=3` was tested. Different values would produce different noise ratios and cluster counts.~~ **Resolved**: Experiment 2 swept `minClusterSize` from 2 to 10. The optimal value is 4 (silhouette 0.438). The high noise ratios (~88-90%) persist across all reasonable settings and reflect the genuine lack of strong cluster structure in diverse session data rather than a configuration issue.

### No Variance Estimation

Model inference is deterministic but HDBSCAN stability with borderline points was not measured across multiple runs.

### Cross-Model Context Window Test

~~The drift comparison between bge-small and nomic-v1.5 cannot isolate truncation effects from architecture differences. A same-model truncation test would be more informative.~~ **Resolved**: Experiment 1 ran jina-small with vs without 512-token truncation. Full context provides -0.044 AUC and -0.155 silhouette advantage — the 8K context window is clearly valuable.

---

## Recommendations

### Primary: jina-small

**Rationale**:
- Highest ROC AUC across both corpus sizes — discrimination scales with project diversity
- Highest silhouette — produces the most coherent clusters
- 8,192-token context avoids the boilerplate-clustering problem that plagues bge-small
- 512ms/chunk is practical for SessionEnd processing (~2.5 min for a 294-chunk corpus)
- Negligible memory footprint, fast model load
- Confirmed ONNX availability via Xenova
- 512 dimensions is a good balance: compact enough for LanceDB storage, rich enough for semantic nuance

**Recommended preprocessing** (from follow-up experiments):
- Exclude thinking blocks from chunk text before embedding (`includeThinking: false`) — +0.063 AUC
- Strip session-continuation boilerplate — small but consistent improvement
- Use `minClusterSize=4` for HDBSCAN — +0.054 silhouette over default of 3
- Keep `renderMode: 'full'` for clustering; consider `'code-focused'` for retrieval

**Production integration path**:
- SessionEnd hook: Parse + chunk + embed the session (~30 chunks → ~15s)
- Batch reprocessing: Viable at 512ms/chunk for the full corpus
- Storage: 512 dims × 4 bytes = 2KB per chunk in LanceDB

### When to Consider Alternatives

**bge-small** — if inference latency is critical (real-time retrieval at query time):
- Use as a fast first-pass ranker, with jina-small for re-ranking
- Only viable if chunks are pre-truncated to remove session-continuation boilerplate

**jina-code** — if cluster density matters more than discrimination:
- Found 17 clusters vs jina-small's 7; may be useful if downstream tasks need fine-grained groupings
- Not recommended as primary due to 2.4s/chunk inference and 30MB heap

### Not Recommended

- **nomic-v1.5**: Poor discrimination, near-total clustering failure at scale (96% noise), mandatory task prefixes

---

## Next Steps

1. ~~Validate on larger corpus~~ — Done (Run 2: 294 chunks, 5 projects)
2. ~~Same-model truncation test~~ — Done (Experiment 1: -0.044 AUC, -0.155 silhouette with truncation)
3. ~~Tune HDBSCAN~~ — Done (Experiment 2: optimal `minClusterSize=4`, silhouette 0.438)
4. **Human validation**: Manually inspect 20-30 pairs to calibrate auto-labeler accuracy
5. ~~Boilerplate filtering~~ — Done (Experiment 3: +0.004 AUC, +0.011 silhouette)
6. **Integration prototype**: Wire jina-small into a SessionEnd hook prototype and measure end-to-end latency
7. **Apply experiment findings**: Update default chunker config to exclude thinking blocks and strip boilerplate; set `minClusterSize=4`
8. **Matryoshka test**: Try nomic-v1.5 at reduced dimensions (384/256) — low priority given overall poor performance

---

## Raw Data

| Run | Corpus | JSON |
|-----|--------|------|
| Run 1 | 66 chunks, 2 projects | [`benchmark-2026-02-03T14-56-58-170Z.json`](../benchmark-results/benchmark-2026-02-03T14-56-58-170Z.json) |
| Run 2 | 294 chunks, 5 projects | [`benchmark-2026-02-03T16-06-13-827Z.json`](../benchmark-results/benchmark-2026-02-03T16-06-13-827Z.json) |
| Experiments | 5 follow-up experiments on jina-small | [`experiments-2026-02-03T22-05-59-321Z.json`](../benchmark-results/experiments-2026-02-03T22-05-59-321Z.json) |

### Reproduction

```bash
# Build corpus from local sessions (5 projects, ~12 sessions)
npm run build-corpus

# Run full benchmark (downloads models on first run, ~1GB+)
npm run benchmark

# Run subset of models
npx tsx scripts/run-benchmark.ts --models bge-small,jina-small

# Run follow-up experiments (jina-small only)
npm run experiments

# Run specific experiments (e.g. truncation + HDBSCAN sweep only)
npx tsx scripts/run-experiments.ts --experiments 1,2
```
