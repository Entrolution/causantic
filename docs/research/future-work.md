# Future Work

Open questions and potential improvements for Causantic.

## High Priority

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

### Per-Project Isolation

**Goal**: Separate memory per project.

**Current State**: All projects share one memory store.

**Options**:
1. **Isolated**: Completely separate databases per project
2. **Hybrid**: Project-local chunks, global clusters for topic discovery
3. **Federated**: Query across projects with project-aware ranking

### VSCode Extension

**Goal**: Direct integration without MCP.

**Features**:
- Inline memory suggestions
- Memory explorer panel
- Query interface in editor

## Lower Priority

### Web Dashboard

**Goal**: Visualize graph structure and cluster topics.

**Features**:
- Interactive graph visualization
- Cluster browser with member lists
- Query testing interface
- Maintenance task status

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

**Current**: Based on file-path and topic similarity.

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
