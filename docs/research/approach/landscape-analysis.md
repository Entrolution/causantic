# Landscape Analysis

How Causantic compares to existing AI memory systems, and why it takes a different approach.

## Competitor Feature Matrix

| System | Local-First | Temporal Decay | Graph Structure | Self-Benchmarking | Hop-Based Distance |
|--------|:-----------:|:--------------:|:--------------:|:-----------------:|:------------------:|
| **Causantic** | **Yes** | **Hop-based** | **9-type causal** | **Yes** | **Yes** |
| Mem0 | No (Cloud) | None | Paid add-on | No | No |
| Cognee | Self-hostable | None | Triplet extraction | No | No |
| Letta/MemGPT | Self-hostable | Summarization | None | No | No |
| Zep | Enterprise | Bi-temporal | Temporal KG | No | No |
| Supermemory | Cloudflare | Dual timestamps | Secondary | No | No |
| A-MEM | Research only | None | Zettelkasten | No | No |
| GraphRAG | Self-hostable | Static corpus | Hierarchical | No | No |

## System Summaries

### Mem0

Cloud API with two-phase extraction/update pipeline. LLM extracts facts, then decides ADD/UPDATE/DELETE/NOOP against existing memories. Triple-store hybrid (Vector + Graph + KV). Graph memory is a paid add-on. No temporal decay — memories mutated in place. 66.9% on LOCOMO benchmark.

### Cognee

ECL pipeline (Extract-Cognify-Load) with LLM-based triplet extraction. 12 search modes including graph completion and Cypher queries. Incremental loading (unlike GraphRAG). 100% LLM-dependent — no traditional NLP fallback. Scalability issues (1GB takes ~40 min). 92.5% accuracy.

### Letta/MemGPT

OS-inspired virtual memory with Main Context (RAM) and External Context (Disk). Agent manages its own memory via tool calls. Recursive summarization is lossy. No graph structure. 93.4% on Deep Memory Retrieval.

### Zep

Temporal Knowledge Graph via Graphiti engine with bi-temporal model. Best-in-class temporal reasoning among production systems. Enterprise/cloud-focused with higher latency (1.29s p50). 94.8% on DMR — highest among production systems.

### A-MEM (NeurIPS 2025)

Zettelkasten-inspired agentic memory with bidirectional linking. Only system with true associative memory evolution. Doubles performance on multi-hop reasoning. Research paper, not production-ready.

## Gap Analysis

| Gap | Current Landscape | Causantic's Approach |
|-----|-------------------|---------------------|
| **Local-first + sophisticated** | Cloud systems are sophisticated; local systems are simplistic | Full causal graph + clustering + hybrid search, all on your machine |
| **Hop-based decay** | Wall-clock time or none | Logical D-T-D hops preserve cross-session continuity |
| **Direction-specific retrieval** | Symmetric or none | Backward (dies@10 hops) vs forward (delayed, dies@20 hops) |
| **Self-benchmarking** | No system measures its own retrieval quality | Built-in benchmark suite with tuning recommendations |
| **Claude Code native** | General-purpose or platform-agnostic | Purpose-built hooks, MCP tools, and CLAUDE.md generation |

## Key Differentiator

Most memory systems optimize for *storing* memories. Causantic optimizes for *retrieving the right context at the right time* — using causal graphs, hop-based decay, and hybrid BM25+vector search to surface 4.65x more relevant context than vector search alone.

*Condensed from the [full feasibility study](../archive/feasibility-study.md). See the archive for detailed per-system analysis including architecture diagrams and benchmark methodology.*
