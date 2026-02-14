# Future Work

Open questions and potential improvements for Causantic.

## Recently Implemented

These items were previously listed as future work and have since been implemented:

- **Chain Walking** (v0.3.0): Sequential linked-list edges walked by `chain-walker.ts` with cosine-similarity scoring. Replaces sum-product graph traversal. Provides episodic narrative ordering from search seeds.
- **Search Tool** (v0.3.0): `search` MCP tool for pure semantic discovery via hybrid BM25 + vector search with optional chain context. Replaces `explain`.
- **Edge Simplification** (v0.3.0): Sequential 1-to-1 edges replace m×n all-pairs topology. Removes `decay.ts`, `traverser.ts`, `pruner.ts`.
- **Web Dashboard** (Lower Priority → Done): React + Vite frontend with timeline visualization, cluster browser, search interface, and project views. Launch with `npx causantic dashboard`.
- **Per-Project Isolation** (Medium Priority → Done): Federated approach — all projects in one store, filtered at query time via `projectFilter`. Cross-project graph edges traversed freely.
- **Collection Benchmark Suite** (New): Self-service benchmarks for health, retrieval quality, chain quality, and latency. Scoring with tuning recommendations and historical tracking.
- **Session Reconstruction** (New): Pure chronological context rebuilding via `reconstruct` MCP tool — "what did I work on yesterday?"
- **Native HDBSCAN** (New): Pure TypeScript rewrite — 130× speedup over hdbscan-ts.
- **Hybrid BM25 + Vector Search** (New): FTS5 keyword search fused with vector search via RRF.

## High Priority

### Chain Walk Optimization

**Goal**: Improve chain walking performance and quality.

**Current State**: Chain walker follows sequential edges with cosine-similarity scoring. Depth limit of 50.

**Potential Improvements**:
1. Adaptive depth — stop walking when cosine similarity drops below threshold for N consecutive hops
2. Bidirectional walk merging — combine backward and forward walks more intelligently
3. Branch-aware walking — follow brief/debrief edges into sub-agent chains when relevant

### Relevance Feedback

**Goal**: Learn from user interactions to improve retrieval quality.

**Approach**:
- Track which retrieved chunks the user actually references in conversation
- Use implicit feedback (chunks that appear in subsequent tool calls) as positive signal
- Adjust chain walking scoring or seed selection based on feedback patterns

### Token Usage Analytics

**Goal**: Demonstrate cost savings from smarter context retrieval.

**Approach**:
- Track context window usage before/after memory augmentation
- Measure compression ratio (raw session tokens vs retrieved context)
- Dashboard showing memory efficiency metrics

**Implementation Ideas**:
- Hook into Claude Code's token reporting
- Log baseline vs augmented queries
- Calculate effective compression ratio

### Incremental Clustering

**Goal**: Update clusters without full re-run.

**Current State**: HDBSCAN runs on all embeddings daily.

**Challenge**: HDBSCAN is not inherently incremental.

**Potential Approaches**:
1. Approximate nearest cluster assignment for new points
2. Periodic full re-clustering with incremental updates between
3. Explore online clustering algorithms (DBSTREAM, DenStream)

## Medium Priority

### Multiple Embedding Models

**Goal**: Make embedding model configurable.

**Options**:
- jina-small (current default)
- jina-base (higher quality)
- Custom fine-tuned model

**Considerations**:
- Changing models requires re-embedding all chunks
- Model-specific clustering thresholds
- Storage for multiple embedding versions

### VSCode Extension

**Goal**: Direct integration without MCP.

**Features**:
- Inline memory suggestions
- Memory explorer panel
- Query interface in editor

## Lower Priority

### Team Sharing

**Goal**: Share memory across team members.

**Considerations**:
- Privacy (redact sensitive content)
- Encryption (secure transport)
- Conflict resolution (merge strategies)
- Access control (who can see what)

### Multi-Modal Memory

**Goal**: Handle images, diagrams, and other media.

**Challenges**:
- Embedding non-text content
- Storage format
- Retrieval across modalities

## Research Questions

### Optimal Chunk Size

**Question**: What's the ideal chunk size for retrieval?

**Current**: Code-aware chunking based on structure.

**To Explore**:
- Fixed token counts
- Semantic boundaries
- Adaptive sizing based on content

### Cross-Session Linking Quality

**Question**: How well do cross-session links work?

**Current**: Based on structural cross-session edges. The [collection benchmark suite](../guides/benchmarking.md) can now measure cross-session bridging quality — run `npx causantic benchmark-collection --full` to evaluate.

**To Measure**:
- Precision of cross-session edges
- User validation of suggested links
- A/B testing of linking strategies

### Decay Curve Generalization

**Question**: Do optimal decay curves vary by user/project?

**Current**: Fixed curves based on aggregate data.

**To Explore**:
- User-specific curve fitting
- Project-type differences (frontend vs backend)
- Adaptive decay based on retrieval feedback

## Community Contributions Welcome

If you're interested in working on any of these areas:

1. Open an issue to discuss the approach
2. Reference this document in your PR
3. Include benchmarks/experiments to validate changes

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for contribution guidelines.
