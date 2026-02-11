# Semansiation: Feasibility Study

> Semantic Associative Memory for Claude Code Sessions

**Date**: 2026-02-02
**Status**: Research Complete

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Project Vision](#project-vision)
3. [Claude Code Integration Points](#claude-code-integration-points)
4. [Existing Landscape Analysis](#existing-landscape-analysis)
5. [Memory System Flow Patterns](#memory-system-flow-patterns)
6. [Prior Art: sbxmlpoc PoC](#prior-art-sbxmlpoc-poc)
7. [Causal Graph Formalism](#causal-graph-formalism)
8. [Cluster Representation Problem](#cluster-representation-problem)
9. [Chunk Assignment Model](#chunk-assignment-model)
10. [Technical Components](#technical-components)
11. [Architecture Recommendation](#architecture-recommendation)
12. [Differentiation Strategy](#differentiation-strategy)
13. [Implementation Roadmap](#implementation-roadmap)
14. [Open Questions](#open-questions)
15. [References](#references)

---

## Executive Summary

This feasibility study evaluates building a **semantic associative memory system** for Claude Code sessions. The system would:

- Parse and analyze Claude Code conversation sessions
- Generate semantic embeddings for conversation chunks
- Store embeddings in a local vector store
- Build an associative graph where nodes are semantic blocks and edges represent co-occurrence
- Implement cluster detection for "0th order" associations
- Apply temporal decay (short-term → long-term memory model)
- Strengthen cross-cluster edges when embeddings from distinct clusters appear together

**Verdict**: Highly feasible. All required components exist as mature, embeddable libraries. No existing system combines temporal dynamics + associative graphs + local-first + Claude Code integration.

---

## Project Vision

### Core Concept

```
Session → Chunks → Embeddings → Vector Store
                              ↘
                         Associative Graph
                              ↙
                    Clusters ← Temporal Decay
                              ↘
                         Edge Reinforcement
```

### Key Properties

| Property | Description |
|----------|-------------|
| **Local-first** | Runs entirely on developer's machine, no cloud dependency |
| **Privacy-preserving** | Optional hashing/encryption of content |
| **Temporal dynamics** | Memories decay over time, strengthen with use |
| **Associative** | Concepts link organically based on co-occurrence |
| **Claude Code native** | Purpose-built for coding assistant sessions |

---

## Claude Code Integration Points

### Session Data Access

Sessions are stored locally and fully accessible:

| Data | Location | Format |
|------|----------|--------|
| Transcripts | `~/.claude/projects/<path>/<session-id>.jsonl` | JSON Lines |
| Session index | `~/.claude/projects/<path>/sessions-index.json` | JSON |
| Global history | `~/.claude/history.jsonl` | JSON Lines |

#### JSONL Message Structure

Each line contains:
- `type`: Message type (user, assistant, file-history-snapshot, etc.)
- `message`: Content with `role` and `content` fields
- `uuid`: Unique message identifier
- `timestamp`: Unix timestamp
- `sessionId`: Session identifier
- `cwd`: Working directory
- Tool call metadata, thinking metadata, etc.

### Hook System

Hooks provide lifecycle integration points:

| Hook | Trigger | Use Case |
|------|---------|----------|
| `SessionStart` | Session begins/resumes | Load relevant memories into context |
| `SessionEnd` | Session terminates | Trigger embedding + graph update |
| `PostToolUse` | After tool execution | Capture context around actions |
| `PreCompact` | Before context compaction | Save important context before loss |

Hook configuration in `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "semansiation index --session $CLAUDE_SESSION_ID"
          }
        ]
      }
    ]
  }
}
```

Hooks receive JSON on stdin with full context including `session_id`, `transcript_path`, `cwd`, etc.

### MCP Server Integration

Build a custom MCP server to expose semantic search as a tool:

```bash
claude mcp add --transport stdio semansiation ./semansiation-mcp
```

This allows Claude to query the memory graph during conversations.

### Environment Variables

Available in hooks:
- `$CLAUDE_SESSION_ID` - Current session identifier
- `$CLAUDE_PROJECT_DIR` - Project directory path

---

## Existing Landscape Analysis

### Competitor Feature Matrix

| System | Local-First | Temporal Decay | Associative Graph | Memory Evolution | Accuracy |
|--------|-------------|----------------|-------------------|------------------|----------|
| **Mem0** | No (Cloud API) | No versioning | Paid add-on | Mutations only | 66.9% |
| **Cognee** | Self-hostable | None | Triplet extraction | Incremental only | 92.5% |
| **Letta/MemGPT** | Self-hostable | Summarization loss | None | FIFO eviction | 93.4% |
| **Zep** | Enterprise cloud | Bi-temporal | Temporal KG | Episode-based | 94.8% |
| **Supermemory** | Cloudflare | Dual timestamps | Secondary | Unknown | 76.7% |
| **A-MEM** | Research only | None | Zettelkasten | Cross-updates | 2x baseline |
| **GraphRAG** | Self-hostable | Static corpus | Hierarchical | Full rebuilds | N/A |

### Detailed System Analysis

#### Mem0

**Architecture**: Two-phase extraction/update pipeline
- Phase 1: LLM extracts facts from message pairs with rolling summary context
- Phase 2: For each fact, retrieves top 10 similar memories, LLM decides ADD/UPDATE/DELETE/NOOP

**Storage**: Triple-store hybrid (Vector + Graph + Key-Value)
- Vector: Qdrant, Pinecone, Chroma, etc.
- Graph: Neo4j, Memgraph (Mem0g variant, paid)
- KV: SQLite for audit trails

**Limitations**:
- No true temporal decay - memories mutated in place, no versioning
- Graph memory is paid add-on
- Missing batch operations (100 memories = 100 API calls)
- Cloud-centric architecture

**Benchmark**: 66.88% on LOCOMO, 26% improvement over OpenAI Memory

#### Cognee

**Architecture**: ECL pipeline (Extract-Cognify-Load)
1. Document classification
2. Permission validation
3. Chunking (200-2000 tokens)
4. LLM-based graph extraction (triplets)
5. Text summarization
6. Embedding generation

**Unique Features**:
- 12 search modes (GRAPH_COMPLETION, RAG_COMPLETION, CYPHER, etc.)
- Incremental loading (unlike GraphRAG which requires full rebuilds)
- Memify Pipeline for post-processing enrichment

**Limitations**:
- 100% LLM-dependent extraction (no traditional NLP fallback)
- Scalability issues (1GB takes ~40 minutes)
- Auto-generated ontologies only in commercial version
- Kuzu backend doesn't support multi-agent concurrency

**Benchmark**: 92.5% accuracy vs 60% for traditional RAG

#### Letta/MemGPT

**Architecture**: OS-inspired virtual memory
- Main Context (RAM): System instructions + Core Memory blocks + Conversation history
- External Context (Disk): Recall Memory + Archival Memory (vector DB)

**Unique Features**:
- Self-editing memory via tool calls (agent manages its own memory)
- Heartbeat mechanism for multi-step reasoning
- Core Memory blocks pinned to context window

**Limitations**:
- Recursive summarization is lossy (leads to memory holes)
- No explicit temporal decay
- No graph structure
- Only works with reliable tool-calling models

**Benchmark**: 93.4% on Deep Memory Retrieval (GPT-4-turbo)

#### Zep

**Architecture**: Temporal Knowledge Graph via Graphiti engine
- Bi-temporal model: Timeline T (event order) + Timeline T' (ingestion order)
- Episode-based data ingestion
- Mirrors human cognition: episodic + semantic memory

**Unique Features**:
- Best-in-class temporal reasoning
- Multiple reranking strategies (RRF, MMR, graph-based)
- AWS Neptune integration for enterprise

**Limitations**:
- Enterprise/cloud-focused, not local-first
- Requires infrastructure setup (graph DB, text search)
- Higher latency than Mem0 (1.29s vs 0.148s p50)

**Benchmark**: 94.8% on DMR (highest among production systems)

#### Supermemory

**Architecture**: Brain-inspired multi-layer
- Hot/recent data in Cloudflare KV
- Deeper memories retrieved on demand
- Dual-layer timestamping: `documentDate` vs `eventDate`

**Limitations**:
- Cloud-dependent (Cloudflare infrastructure)
- No explicit local-first mode
- Associative structures secondary to semantic search

**Benchmark**: 76.69% on LongMemEval temporal reasoning

#### A-MEM (Research - NeurIPS 2025)

**Architecture**: Zettelkasten-inspired agentic memory
- Interconnected knowledge networks through dynamic indexing
- Memory evolution: new memories trigger updates to existing memories
- Bidirectional linking between related concepts

**Unique Features**:
- Only system with true associative memory evolution
- Doubles performance on complex multi-hop reasoning
- Runs on Llama 3.2 1B on single GPU

**Limitations**:
- Research paper, not production-ready
- Not local-first focused
- No temporal decay

### Gap Analysis

| Gap | Current State | Opportunity |
|-----|---------------|-------------|
| **Temporal decay** | Only MemOS (research) implements Ebbinghaus-style decay | First production system with biologically-inspired decay |
| **Local-first** | Most require cloud; local options are simplistic | Sophisticated memory on developer's machine |
| **Associative evolution** | Only A-MEM (research) | Productionize for conversations |
| **Claude Code native** | No one targets this | Purpose-built integration |
| **Memory portability** | Platform-specific, no transfer | Export/import memory graphs |

---

## Memory System Flow Patterns

Understanding how existing memory systems operate helps clarify where Semansiation can differentiate.

### Pattern 1: Synchronous Query-Time Retrieval

**Used by**: Mem0, Zep, Supermemory

```
┌─────────────────────────────────────────────────────────────────┐
│                    QUERY-TIME RETRIEVAL                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User Prompt ──────┐                                            │
│                    ▼                                            │
│           ┌───────────────┐                                     │
│           │ Memory Search │◄──── Embed query, search vector DB  │
│           └───────┬───────┘      + optional graph traversal     │
│                   │                                              │
│                   ▼                                              │
│           ┌───────────────┐                                     │
│           │ Rank & Filter │◄──── Relevance threshold, recency   │
│           └───────┬───────┘                                     │
│                   │                                              │
│                   ▼                                              │
│           ┌───────────────┐                                     │
│           │ Inject into   │                                     │
│           │ System Prompt │                                     │
│           └───────┬───────┘                                     │
│                   │                                              │
│                   ▼                                              │
│           ┌───────────────┐                                     │
│           │   LLM Call    │                                     │
│           └───────┬───────┘                                     │
│                   │                                              │
│                   ▼                                              │
│           ┌───────────────┐                                     │
│           │ Extract facts │◄──── Post-response memory update    │
│           │ Update memory │                                     │
│           └───────────────┘                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Mem0 API pattern:**
```python
from mem0 import Memory
m = Memory()

# On each turn:
relevant = m.search(user_query, user_id="alice")  # 1. Retrieve
context = format_memories(relevant)                # 2. Format
response = llm.chat(system=context, user=query)    # 3. Call LLM
m.add(f"User: {query}\nAssistant: {response}",     # 4. Store
      user_id="alice")
```

### Pattern 2: Agent-Driven Memory

**Used by**: MemGPT/Letta

```
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT-DRIVEN MEMORY                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User Prompt ──────┐                                            │
│                    ▼                                            │
│           ┌───────────────┐                                     │
│           │   LLM Call    │◄──── Core memory always in context  │
│           │  (with tools) │                                     │
│           └───────┬───────┘                                     │
│                   │                                              │
│          ┌────────┴────────┐                                    │
│          ▼                 ▼                                    │
│   [Normal response]  [Tool calls]                               │
│                           │                                      │
│          ┌────────────────┼────────────────┐                    │
│          ▼                ▼                ▼                    │
│   archival_search   core_memory_    conversation_               │
│                     append/replace   search                     │
│          │                │                │                    │
│          └────────────────┴────────────────┘                    │
│                           │                                      │
│                           ▼                                      │
│                   [Continue reasoning]                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key difference**: The LLM *decides* when to read/write memory via tool calls. No external orchestration.

### Pattern 3: Background Indexing + On-Demand Retrieval

**Used by**: Cognee, GraphRAG

```
┌─────────────────────────────────────────────────────────────────┐
│              BACKGROUND INDEXING + ON-DEMAND                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INDEXING (async/batch):                                        │
│                                                                  │
│    Documents/Sessions ───► cognee.add() ───► cognee.cognify()   │
│                                    │                │            │
│                                    ▼                ▼            │
│                              [Vector DB]    [Knowledge Graph]    │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  RETRIEVAL (query-time):                                        │
│                                                                  │
│    User Query ───► cognee.search(query, type="GRAPH_COMPLETION")│
│                           │                                      │
│                           ▼                                      │
│                    [Hybrid retrieval]                           │
│                     Vector + Graph                              │
│                           │                                      │
│                           ▼                                      │
│                    [Inject + LLM call]                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### What Triggers Memory Recall?

| Trigger | Systems | How it Works |
|---------|---------|--------------|
| **Every prompt** | Mem0, Zep, Supermemory | Automatic retrieval before each LLM call |
| **Agent decision** | MemGPT/Letta | LLM calls `archival_search` tool when it decides to |
| **Explicit API call** | Cognee, GraphRAG | Developer calls `search()` in their orchestration |
| **Session start** | Some custom impls | Load relevant context at conversation begin |
| **Keyword/entity match** | Zep | Detects entities in query, retrieves related memories |

### The Typical "Glue Code" Pattern

Most implementations follow this structure:

```python
class MemoryAugmentedAgent:
    def __init__(self):
        self.memory = MemoryStore()  # Mem0, Zep, etc.
        self.llm = LLM()

    def chat(self, user_id: str, message: str) -> str:
        # 1. RETRIEVE: Search memory for relevant context
        memories = self.memory.search(
            query=message,
            user_id=user_id,
            limit=10
        )

        # 2. FORMAT: Build augmented prompt
        memory_context = "\n".join([
            f"- {m.content} (relevance: {m.score})"
            for m in memories
        ])

        system_prompt = f"""You are a helpful assistant.

Relevant memories about this user:
{memory_context}

Use these memories to personalize your response."""

        # 3. GENERATE: Call LLM with augmented context
        response = self.llm.chat(
            system=system_prompt,
            user=message
        )

        # 4. STORE: Extract and save new memories
        self.memory.add(
            messages=[
                {"role": "user", "content": message},
                {"role": "assistant", "content": response}
            ],
            user_id=user_id
        )

        return response
```

### Semansiation: Claude Code Integration

For Claude Code, the flow differs from typical chat applications:

```
┌─────────────────────────────────────────────────────────────────┐
│                 CLAUDE CODE INTEGRATION                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INDEXING (hook-triggered):                                     │
│                                                                  │
│    SessionEnd hook ───► Parse JSONL ───► Chunk ───► Embed       │
│                                                 ───► Update     │
│                                                      Causal     │
│                                                      Graph      │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  RETRIEVAL (multiple options):                                  │
│                                                                  │
│  Option A: SessionStart hook (automatic)                        │
│    SessionStart ───► Query graph based on project context       │
│                 ───► Inject into session via additionalContext  │
│                                                                  │
│  Option B: MCP tool (on-demand)                                 │
│    Claude decides to call ───► semansiation.recall(query)       │
│                            ───► semansiation.explain(topic)     │
│                            ───► semansiation.predict(action)    │
│                            ───► Returns relevant memories       │
│                                                                  │
│  Option C: Hybrid                                               │
│    SessionStart injects background context (project patterns)   │
│    MCP tools for explicit queries ("remind me about X")         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### The "When to Retrieve" Problem

Most systems retrieve on **every prompt**, which has trade-offs:

| Approach | How | Trade-off |
|----------|-----|-----------|
| **Always retrieve** | Every turn queries memory | Simple, but noisy and adds latency |
| **Entity detection** | Only when entities/keywords match | Misses implicit relevance |
| **Embedding similarity gate** | Only if query embedding is close to stored memories | Requires threshold tuning |
| **LLM decides** | Agent calls memory tool when needed | Uses context tokens for tool schema |
| **Intent classification** | Classify query type, retrieve for certain intents | Requires intent model |

### Semansiation: Data Capture Timing

The key insight: **PreCompact is a canonical moment** to capture data. It fires when context is about to be compressed, meaning full context is still available.

```
┌─────────────────────────────────────────────────────────────────┐
│                    SESSION TIMELINE                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SessionStart ─────────────────────────────────────► SessionEnd │
│       │                                                    │    │
│       │    [conversation]    [conversation]    [conv...]   │    │
│       │          │                 │               │       │    │
│       │          ▼                 ▼               ▼       │    │
│       │     PreCompact        PreCompact      PreCompact   │    │
│       │     (full context)    (full context)  (full context)   │
│       │          │                 │               │       │    │
│       │          ▼                 ▼               ▼       │    │
│       │     [compacted]       [compacted]     [compacted]  │    │
│       │                                                    │    │
│       ▼                                                    ▼    │
│  Inject context                                     Final capture
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Hook strategy for data capture:**

| Hook | Action | Notes |
|------|--------|-------|
| **PreCompact** | Capture full context snapshot, queue for async processing | Primary capture point; fires before context loss |
| **PostToolUse** | (Optional) Capture context around significant actions | Useful for file edits, test runs |
| **SessionEnd** | Final capture of any remaining unprocessed context | Close out session in graph |

**Critical: Checkpoint tracking to avoid re-ingestion**

PreCompact may fire multiple times per session. Need to track what's been ingested:

```typescript
interface SessionState {
  sessionId: string;
  lastIngestedOffset: number;  // Message index already processed
  checkpoints: number[];       // Logical clock values at each PreCompact
}

async function onPreCompact(transcript: Message[]): Promise<void> {
  const state = await loadSessionState(sessionId);

  // Only process new messages since last checkpoint
  const newMessages = transcript.slice(state.lastIngestedOffset);

  // Queue for async processing (don't block compaction)
  await queueForIngestion(newMessages, sessionId);

  // Update checkpoint
  state.lastIngestedOffset = transcript.length;
  state.checkpoints.push(currentLogicalClock());
  await saveSessionState(state);
}
```

### Semansiation: Memory Injection Strategies

**The core tension:**

```
AUTOMATIC (SessionStart)          vs          ON-DEMAND (MCP)
    │                                              │
    │ "Here's what you should know"                │ "Ask if you need to know"
    │                                              │
    ├─ May inject irrelevant context               ├─ Claude may not know to ask
    ├─ Uses tokens even if not needed              ├─ Adds latency when used
    └─ Can't adapt to session evolution            └─ More flexible, targeted
```

**Guessing user intent at SessionStart is a crapshoot** — too many corner cases to handle with any consistency. Better to keep automatic injection minimal and rely on on-demand tools.

**CLAUDE.md lifecycle:**

- **Read once at session start** — not re-fetched during session
- **Preserved through compaction** — re-included as persistent baseline
- **SessionStart hooks run after CLAUDE.md loads** — hooks add dynamic context on top

This means CLAUDE.md is good for **stable patterns** that don't change mid-session.

**Layered injection strategy:**

```
┌─────────────────────────────────────────────────────────────────┐
│                    INJECTION LAYERS                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  LAYER 1: Stable Patterns (CLAUDE.md / project config)         │
│    └─ Updated periodically (e.g., after N sessions)            │
│    └─ High-level project patterns, architectural decisions     │
│    └─ "This project uses X architecture, Y testing patterns"   │
│    └─ Survives compaction, always present                      │
│                                                                  │
│  LAYER 2: Lightweight Priming (SessionStart hook)              │
│    └─ NOT heavy context injection                              │
│    └─ Just inform Claude that memory is available              │
│    └─ Hint at what clusters are relevant to this project       │
│    └─ Example: "Memory available via semansiation tools.       │
│       Recent activity: [error-handling], [testing]"            │
│                                                                  │
│  LAYER 3: On-Demand Retrieval (MCP tools)                      │
│    └─ Claude calls when it needs specific memory               │
│    └─ recall(query) — semantic search                          │
│    └─ explain(topic) — reverse traversal (what led here?)      │
│    └─ predict(action) — forward traversal (what follows?)      │
│    └─ Returns targeted results, token-efficient                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Layer 1: CLAUDE.md for stable patterns**

A background process periodically updates project CLAUDE.md with distilled patterns:

```markdown
## Project Patterns (auto-generated by semansiation)

- Error handling: Uses Result types, not exceptions
- Test files: `*.test.ts` adjacent to source
- Common sequence: extract function → add tests → rename

Last updated: 2026-02-01 (based on 47 sessions)
```

This is stable, always-present, survives compaction, no runtime hook cost.

**Layer 2: Lightweight SessionStart priming**

Don't try to guess what's relevant. Just tell Claude memory exists:

```typescript
// SessionStart hook
const priming = `
## Memory Available

Semantic memory is available via semansiation tools:
- \`recall(query)\` - Search past context
- \`explain(topic)\` - What typically leads to this?
- \`predict(action)\` - What typically follows this?

Recent clusters for this project: ${recentClusters.map(c => c.label).join(', ')}
`;

return { additionalContext: priming };
```

Few tokens, but Claude knows memory is there and what domains are active.

**Layer 3: MCP tools for targeted retrieval**

Claude decides when to query. Three modes matching causal graph structure:

| Tool | Traversal | Use Case |
|------|-----------|----------|
| `recall(query)` | Semantic similarity | "What do I know about X?" |
| `explain(topic)` | Reverse edges | "What typically leads to this error?" |
| `predict(action)` | Forward edges | "What usually follows this refactoring?" |

**Summary: Hooks for capture, MCP for retrieval**

| Concern | Mechanism |
|---------|-----------|
| **Data capture** | Hooks (PreCompact primary, PostToolUse optional, SessionEnd final) |
| **Stable context** | CLAUDE.md (updated periodically between sessions) |
| **Dynamic priming** | SessionStart hook (lightweight, just awareness) |
| **On-demand retrieval** | MCP tools (Claude decides when to query) |

This avoids the "guess user intent" problem while still providing rich memory access when needed.

### Why MCP-First Aligns with Claude's Training

**Critical insight**: Heavy unsolicited context injection fundamentally contradicts how Claude is trained to work.

```
UNSOLICITED INJECTION                 MCP-FIRST
        │                                  │
        │ "Here's what I think             │ "Here's how to query
        │  you need to know"               │  if you need to know"
        │                                  │
        ├─ Presumes user intent            ├─ Claude decides relevance
        ├─ Assumes recent = relevant       ├─ Query matches actual need
        ├─ Burns tokens on guesses         ├─ Token-efficient targeting
        └─ Works against training          └─ Aligns with training
```

Claude is trained to:
1. **Use tools when needed** — request information at the moment it's relevant
2. **Manage its own context** — decide what's important for the current task
3. **Work within provided capabilities** — leverage available tools appropriately

Pushing potentially large amounts of context into the session unsolicited:
- **Forces assumptions** about which memories are relevant (most recent? highest edge weight? same project?)
- **Works against Claude's training** — it's not designed to receive pre-loaded context based on heuristic guesses
- **Wastes tokens** when the injected context isn't relevant to the actual task
- **Can't adapt** as the session evolves and actual needs become clear
- **Risks context overflow** — can push the context beyond where compaction can recover

### Context Overflow: A Critical Failure Mode

There's a hard operational limit that makes aggressive context injection dangerous:

```
Normal operation:
  Context grows → PreCompact fires → Context compressed → Session continues

Context overflow:
  Context grows → Injection adds more → Context exceeds limit →
  Compaction FAILS → Session DEAD → Only option: clear context entirely
```

This failure mode has been observed with large PDF files — Claude reads too much content, the context fills completely, compaction can't reduce it enough, and the session becomes unrecoverable. The only option is to clear the context and lose everything.

**This is catastrophic for a memory system.** The very mechanism meant to *help* the session could *kill* it. If Semansiation aggressively injects retrieved memories at SessionStart, it risks:

1. **Immediate overflow** — if injection alone exceeds safe limits
2. **Reduced headroom** — less room for actual work before compaction needed
3. **Compaction failure** — injected content + work content exceeds what compaction can handle
4. **Unrecoverable state** — user forced to clear context, losing the session

The MCP-first approach avoids this entirely:
- Claude requests only what it needs, when it needs it
- Retrieved content is proportional to actual queries
- Context budget stays under user/Claude control
- No risk of memory system causing session death

The clean model:

| Layer | Role | Approach |
|-------|------|----------|
| **CLAUDE.md** | Documentation | "Here are stable facts about this project" |
| **MCP tools** | Capability | "Here's how to query memory if you need it" |
| **NOT** | Presumption | ~~"Here's what I think you need to know"~~ |

This is ultimately why the MCP-first approach is not just pragmatically better, but *architecturally correct* — it respects Claude's design rather than fighting against it.

---

## Prior Art: sbxmlpoc PoC

> Source: [github.com/gvonness-apolitical/sbxmlpoc](https://github.com/gvonness-apolitical/sbxmlpoc)

An earlier proof-of-concept implemented several concepts directly applicable to Semansiation: **hierarchical inference with multi-lifespan temporal decay**.

### Core Architecture

The PoC was a hierarchical inference engine for form prediction built in Scala with Akka actors.

#### Hierarchical Data Model (Lattice Structure)

```
FormStructuredData (root node)
├── categories: Map[Label → Value]
├── entities: Map[Label → Value]
├── valueSets: Map[Label → Set[Value]]
└── valueSequences: Map[Label → Seq[Value]]
    │
    └── children: Set[FormStructuredData]  ← RECURSIVE
        (each child removes one category/entity/value)
```

The `children` method generates all possible "one-step-less-specific" variants:
- Remove one category
- Remove one entity
- Remove one item from a set
- Remove last item from a sequence

This creates a **lattice structure** where more specific forms are parents of less specific forms—enabling hierarchical smoothing during inference.

#### Multi-Lifespan Temporal Decay

The key innovation was supporting **multiple decay curves in a single weight**:

```scala
case class DecayingTriple(
  initialValue: Double,
  creationTime: Long,
  lifespan: Long       // Different decay rates per triple
)

case class DecayingWeight(
  triples: Set[DecayingTriple],  // Multiple decay curves!
  baseValue: Double              // Never decays
) {
  def getWeightValue(): Double =
    triples.map(_.getWeightValue()).sum + baseValue

  def boost(lifespan: Long): DecayingWeight = {
    // Find existing triple with same lifespan, or create new
    triples.find(_.lifespan == lifespan) match {
      case Some(dt) => (triples - dt) + dt.boost
      case None     => triples + DecayingTriple(lifespan)
    }
  }
}

case class DecayingTriple(...) {
  def getWeightValue(): Double = {
    val elapsed = (now - creationTime) / lifespan
    max(0, initialValue - elapsed)  // Linear decay
  }
}
```

Each weight can have **multiple decay triples with different lifespans**, allowing:
- Fast-decaying "recent" signal (e.g., 1 hour lifespan)
- Medium-decaying signal (e.g., 1 day lifespan)
- Slow-decaying "historical" signal (e.g., 30 day lifespan)
- Base value that never decays

The decay was **linear**: `weight = initialValue - elapsed_time / lifespan`

#### Tree Inference via Marginalisation

The MLProcessing module performed **tree-based inference**:

1. Start at input query (root)
2. Filter training data to find matches
3. If insufficient matches (`< minRecordsForInference`), recurse to children (less specific)
4. Combine results weighted by confidence

```
Query: {category: "A", entity: "X", set: ["1", "2"]}
        │
        ├─→ Child1: {category: "A", entity: "X", set: ["1"]}
        ├─→ Child2: {category: "A", entity: "X", set: ["2"]}
        ├─→ Child3: {category: "A", set: ["1", "2"]}
        └─→ Child4: {entity: "X", set: ["1", "2"]}
```

This is **hierarchical smoothing**—if you don't have enough data at the specific level, you generalize to find statistical support.

#### Weight Combination and Normalisation

```scala
// Combining weights when same value observed multiple times
def combineWeightValues(input1: FormWeightedValue,
                        input2: FormWeightedValue): FormWeightedValue =
  FormWeightedValue(input1.value, input1.weight.combine(input2.weight))

// Normalisation to prevent weight explosion
def normaliseWeightSet(input: FormWeightedValueSet): FormWeightedValueSet = {
  val norm = input.weightValues.map(_.weight.getWeightValue()).sum
  if (norm > 0) multiplyWeightSet(1.0 / norm, input)
  else input
}
```

### Application to Semansiation

| sbxmlpoc Concept | Semansiation Application |
|------------------|--------------------------|
| **Multi-lifespan decay** | Short-term (1h) + medium-term (24h) + long-term (30d) decay triples on edges |
| **Hierarchical lattice** | Semantic clusters as nodes, with parent/child edges to more/less specific clusters |
| **Weight boosting** | Hebbian reinforcement when concepts co-occur—boost the appropriate lifespan triple |
| **Tree inference** | Traverse from specific → general clusters when querying |
| **Normalisation** | Prevent weight explosion in high-activity clusters |
| **Logical clock** | Replace wall-clock `creationTime` with session-based logical clock |

### Proposed Multi-Lifespan Edge Weight

Adapting the sbxmlpoc pattern for Semansiation:

```typescript
interface DecayingTriple {
  initialValue: number;
  creationClock: number;   // Logical clock (session count, not wall time)
  lifespan: number;        // In logical clock units
}

interface AssociationWeight {
  triples: DecayingTriple[];  // Multiple decay rates
  baseValue: number;          // Permanent association strength

  getValue(currentClock: number): number;
  boost(lifespan: number): AssociationWeight;
  combine(other: AssociationWeight): AssociationWeight;
}

// Example lifespans (in session counts):
const IMMEDIATE = 1;      // Decays after 1 session
const SHORT_TERM = 5;     // Decays over ~5 sessions
const MEDIUM_TERM = 20;   // Decays over ~20 sessions
const LONG_TERM = 100;    // Decays over ~100 sessions
```

### Hierarchical Cluster Model

Apply the lattice structure to semantic clusters:

```
┌─────────────────────────────────────────────────────────────┐
│                    CLUSTER HIERARCHY                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Level 0 (Most Specific):                                   │
│    [error-handling:typescript:async]                        │
│    [testing:jest:mocking]                                   │
│    [git:rebase:conflict]                                    │
│                                                              │
│  Level 1 (Generalized):                                     │
│    [error-handling:typescript]  ← parent of L0 clusters     │
│    [testing:jest]                                           │
│    [git:rebase]                                             │
│                                                              │
│  Level 2 (Abstract):                                        │
│    [error-handling]                                         │
│    [testing]                                                │
│    [git]                                                    │
│                                                              │
│  INFERENCE: If specific cluster has weak signal,            │
│             traverse up to parent clusters                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

When querying:
1. Find the most specific matching cluster
2. If insufficient data (low edge weights), recurse to parent clusters
3. Combine results weighted by cluster specificity

### Key Insights from sbxmlpoc

1. **Multiple lifespans in single weight** is more elegant than separate short/long-term stores
2. **Linear decay** (not exponential) was used—simpler to reason about, but exponential may be more biologically accurate
3. **Boosting finds-or-creates** the appropriate lifespan triple—natural spaced repetition
4. **Normalisation is critical** to prevent high-activity nodes from dominating
5. **Logical clock** (session count) better than wall clock for developer workflows
6. **Hierarchical smoothing** provides graceful degradation when data is sparse

---

## Causal Graph Formalism

A key insight: **decay is essential, not incidental**. Perfect memory is pathological—if every association is equally weighted regardless of when it formed, time loses relevance. You can't decide effectively because an association from 10 years ago has the same weight as one from seconds ago. Decay creates relevance gradients; forgetting is compression.

### From Temporal Proximity to Causality

Simple temporal distance (logical clock position) is a poor proxy for relevance within a session:

```
[1] User asks about error handling
[2] Claude explains try/catch
[3] User asks unrelated git question
[4] Claude explains git rebase
[5] User asks about error handling in async code
```

Temporal proximity says [5] is closest to [4] (git). But causal/semantic relevance says [5] relates to [1,2]. The git tangent is noise.

**Solution**: Model causality directly via **normalised edge weights on the directed graph**. Each D→T→D transition (see [D-T-D Model](#the-d-t-d-model-data-transformation-data)) creates all-pairs edges between chunks in adjacent data blobs. Edge weights accumulate with repeated co-occurrence and decay over time. Causal distance between any two clusters is the path attenuation through the graph — no separate ordering mechanism needed.

The graph's edge weights encode both recency (via decay) and causal strength (via accumulation). Clusters that frequently appear in cause-effect relationships develop strong direct edges; clusters separated by many intermediate steps are connected only by attenuated multi-hop paths that naturally fade.

### Directed Causal Graph

Causality naturally creates **directed edges**:

```
         ┌─────────────────────────────────────────────┐
         │              CAUSAL GRAPH                    │
         │                                              │
         │    [error-handling]                          │
         │          │                                   │
         │          │ forward (predictive)              │
         │          ▼                                   │
         │    [debugging] ◄─────── reverse (explanatory)│
         │          │                                   │
         │          ▼                                   │
         │    [testing]                                 │
         │          │                                   │
         │          ▼                                   │
         │    [refactoring]                             │
         │                                              │
         └─────────────────────────────────────────────┘
```

The same graph supports two traversal modes:

| Mode | Traversal | Query | Use Case |
|------|-----------|-------|----------|
| **Explanatory** | Reverse edges | "What led me here?" | Debugging, root cause analysis |
| **Predictive** | Forward edges | "Where does this go?" | Planning, anticipating next steps |

**Real developer workflows:**

```
EXPLANATORY (reverse traversal):
  "Why am I seeing this error?"
  → traverse back: error → debugging-session → config-change → deployment
  → context: "This error typically follows config changes after deployment"

PREDICTIVE (forward traversal):
  "I'm about to refactor this module"
  → traverse forward: refactoring → test-failures → type-errors → fixes
  → context: "Refactoring this module typically leads to test failures in X"
```

### Asymmetric Edge Weights

Forward and reverse weights can diverge based on observed patterns:

| Pattern | Meaning |
|---------|---------|
| Strong forward, weak reverse | "X reliably causes Y, but Y has many causes" |
| Weak forward, strong reverse | "X sometimes leads to Y, but when Y happens, X almost always preceded it" |

```typescript
interface DirectionalEdge {
  from: ClusterId;
  to: ClusterId;
  forwardWeight: DecayingWeight;  // from predicts to
  reverseWeight: DecayingWeight;  // to explains from
}
```

### Path Attenuation and Convergence

With edge weights normalised to [0,1], **cycles naturally attenuate** without explicit detection:

```
PATH STRENGTH = ∏(edge weights along path)

Total influence from A to B = Σ(all paths from A to B)

Since all weights ∈ [0,1]:
  - Direct path:     0.8                    = 0.800
  - 2-hop path:      0.6 × 0.5              = 0.300
  - 3-hop cycle:     0.4 × 0.3 × 0.7        = 0.084
  - 4-hop cycle:     0.4 × 0.3 × 0.5 × 0.6  = 0.036

Series converges naturally. Cycles contribute, but diminishingly.
```

**Analogy: Perturbation theory / Feynman diagrams**

| Perturbation Theory | Semantic Graph |
|---------------------|----------------|
| Coupling constant α < 1 | Edge weight ∈ [0,1] |
| Higher-order diagrams suppressed by αⁿ | Longer paths suppressed by w₁×w₂×...×wₙ |
| Sum over all diagrams | Sum over all paths |
| Renormalization handles infinities | Normalisation keeps weights bounded |
| Loop diagrams finite | Cycles attenuate naturally |

### Implementation

```typescript
function computeInfluence(
  graph: CausalGraph,
  source: ClusterId,
  target: ClusterId,
  direction: 'forward' | 'reverse',
  maxDepth: number = 5,
  minSignal: number = 0.01  // Cutoff for negligible contributions
): number {

  function propagate(
    current: ClusterId,
    signal: number,
    depth: number
  ): number {
    if (current === target) return signal;
    if (depth === 0 || signal < minSignal) return 0;

    const edges = direction === 'forward'
      ? graph.forwardEdges(current)
      : graph.reverseEdges(current);

    return edges.reduce((sum, edge) => {
      const newSignal = signal * edge.weight;  // Attenuation
      return sum + propagate(edge.to, newSignal, depth - 1);
    }, 0);
  }

  return propagate(source, 1.0, maxDepth);
}
```

The `minSignal` cutoff acts as regularization—below threshold, contributions are noise.

### Decay Amplifies Path Attenuation

As edges decay, **indirect paths weaken faster than direct ones**:

```
Fresh:   A→B = 0.9,  B→C = 0.9,  A→B→C = 0.81
Decayed: A→B = 0.5,  B→C = 0.5,  A→B→C = 0.25

Direct paths degrade linearly with decay.
Indirect paths degrade polynomially (product of decays).
```

Old indirect associations fade into irrelevance while direct ones persist longer. **The graph simplifies itself over time.**

### Context Building by Intent

Different retrieval intents traverse the graph differently:

```typescript
type RetrievalIntent = 'explanatory' | 'predictive' | 'exploratory';

function buildContext(
  currentCluster: ClusterId,
  intent: RetrievalIntent,
  graph: CausalGraph
): SemanticChunk[] {
  switch (intent) {
    case 'explanatory':
      // What led here? Traverse reverse edges
      return traverseReverse(graph, currentCluster, depth=3);

    case 'predictive':
      // Where does this go? Traverse forward edges
      return traverseForward(graph, currentCluster, depth=3);

    case 'exploratory':
      // Balanced - both directions
      return [
        ...traverseReverse(graph, currentCluster, depth=2),
        ...traverseForward(graph, currentCluster, depth=2)
      ];
  }
}
```

### Key Properties

1. **Causality creates direction** — the graph is naturally directed, not just weighted
2. **Same graph, multiple views** — forward traversal for prediction, reverse for explanation
3. **Cycles are harmless** — path products converge; no explicit cycle detection needed
4. **Decay creates simplification** — indirect paths fade faster, graph self-prunes
5. **Intent-aware retrieval** — context depends on whether you're debugging or planning

### The D-T-D Model (Data-Transformation-Data)

This section defines *when* causal edges are created, grounded in the structure of conversational data.

#### Data-Transformation-Data Alternation

A thread of sequential thought follows an alternating pattern:

```
... D₁ - T - D₂ - T - D₃ - T - D₄ ...
```

Where:
- **D** (Data) = an observable output blob — one or more chunks constituting a coherent response or prompt
- **T** (Transformation) = a processing step that is not directly observable — Claude's inference, or a human's thinking before typing

Each D is composed of one or more chunks. Each T is a causal boundary between data blobs.

#### Intra-Blob vs Inter-Blob Relationships

Within a single data blob D, multiple chunks may exist (e.g., a long assistant response split across several chunks). These chunks **appear simultaneously** — they are the output of a single transformation. The relationship between them is **associative** (0th-order co-occurrence), not causal. One chunk within D did not cause another chunk within D.

Across a transformation D₁ → T → D₂, the relationship is **causal**. The content of D₁ (plus the transformation T) produced D₂.

```
WITHIN D (associative):        ACROSS T (causal):
┌─────────────┐                ┌──────┐      ┌──────┐
│  chunk a    │                │ D₁   │      │ D₂   │
│  chunk b    │  co-occurred   │  c₁  │─────▶│  c₃  │
│  chunk c    │                │  c₂  │─╲  ╱▶│  c₄  │
└─────────────┘                └──────┘  ╲╱  └──────┘
                                          ╳
No causal edges               All-pairs causal edges
within a blob                 across the transformation
```

#### All-Pairs Edge Creation (Maximum Entropy)

For D₁ → T → D₂, causal edges are created as **one edge from each chunk in D₁ to each chunk in D₂**. This is a maximum entropy approach:

- We cannot reliably determine which specific chunk in D₁ caused which specific chunk in D₂ without deep semantic analysis
- Even an associatively "weak" chunk in D₁ may have changed the entire output — thoughts are information-dense and not necessarily stable under perturbation
- **Analogy**: Mathematical notation can change meaning completely with a single symbol change, while spoken language is more resilient but less information-dense. Session data is closer to mathematical notation in its sensitivity.

Each of these all-pairs edges **boosts the weight** on the corresponding cluster-to-cluster link in the causal graph. If D₁ has *m* chunks and D₂ has *n* chunks, a single transformation creates *m × n* edge boosts. In practice, typical data blobs contain 3-8 chunks, so the cross product is 9-64 edges per transformation — manageable.

#### Edge Weight Normalisation

Edge weights are normalised in the **direction of traversal** to ensure conservation of causal influence:

**Forward traversal** (cause → effect): Each cause chunk's outgoing edges are normalised so they sum to 1. This evenly distributes causal impact across effect nodes.

**Reverse traversal** (effect → cause): Each effect chunk's reverse edges are normalised so they sum to 1. This evenly distributes explanatory weight back across cause nodes.

```
FORWARD NORMALISATION (D₁ has 2 chunks, D₂ has 3 chunks):

  c₁ ──1/3──▶ c₃
  c₁ ──1/3──▶ c₄       Each cause chunk distributes 1.0
  c₁ ──1/3──▶ c₅       total weight across its effects

  c₂ ──1/3──▶ c₃
  c₂ ──1/3──▶ c₄       Total weight arriving at each
  c₂ ──1/3──▶ c₅       effect chunk: 2/3

REVERSE NORMALISATION (same graph, traversed backwards):

  c₃ ──1/2──▶ c₁       Each effect chunk distributes 1.0
  c₃ ──1/2──▶ c₂       total weight across its causes

  c₄ ──1/2──▶ c₁       Total weight arriving at each
  c₄ ──1/2──▶ c₂       cause chunk: 3/2

  c₅ ──1/2──▶ c₁
  c₅ ──1/2──▶ c₂
```

This normalisation interacts naturally with the existing path attenuation and decay mechanisms. Multi-hop paths still attenuate as the product of edge weights along the path, and decay still causes indirect paths to fade faster than direct ones.

**Key insight**: This direct edge-weight approach makes vector clocks unnecessary. The original motivation for vector clocks was tracking causal distance across independent semantic domains — but that information is already encoded in the graph's edge weights and path attenuation. Edge accumulation encodes frequency of co-occurrence, decay encodes recency, and path products encode causal distance. The graph *is* the clock.

#### Mapping to Session Data

| Session Element | D-T-D Role | Observable? |
|----------------|------------|-------------|
| User prompt | D (data blob) | Yes — text in JSONL |
| Claude's inference | T (transformation) | No — internal processing |
| Assistant response | D (data blob) | Yes — text in JSONL |
| Human thinking before next prompt | T (transformation) | No — unobservable |
| Tool execution + result | T→D (transformation producing data) | Partially — result is observable |

A single conversational turn maps to: `D_user → T_claude → D_assistant`.

A multi-turn exchange is: `D_user₁ → T → D_asst₁ → T_human → D_user₂ → T → D_asst₂ → ...`

#### Human Topic Continuity Detection

The human transformation T_human between D_assistant and D_user_next raises a question: is the new prompt a **causal continuation** of the preceding output, or does it signal a **new thread of thought**?

This matters because:
- **Continuation**: The all-pairs causal edges should connect D_assistant chunks to D_user_next chunks (normal edge creation)
- **Topic switch**: The new prompt starts a fresh causal chain; connecting it to the preceding output would create false causal links

**Detection approach** — a hybrid of embedding distance and lexical heuristics:

1. **Embedding distance**: Compute angular distance between the new user prompt embedding and the preceding assistant output chunk embeddings. A continuation should have low distance to at least some chunks; a topic switch should be distant from all of them.

2. **Lexical signals**: Detect explicit discontinuity markers:
   - "Actually, let's...", "Switching to...", "New topic:..."
   - References to completely different files/modules than the preceding output
   - Prompt structure that ignores the assistant's output entirely

3. **Combined classifier**: Embedding distance provides the primary signal; lexical heuristics handle edge cases where distance alone is ambiguous (e.g., the user references the same codebase but a completely different concern).

This is a concrete classification problem that can be benchmarked using the existing embedding infrastructure and session data.

#### Agent Briefing and Debriefing

The D-T-D model extends naturally to multi-agent scenarios. Each agent has its own D-T-D chain, with causal edges created at the briefing and debriefing boundaries:

```
PARENT AGENT
    D_parent₁ (decides to spawn agents)
         │
    T (Task invocations = briefing)
         │
    ┌────┴────┐
    ▼         ▼
 AGENT A    AGENT B
 D-T-D-T-D  D-T-D-T-D    (each has own sequential D-T-D chain)
    │         │
    T (results returned = debriefing)
    │         │
    └────┬────┘
         │
    D_parent₂ (merge point — causally after all agent work)
```

- **Briefing**: All-pairs edges from D_parent₁ chunks to each agent's first D chunks. The parent's context causally precedes the agent's work.
- **Agent execution**: Each agent builds its own D-T-D chain with edges between its own data blobs. No edges are created between concurrent agents — they are causally independent.
- **Debriefing**: All-pairs edges from each agent's final D chunks to D_parent₂ chunks. The merge point is causally after all parallel work.

Concurrent agents' chunks never appear together in a D₁→D₂ pair, so no edges form between them — causal independence falls out naturally from the edge creation rule without needing any special concurrency mechanism.

This reuses the existing parallelism detection infrastructure (agentId, parentToolUseID, timestamp overlap) documented below.

### Parallel Agents and True Concurrency

Claude Code can spawn parallel agents via the Task tool, each with their own context. This creates **true concurrency** — chunks from parallel agents sit outside each other's causal horizons.

```
PARALLEL AGENT EXECUTION:

Parent Context
      │
      ├──────────────────────────────────┐
      │                                  │
      ▼                                  ▼
   Agent A                            Agent B
      │                                  │
      ├─ chunk a1 [testing]              ├─ chunk b1 [testing]
      ├─ chunk a2 [refactoring]          ├─ chunk b2 [debugging]
      ├─ chunk a3 [testing]              ├─ chunk b3 [logging]
      │                                  │
      ▼                                  ▼
      └──────────────┬───────────────────┘
                     │
                     ▼
              Merge Point
         (parent receives results)
```

**Causal relationships:**
- `a1 < a2 < a3` — sequential within Agent A (D-T-D edges within agent)
- `b1 < b2 < b3` — sequential within Agent B (D-T-D edges within agent)
- `a1 ∥ b1` — **concurrent** (no edges between them — they never appear in the same D₁→D₂ pair)
- `merge > a3` AND `merge > b3` — merge is causally after all parallel work (edges from final agent chunks to merge point)

**The D-T-D edge creation rule handles concurrency naturally:**

Edges are only created between chunks in adjacent D blobs across a transformation. Since parallel agents never share a D-T-D transition, no edges form between them. Their causal independence is a direct consequence of the edge creation rule — no special concurrency mechanism is needed.

If both agents touch the same cluster (e.g., `[testing]`), they each build separate edges to/from that cluster's nodes. These edges accumulate independently and decay independently. When the parent resumes at the merge point, all agent final chunks create edges to the parent's next data blob, reunifying the causal streams.

**Implementation considerations:**

1. **Detection of parallelism**: Need to identify when chunks come from parallel agents
   - Task tool invocations create subagent sessions
   - Session metadata should indicate parent session
   - Chunks from sibling agents are concurrent

2. **Edge creation at boundaries**:
   - **Briefing**: All-pairs edges from parent's pre-spawn D chunks to each agent's first D chunks
   - **Execution**: Each agent builds edges within its own D-T-D chain only
   - **Debriefing**: All-pairs edges from each agent's final D chunks to parent's post-merge D chunks

3. **Same-cluster concurrency**: If both agents touch `[testing]`, their edges to `[testing]` nodes accumulate independently — no conflict, no ordering needed

### Findings: Parallelism Detection from Claude Data

**Investigation of actual session data confirms we have sufficient information to detect and track parallel agents.**

#### Data Structure

**Main Session Transcript** (`~/.claude/projects/<project>/<sessionId>.jsonl`):
```json
// Task tool invocation spawning a subagent
{
  "type": "assistant",
  "message": {
    "content": [{
      "type": "tool_use",
      "name": "Task",
      "id": "toolu_01VUYTPPJz6QzmTLiFwWKUbh",
      "input": { "subagent_type": "general-purpose", "prompt": "..." }
    }]
  },
  "timestamp": "2026-02-01T23:31:16.101Z"
}

// Progress event showing subagent activity
{
  "type": "progress",
  "data": {
    "type": "agent_progress",
    "agentId": "ad9c1a0",
    "prompt": "..."
  },
  "parentToolUseID": "toolu_01VUYTPPJz6QzmTLiFwWKUbh",
  "timestamp": "2026-02-01T23:31:16.109Z"
}
```

**Subagent Transcripts** (separate files: `<sessionId>/subagents/agent-<agentId>.jsonl`):
```json
{
  "agentId": "ad9c1a0",
  "isSidechain": true,
  "sessionId": "3d5f512f-13fb-4667-b775-17df3671a410",
  "type": "user",
  "message": { "role": "user", "content": "..." },
  "timestamp": "2026-02-01T23:31:16.109Z"
}
```

#### Key Fields for Parallelism Detection

| Field | Location | Purpose |
|-------|----------|---------|
| `agentId` | Progress events, subagent files | Unique identifier per subagent |
| `parentToolUseID` | Progress events | Links to spawning Task call |
| `timestamp` | All entries | ISO timestamps for ordering |
| `isSidechain: true` | Subagent transcripts | Marks as subagent |
| `sessionId` | All entries | Ties parent and children together |

#### Detecting Parallel Execution

Parallel agents show **interleaved progress events** in the main transcript:

```
23:31:16.109Z - agent ad9c1a0 (Task 1)
23:31:18.972Z - agent a1517fe (Task 2) ← starts while ad9c1a0 running
23:31:19.094Z - agent ad9c1a0
23:31:21.180Z - agent a1517fe           ← interleaved!
23:31:22.624Z - agent a149891 (Task 3)  ← third agent joins
23:31:25.772Z - agent ad9c1a0
23:31:25.198Z - agent a149891           ← all three concurrent
```

**Detection algorithm**:
1. Collect all progress events grouped by `agentId`
2. For each agent, determine active time range: `[first_timestamp, last_timestamp]`
3. Agents with overlapping ranges were concurrent
4. Agents spawned by same parent message (same `requestId`) are definitely parallel

#### What We Can Track

| Aspect | How |
|--------|-----|
| **Which agents ran in parallel** | Overlapping timestamp ranges |
| **Parent-child relationship** | `parentToolUseID` links agent to Task call |
| **Full agent content** | Separate transcript in `subagents/agent-<id>.jsonl` |
| **Causal order within agent** | Sequential `parentUuid` chain |
| **Merge point** | When parent transcript continues after agent completes |

#### Implementation Implications

```typescript
interface AgentContext {
  agentId: string;
  parentToolUseId: string;
  parentSessionId: string;
  startTime: Date;
  endTime?: Date;
  concurrentWith: Set<string>;  // Other agentIds running in parallel
}

function detectConcurrency(progressEvents: ProgressEvent[]): Map<string, AgentContext> {
  const agents = groupByAgentId(progressEvents);

  for (const [id1, ctx1] of agents) {
    for (const [id2, ctx2] of agents) {
      if (id1 !== id2 && timeRangesOverlap(ctx1, ctx2)) {
        ctx1.concurrentWith.add(id2);
        ctx2.concurrentWith.add(id1);
      }
    }
  }

  return agents;
}

// Edge creation follows D-T-D boundaries
function createAgentEdges(agentContext: AgentContext, graph: CausalGraph): void {
  // Within agent: D-T-D edges between adjacent data blobs
  // No edges to concurrent agents — they share no D-T-D transitions
  // At merge point: edges from agent's final chunks to parent's next D
}
```

#### Conclusion

**We have sufficient data to implement proper causal tracking of parallel agents.** The recommended approach:

1. **D-T-D edge creation**: Each agent builds edges within its own D-T-D chain; no cross-agent edges during execution
2. **Concurrency detection**: Use timestamp overlap to identify parallel agents
3. **Briefing/debriefing edges**: Create all-pairs edges at spawn (parent→agent) and merge (agent→parent) boundaries
4. **Separate ingestion**: Process each subagent transcript independently, create cross-boundary edges at merge points

### Agent Specialization and Causal Isolation

The D-T-D edge creation rule naturally produces **specialist agents with causally isolated semantic contexts**.

```
AGENT SPECIALIZATION WITH CAUSAL ISOLATION

Parent Context
    │
    ├─── briefing ───┬────────────────┬────────────────┐
    │                │                │                │
    │                ▼                ▼                ▼
    │         [Testing Agent]  [Refactor Agent]  [Docs Agent]
    │              │                │                │
    │         builds own       builds own       builds own
    │         semantic         semantic         semantic
    │         context          context          context
    │              │                │                │
    │         edges within      edges within      edges within
    │         own D-T-D chain  own D-T-D chain  own D-T-D chain
    │              │                │                │
    │              ▼                ▼                ▼
    └─── debriefing ◄─────────────────────────────────┘
         (causal merge point)
```

**Why this matters:**

| Without Causal Isolation | With Causal Isolation |
|--------------------------|----------------------|
| All agents' edges mixed into one graph | Each agent's edges form a distinct subgraph |
| Testing agent's edges interfere with refactoring edges | Specialists' edge weights accumulate independently |
| Intermediate reasoning conflated | Detailed work preserved in own causal chain |
| Query results mix all specialist contexts | Can query specialist context specifically |

**Briefing and debriefing as causal boundaries:**

- **Briefing** (task assignment): All-pairs edges from parent's D chunks to specialist's first D chunks. The specialist's causal chain begins from the parent's context.

- **Execution** (specialist work): Specialist builds edges within its own D-T-D chain only. This work is **causally isolated** from sibling specialists — no edges form between concurrent agents.

- **Debriefing** (result return): All-pairs edges from specialist's final D chunks back to parent's next D. This is the **causal merge point**.

**Queryability benefits:**

```typescript
// Query the testing specialist's semantic context specifically
const testingContext = await recall({
  query: "test failure patterns",
  agentScope: "testing-agent-a1517fe",  // Scope to specialist's subgraph
  direction: "reverse"  // What led to these failures?
});

// Query across all specialists (merged view — follow edges past merge point)
const mergedContext = await recall({
  query: "test failure patterns",
  agentScope: "all",
  direction: "reverse"
});
```

**This aligns with how human specialist teams work:**
- The QA specialist doesn't need to track every detail of the architect's work
- They share context at handoffs (briefings, standups, reviews)
- Each specialist's detailed knowledge is preserved but not forced into shared timeline

**Key principle**: Specialist semantic work should not be unnecessarily conflated with other agents beyond briefing and debriefing points. The D-T-D edge creation rule makes this natural — no edges form between agents that never share a D-T-D transition.

### Memory Portability via Specialist Isolation

Causal isolation of specialist contexts enables an interesting capability: **portable specialist memory**.

Because a specialist agent's semantic context is self-contained (its own cluster assignments, edge weights, and causal subgraph), it can potentially be:

1. **Exported**: Extract a specialist's semantic subgraph
2. **Transferred**: Move to a different project with similar patterns
3. **Merged**: Combine with existing memory in the target context

**Example scenarios:**

| Scenario | How It Works |
|----------|--------------|
| **Reusable testing expertise** | A testing specialist's memory of failure patterns, debugging strategies, and test structures could transfer between projects using similar frameworks |
| **Domain specialist sharing** | A specialist trained on AWS infrastructure patterns could be "briefed" into projects needing that expertise |
| **Team knowledge transfer** | When onboarding to a new codebase, import relevant specialist memories from experienced team members |

**What makes this possible:**

- **Causal isolation**: Specialist memory isn't entangled with project-specific parent context
- **Cluster-level portability**: Semantic clusters like `[jest-mocking]` or `[async-error-handling]` are meaningful across projects
- **Edge-weight portability**: Can rescale edge weights during import to match target graph's weight distribution

**Challenges to address:**

1. **Cluster alignment**: Target project's clusters may not match source exactly — need semantic similarity matching
2. **Edge relevance**: Some edges may not make sense in new context — need filtering/reweighting
3. **Weight reconciliation**: How to integrate imported edge weights with existing graph weights
4. **Provenance tracking**: Should imported memories be marked as "transferred" vs "native"?

This is speculative but worth exploring — no existing memory system offers this kind of modular, portable specialist knowledge.

**The "I Know Kung Fu" Vision**

The Matrix provides an apt (if cheesy) analogy:

```
Traditional onboarding:
  Developer: "I'm starting a new Jest project."
  Claude: "Here's the Jest documentation..."

With portable specialist memory:
  Developer: "I'm starting a new Jest project."
  Semansiation: *imports testing-specialist memory from senior dev's projects*
  Claude: "Based on patterns I've seen, you'll probably want to set up
           mock factories early — here's what typically causes pain later
           if you don't. Also, this codebase uses a similar pattern to
           Project X where we solved the async cleanup issue by..."
```

The key difference from Neo's instant kung fu: the knowledge still needs to be **queried** and **applied** contextually. It's not "I now know everything" — it's "I have relevant experience to draw on when needed."

More like having a seasoned colleague available than downloading skills directly into your brain. But the effect is similar: **rapid transfer of hard-won experiential knowledge** rather than starting from documentation every time.

---

## Cluster Representation Problem

If the causal graph connects semantic clusters (not individual embeddings), a fundamental question arises: **what represents the cluster when you need to retrieve actual content?**

### The Centroid Fallacy

A natural instinct is to use the cluster centroid:

```
Cluster: [error-handling in async typescript]

Vectors:
  v1: "Use try/catch with async/await"
  v2: "Remember to handle Promise rejections"
  v3: "The .catch() method is useful for error handling"
  v4: "Unhandled promise rejections crash Node"

Centroid: average(v1, v2, v3, v4) = some point in embedding space
```

The centroid works for **matching** ("is this query near this cluster?") but fails for **retrieval** ("what do I actually know about this?").

**Why?** The embedding model is trained to map semantically similar strings to points with small angular deviation (close in homogeneous coordinates). This is subtly different from being trained to preserve semantic invariants. The centroid is a geometric construct that may not correspond to any coherent utterance—there's no reason the mean, median, or centroid would map back to the semantic invariant of the cluster.

### The Familiarity vs Recall Distinction

Human memory exhibits a similar duality:

| Aspect | What it does | Analog |
|--------|--------------|--------|
| **Familiarity** | "This feels related to things I know" | Centroid matching |
| **Recall** | "Here's what I specifically remember" | Exemplar retrieval |

We don't recall every chair we've seen. We have a *concept* of "chair" (prototype/centroid), but can also recall *specific chairs* when prompted (exemplars).

### Representation Options

| Approach | For Matching | For Retrieval | Trade-off |
|----------|--------------|---------------|-----------|
| **Centroid only** | Centroid | ??? | Can't retrieve coherent text |
| **Exemplar (nearest to centroid)** | Exemplar | Return exemplar | Single point may miss breadth |
| **K exemplars** | Centroid | Return top-k | More coverage, uses more tokens |
| **LLM synthesis** | Centroid | Generate summary | Expensive, non-deterministic |
| **LLM-generated label** | Centroid | Return label + exemplars | Best of both worlds |

### The LLM-Mediated Approach

The insight: **embedding similarity forms clusters (cheap, scalable), but semantic meaning is refined by an LLM (expensive, batched)**.

We can't have an LLM process every incoming chunk against all embeddings—horrible scaling. However, we *can* have the LLM periodically:

1. **Redraw semantic boundaries** between clusters
2. **Generate semantic labels** that describe what each cluster represents
3. **Create contrastive descriptions** (what distinguishes this cluster from neighbors)

```typescript
interface SemanticCluster {
  id: ClusterId;

  // Geometric (computed from embeddings)
  centroid: Vector;
  exemplars: ChunkReference[];

  // Semantic (LLM-generated, periodically refreshed)
  label: string;              // "Error handling in async TypeScript"
  description: string;        // "Patterns for handling errors in Promise-based code..."
  contrastiveFeatures: string; // "Unlike sync error handling, focuses on..."

  // Freshness tracking
  lastLLMRefresh: number;     // Logical clock
  exemplarCountAtRefresh: number;
}
```

### Periodic Cluster Maintenance

A background process periodically refines cluster semantics:

```typescript
async function refreshClusterSemantics(
  cluster: SemanticCluster,
  neighbors: SemanticCluster[],
  llm: LLM
): Promise<void> {
  // Sample exemplars from this cluster
  const samples = sampleExemplars(cluster, k=10);
  const sampleTexts = samples.map(s => s.text);

  // Sample from neighboring clusters for contrast
  const neighborSamples = neighbors.flatMap(n =>
    sampleExemplars(n, k=3).map(s => ({ cluster: n.label, text: s.text }))
  );

  const result = await llm.complete(`
    Analyze this cluster of related memories:

    ${sampleTexts.map(t => `- ${t}`).join('\n')}

    Neighboring clusters contain:
    ${neighborSamples.map(s => `[${s.cluster}]: ${s.text}`).join('\n')}

    Provide:
    1. A concise label (3-6 words) for this cluster
    2. A one-sentence description of the semantic theme
    3. What distinguishes this cluster from its neighbors

    Format as JSON: { "label": "...", "description": "...", "contrast": "..." }
  `);

  const parsed = JSON.parse(result);
  cluster.label = parsed.label;
  cluster.description = parsed.description;
  cluster.contrastiveFeatures = parsed.contrast;
  cluster.lastLLMRefresh = currentLogicalClock();
  cluster.exemplarCountAtRefresh = cluster.exemplars.length;
}
```

### When to Refresh

Trigger semantic refresh when:

1. **Cluster grows significantly**: `exemplars.length > exemplarCountAtRefresh * 1.5`
2. **Cluster splits**: HDBSCAN detects new sub-clusters
3. **Clusters merge**: Two clusters become indistinguishable
4. **Periodic maintenance**: Every N sessions, refresh stale clusters
5. **On demand**: When retrieved cluster has stale semantics

### Retrieval with Dual Representation

```typescript
async function retrieveClusterMemory(
  cluster: SemanticCluster,
  query: Vector,
  mode: 'summary' | 'detailed' | 'both'
): Promise<ClusterMemory> {

  // Always check if semantics need refresh
  if (needsSemanticRefresh(cluster)) {
    await refreshClusterSemantics(cluster, getNeighbors(cluster), llm);
  }

  switch (mode) {
    case 'summary':
      // Return LLM-generated semantic description
      return {
        label: cluster.label,
        description: cluster.description,
        contrast: cluster.contrastiveFeatures
      };

    case 'detailed':
      // Return actual exemplars closest to query
      const relevant = cluster.exemplars
        .map(ref => loadChunk(ref))
        .sort((a, b) => similarity(query, b.vector) - similarity(query, a.vector))
        .slice(0, 5);
      return { exemplars: relevant };

    case 'both':
      // "Here's the gist + here's the specifics"
      return {
        label: cluster.label,
        description: cluster.description,
        exemplars: /* top 3 most relevant */
      };
  }
}
```

### The Invariant Question

What *is* the semantic invariant of a cluster? Not the centroid (geometric mean), but:

> **The pattern that survives across instances—what's common to all members.**

Like recognizing "chair-ness" not by averaging all chairs, but by extracting invariants:
- Has a seat
- Has support structure
- Meant for sitting

The LLM-generated description attempts to capture this invariant through:
1. **Induction**: Looking at exemplars and extracting common themes
2. **Contrast**: Defining what makes this cluster distinct from neighbors

This is computationally expensive, so it's done periodically rather than on every chunk. The embedding-based clustering does the heavy lifting; the LLM provides semantic grounding.

### Key Properties

1. **Separation of concerns**: Embeddings cluster geometrically; LLM provides semantics
2. **Scalable ingestion**: New chunks just update centroids and exemplar lists
3. **Periodic refinement**: LLM cost is amortized over many chunks
4. **Contrastive clarity**: Clusters are defined not just by what they contain, but by what distinguishes them
5. **Dual retrieval**: Summary mode for quick context, detailed mode for specifics

---

## Chunk Assignment Model

> *Note: This section captures exploratory thinking—design may evolve.*

### Ingestion Flow

When a new chunk arrives:

```
Chunk arrives
  │
  ├─► Compare to exemplars of all clusters
  │
  ├─► If closest exemplar is within threshold:
  │     └─► Assign to that cluster
  │     └─► Create D-T-D edges to/from co-occurring clusters
  │
  └─► If beyond threshold from ALL exemplars:
        └─► Chunk becomes a new exemplar
        └─► New cluster node added to graph
```

### Exemplar-Based Matching

Rather than comparing against centroids (which may not correspond to real content), compare against **exemplars**—actual chunks that represent the cluster:

```typescript
function assignChunk(
  chunk: Chunk,
  clusters: SemanticCluster[]
): { cluster: SemanticCluster; isNewExemplar: boolean } {

  let bestMatch: { cluster: SemanticCluster; exemplar: Chunk; distance: number } | null = null;

  for (const cluster of clusters) {
    for (const exemplar of cluster.exemplars) {
      const distance = angularDistance(chunk.vector, exemplar.vector);
      const threshold = clusterThreshold(cluster);

      if (distance < threshold) {
        if (!bestMatch || distance < bestMatch.distance) {
          bestMatch = { cluster, exemplar, distance };
        }
      }
    }
  }

  if (bestMatch) {
    // Assign to existing cluster
    bestMatch.cluster.members.push(chunk.ref);
    boostEdges(bestMatch.cluster.id);  // D-T-D edge weight accumulation
    return { cluster: bestMatch.cluster, isNewExemplar: false };
  } else {
    // Create new cluster with chunk as exemplar
    const newCluster = createCluster(chunk);
    addClusterNode(newCluster.id);
    return { cluster: newCluster, isNewExemplar: true };
  }
}
```

### Dynamic Threshold Based on Cluster Extent

A fixed angular threshold is naive—different semantic invariants naturally form clusters of different sizes:

- `[typescript-syntax-errors]` — tight, narrow concept → small angular extent
- `[debugging-strategies]` — broad, diffuse concept → larger angular extent

Compute threshold from actual cluster extent:

```typescript
function clusterThreshold(cluster: SemanticCluster): number {
  if (cluster.exemplars.length < 2) {
    return DEFAULT_THRESHOLD;  // Bootstrap value for new clusters
  }

  // Threshold based on max angular distance among exemplars to centroid
  const distances = cluster.exemplars.map(e =>
    angularDistance(e.vector, cluster.centroid)
  );

  // Use max distance with margin, or could use percentile
  return Math.max(...distances) * 1.2;  // 20% margin
}
```

### Compound Clusters: Flattening Overlapping Invariants

**The Problem**: A chunk like "dog sleeping on bed" might semantically belong to both `[dog]` and `[bed]` clusters. Naively, this requires:
- Multi-cluster assignment
- Weighted edge boosts across clusters
- Complex bookkeeping

**The Solution**: Don't try to decompose into primitive invariants. Instead, treat unique **sets** of semantic invariants as distinct clusters:

| Chunk | Naive Approach | Compound Approach |
|-------|----------------|-------------------|
| "my dog barks" | Assign to `[dog]` | Assign to `[dog]` |
| "comfortable bed" | Assign to `[bed]` | Assign to `[bed]` |
| "dog sleeping on bed" | Assign to `[dog]` AND `[bed]`? | Assign to `[dog∩bed]` — its own cluster |

**Why this works**:

```
Chunk: "dog sleeping on bed"
  → Beyond threshold from [dog] exemplars (not purely about dogs)
  → Beyond threshold from [bed] exemplars (not purely about beds)
  → Becomes new exemplar → new cluster [dog, bed]
  → Clean single assignment, single cluster node in graph
```

The clusters that **actually emerge** reflect reality:
- `[dog]` — content purely about dogs
- `[bed]` — content purely about beds
- `[dog, bed]` — content distinctly about both together

**Benefits**:

1. **No boolean algebra** — don't decompose/recompose semantic primitives
2. **Single assignment** — each chunk belongs to exactly one cluster
3. **Compound clusters are semantically real** — "dog on bed" IS a distinct concept worth tracking
4. **Simple graph structure** — one node per cluster, edges created by D-T-D transitions
5. **No empty combinations** — intersection clusters only exist if content exists there

**Trade-off**: Potentially more clusters, but in practice:
- Many combinations won't occur
- Combinations that DO occur are semantically meaningful
- Cluster count is bounded by actual content diversity, not combinatorics

### Activity-Based Recalibration Priority

Track activity per cluster to prioritize LLM semantic recalibration:

```typescript
interface SemanticCluster {
  // ... existing fields ...

  activityCount: number;      // Ticks since last LLM refresh
  lastRefreshClock: number;   // Logical clock at last refresh
}

// Increment on each chunk assignment
function onChunkAssigned(clusterId: ClusterId): void {
  const cluster = getCluster(clusterId);
  cluster.activityCount++;
}

// Prioritize high-activity clusters for LLM refresh
function prioritizeClustersForRefresh(
  clusters: SemanticCluster[]
): SemanticCluster[] {
  return clusters
    .filter(c => c.activityCount > ACTIVITY_THRESHOLD)
    .sort((a, b) => b.activityCount - a.activityCount);
}

// After LLM refresh, reset activity counter
function onClusterRefreshed(cluster: SemanticCluster): void {
  cluster.activityCount = 0;
  cluster.lastRefreshClock = currentLogicalClock();
}
```

### Cluster Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                    CLUSTER LIFECYCLE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  BIRTH: Chunk beyond threshold from all exemplars               │
│    └─► New cluster created with chunk as sole exemplar          │
│    └─► New node added to causal graph                           │
│    └─► Bootstrap threshold (DEFAULT_THRESHOLD)                  │
│                                                                  │
│  GROWTH: Chunks within threshold of cluster's exemplars         │
│    └─► Chunk assigned to cluster                                │
│    └─► D-T-D edges boosted                                     │
│    └─► Activity counter incremented                             │
│    └─► Centroid updated                                         │
│    └─► Threshold may expand (based on extent)                   │
│                                                                  │
│  REFINEMENT: Activity threshold exceeded                        │
│    └─► LLM generates/updates semantic label                     │
│    └─► Contrastive features computed vs neighbors               │
│    └─► Activity counter reset                                   │
│                                                                  │
│  DECAY: Edge weights to/from cluster decay over time            │
│    └─► Inactive clusters fade from relevance                    │
│    └─► But exemplars persist (can be rediscovered)              │
│                                                                  │
│  SPLIT (future consideration):                                  │
│    └─► If cluster grows too diffuse, HDBSCAN may split it       │
│    └─► Each sub-cluster inherits portion of exemplars           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Properties

1. **Exemplar-based matching** — compare to real content, not geometric centroids
2. **Dynamic thresholds** — cluster extent determines acceptance radius
3. **Compound clusters** — overlapping invariants flatten to distinct clusters
4. **Single assignment** — no multi-cluster bookkeeping
5. **Activity-driven refinement** — LLM effort goes where it matters most
6. **Emergent structure** — clusters form from actual content patterns, not predefined schema

---

## Technical Components

### Embedding Models (Local)

| Model | Library | Size | Speed | Best For |
|-------|---------|------|-------|----------|
| `bge-small-en-v1.5` | FastEmbed | 33MB | 12x faster than PyTorch | CPU-only, fast |
| `potion-base-8M` | Model2Vec | 30MB | 500x faster | Minimal resources |
| `nomic-embed-text` | Ollama | 274MB | Good | Easy setup, long context |
| `all-MiniLM-L6-v2` | sentence-transformers | 90MB | 14.7ms/1K tokens | Real-time apps |

**Recommendation**: FastEmbed with `bge-small-en-v1.5` for best speed/quality tradeoff on CPU.

### Vector Stores (Local)

| Store | Backend | TypeScript | Performance | Best For |
|-------|---------|------------|-------------|----------|
| **LanceDB** | Apache Arrow | Native embedded | Sub-100ms on 1B vectors | Primary choice |
| **Qdrant** | Rust | SDK available | Excellent | Complex filtering |
| **ChromaDB** | SQLite | Client-server | Good (<10ms on 1M) | Rapid prototyping |
| **sqlite-vec** | SQLite | Via bindings | Moderate | Vectors + relations |

**Recommendation**: LanceDB for primary vector storage. Only vector DB with native embedded TypeScript SDK.

### Graph Storage (Local)

| Store | Type | Concurrency | Performance | Best For |
|-------|------|-------------|-------------|----------|
| **Kuzu** | Embedded | File-locked | Fast OLAP | Primary choice |
| **NetworkX** | In-memory | N/A | Good for <100K nodes | Prototyping |
| **Neo4j** | Server | Full | Production-grade | If scaling needed |
| **SQLite** | Adjacency list | File-locked | Moderate | Simple hierarchies |

**Recommendation**: Kuzu for embedded graph storage (DuckDB philosophy for graphs). Fall back to NetworkX for prototyping.

### Clustering Algorithms

| Algorithm | Type | Best For |
|-----------|------|----------|
| **HDBSCAN** | Density-based | Semantic clusters in embedding space |
| **Leiden** | Community detection | Structural communities in graph |
| **Agglomerative** | Hierarchical | Multi-resolution clustering |

**Recommendation**: Dual clustering approach:
1. HDBSCAN on embeddings → semantic clusters
2. Leiden on graph topology → community detection

These provide complementary views (semantic similarity vs structural connectivity).

### Temporal Decay Models

#### Edge-Weight Decay via D-T-D Transitions

A simple global logical clock is insufficient — it treats all semantic domains as evolving together, when in reality they're causally independent. The D-T-D model solves this naturally: edges only decay relative to *their own cluster's activity*, because edge weights are boosted by D-T-D transitions touching that cluster. A flurry of `[git]` activity creates and boosts `[git]`-related edges without affecting `[error-handling]` edges at all — they simply aren't part of those D-T-D transitions.

Decay is driven by edge age relative to ongoing activity on the same cluster pair. Edges that are repeatedly reinforced by new D-T-D transitions stay strong; edges that stop being reinforced fade.

#### Multi-Lifespan Decay (from sbxmlpoc)

Based on prior art, use **multiple decay triples** on each edge:

```typescript
interface DecayingTriple {
  initialValue: number;
  creationTime: number;   // Logical time at creation (D-T-D transition count)
  lifespan: number;       // In transition units
}

interface AssociationWeight {
  triples: DecayingTriple[];
  baseValue: number;  // Permanent component
}

// Lifespan constants (in D-T-D transition units)
const IMMEDIATE = 1;
const SHORT_TERM = 5;
const MEDIUM_TERM = 20;
const LONG_TERM = 100;

// Decay is relative to the number of transitions that have occurred
function getValue(
  weight: AssociationWeight,
  currentTransitionCount: number
): number {
  const tripleSum = weight.triples.reduce((sum, t) => {
    const elapsed = currentTransitionCount - t.creationTime;
    const decayed = Math.max(0, t.initialValue - elapsed / t.lifespan);
    return sum + decayed;
  }, 0);
  return tripleSum + weight.baseValue;
}

function boost(weight: AssociationWeight, lifespan: number, now: number): AssociationWeight {
  const existing = weight.triples.find(t => t.lifespan === lifespan);
  if (existing) {
    return {
      ...weight,
      triples: weight.triples.map(t =>
        t === existing ? { ...t, initialValue: t.initialValue + 1 } : t
      )
    };
  } else {
    return {
      ...weight,
      triples: [...weight.triples, { initialValue: 1, creationTime: now, lifespan }]
    };
  }
}
```

Benefits over simple exponential decay:
- **Natural memory consolidation**: Boost short-term on first occurrence, medium-term on repetition, long-term on consistent use
- **Logical clock**: Session-based timing better matches developer workflows than wall time
- **Multiple decay curves**: Same edge can have fast-decaying "recent" signal AND slow-decaying "historical" signal

#### Bounded Hebbian Reinforcement

```python
def reinforce_edge(edge: Edge,
                   co_occurrence_strength: float,
                   learning_rate: float = 0.1,
                   max_weight: float = 10.0) -> float:
    """
    Reinforce edge when nodes co-occur.
    Bounded to prevent runaway growth (Oja's rule).
    """
    delta = learning_rate * co_occurrence_strength * (1 - edge.weight / max_weight)
    edge.weight = min(edge.weight + delta, max_weight)
    edge.last_access = now()
    edge.access_count += 1
    return edge.weight
```

---

## Architecture Recommendation

```
┌──────────────────────────────────────────────────────────────┐
│                  Claude Code Sessions                         │
│                         │                                     │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Hook: SessionEnd                                        │ │
│  │   → Triggers embedding + graph update                   │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                    INGESTION LAYER                            │
├──────────────────────────────────────────────────────────────┤
│  1. Parse session JSONL                                      │
│  2. Chunk into semantic blocks (code-aware, turn-preserving) │
│  3. Generate embeddings (FastEmbed: bge-small-en)           │
│  4. Detect co-occurrence via sliding window                  │
│  5. Calculate PMI for association strength                   │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                    STORAGE LAYER                              │
├──────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐      ┌─────────────────────────────┐   │
│  │   LanceDB       │      │   Kuzu                      │   │
│  │   (Vectors)     │◄────►│   (Associations)            │   │
│  │                 │      │                             │   │
│  │   • Embeddings  │      │   • Nodes = semantic blocks │   │
│  │   • Metadata    │      │   • Edges = co-occurrence   │   │
│  │   • Session ref │      │   • weight, last_access,    │   │
│  │                 │      │     access_count            │   │
│  └─────────────────┘      └─────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                  MEMORY DYNAMICS                              │
├──────────────────────────────────────────────────────────────┤
│  MULTI-LIFESPAN DECAY (D-T-D transition based):             │
│    Edge weights boosted by all-pairs D-T-D transitions     │
│    Edge decay relative to transition count                  │
│    Each triple: max(0, initialValue - elapsed/lifespan)     │
│    Lifespans: IMMEDIATE(1), SHORT(5), MEDIUM(20), LONG(100) │
│                                                              │
│  REINFORCEMENT:                                              │
│    • First occurrence → boost IMMEDIATE triple              │
│    • Repeated in session → boost SHORT_TERM                 │
│    • Consistent use → boost MEDIUM/LONG_TERM                │
│    • Bounded by Oja's rule to prevent runaway               │
│                                                              │
│  HIERARCHICAL CLUSTERS:                                      │
│    • HDBSCAN on embeddings → semantic clusters              │
│    • Agglomerative hierarchy → parent/child clusters        │
│    • Inference: specific → general when data sparse         │
│                                                              │
│  MAINTENANCE:                                                │
│    • Prune edges where all triples decayed to 0             │
│    • Periodic cluster hierarchy recomputation               │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                   RETRIEVAL LAYER                             │
├──────────────────────────────────────────────────────────────┤
│  CAUSAL GRAPH TRAVERSAL:                                     │
│    • Forward edges (predictive): "Where does this go?"      │
│    • Reverse edges (explanatory): "What led here?"          │
│    • Path strength = Σ(∏ edge weights along each path)      │
│    • Cycles attenuate naturally (weights ∈ [0,1])           │
│                                                              │
│  RETRIEVAL MODES:                                            │
│    • Explanatory: reverse traversal for debugging/RCA       │
│    • Predictive: forward traversal for planning             │
│    • Exploratory: balanced both directions                  │
│                                                              │
│  INTEGRATION:                                                │
│    • MCP tool for in-session queries                        │
│    • SessionStart hook for context injection                │
│    • Intent-aware context building                          │
└──────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Embeddings | FastEmbed + bge-small-en | Fast, CPU-only, 33MB |
| Vectors | LanceDB | Embedded, TypeScript native, fast |
| Graph | Kuzu | Embedded, DuckDB-like philosophy |
| Clustering | HDBSCAN + Leiden | Complementary semantic + structural |
| Language | TypeScript/Python | Match Claude Code ecosystem |

### Resource Requirements

| Resource | Estimate |
|----------|----------|
| RAM | <2GB for embedding + graph operations |
| Disk | <5GB for substantial memory (100K+ chunks) |
| CPU | Any modern CPU, no GPU required |
| Startup | <1s for embedded databases |

---

## Differentiation Strategy

### Unique Value Proposition

```
┌─────────────────────────────────────────────────────────────┐
│                      Semansiation                            │
│          Associative Memory for Claude Code                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. CLAUDE CODE NATIVE                                       │
│     └─ First-class JSONL parsing, hook integration,         │
│        code-aware chunking                                   │
│                                                              │
│  2. TEMPORAL DYNAMICS                                        │
│     └─ Ebbinghaus decay + spaced repetition strengthening   │
│        (no other production system has this)                 │
│                                                              │
│  3. ASSOCIATIVE EVOLUTION                                    │
│     └─ A-MEM-inspired bidirectional linking + cluster       │
│        detection + cross-cluster reinforcement               │
│                                                              │
│  4. LOCAL-FIRST                                              │
│     └─ Embedded stack, no cloud, optional encryption        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Why This Wins

| Competitor | What They Lack |
|------------|----------------|
| Zep | Not local, no decay dynamics |
| Mem0 | Cloud-centric, graph is paid, no decay |
| A-MEM | Research-only, not local-first, no temporal |
| Cognee | No temporal, scalability issues |
| All | No Claude Code integration |

### Key Technical Differentiators

| Feature | Implementation | Research Basis |
|---------|----------------|----------------|
| **Causal directed graph** | Forward (predictive) + reverse (explanatory) edges | Causal inference theory |
| **D-T-D edge-weight accumulation** | All-pairs edges between adjacent data blobs; normalised weights encode causal distance directly in the graph | D-T-D model / causal inference |
| **Path attenuation** | Influence = Σ paths, each path = ∏ edge weights | Perturbation theory / Feynman diagrams |
| Multi-lifespan decay | Multiple decay triples per edge (1/5/20/100 cluster ticks) | sbxmlpoc PoC |
| Hierarchical clusters | Lattice structure with parent/child clusters | sbxmlpoc marginalisation |
| Bounded Hebbian edges | Oja's rule saturation | Prevents runaway weights |
| Memory triggers | New memories update related existing | A-MEM (NeurIPS 2025) |
| PMI-weighted edges | Point-wise Mutual Information | GCN text classification |
| Dual clustering | HDBSCAN + Leiden | Complementary views |
| Code-aware chunking | Preserve code blocks, stack traces | Novel for Claude Code |

---

## Implementation Roadmap

### Phase 1: MVP (1-2 weeks)
- [ ] Parse session JSONL files
- [ ] Generate embeddings with FastEmbed
- [ ] Store in LanceDB
- [ ] Simple SessionEnd hook to trigger indexing
- [ ] Basic similarity search via MCP tool

### Phase 2: Associative Graph (2-3 weeks)
- [ ] Add Kuzu for graph storage
- [ ] Implement co-occurrence detection (sliding window)
- [ ] Basic edge weights without decay
- [ ] HDBSCAN clustering on embeddings

### Phase 3: Memory Dynamics (2-3 weeks)
- [ ] Two-phase temporal decay
- [ ] Bounded Hebbian reinforcement
- [ ] Cross-cluster edge strengthening
- [ ] Leiden community detection on graph
- [ ] Background pruning of decayed edges

### Phase 4: Polish (1-2 weeks)
- [ ] Optional encryption layer
- [ ] SessionStart context injection
- [ ] Performance optimization
- [ ] Configuration options
- [ ] CLI tooling

---

## Open Questions

### Technical

1. ~~**Chunking strategy**: Sentence-level? Paragraph? Turn-based? Code-block aware?~~ **RESOLVED**: Turn-based, code-block-aware chunking implemented and validated. Thinking blocks should be excluded before embedding (+0.063 AUC). See [benchmark results](embedding-benchmark-results.md#follow-up-experiments).
2. **Decay parameters**: What lifespan values (in cluster ticks) work best? Start with 1/5/20/100?
3. ~~**Vector clock tick granularity**: Tick per chunk? Per message? Per session touching the cluster?~~ **RESOLVED**: Vector clocks eliminated entirely. The D-T-D model creates all-pairs edges directly between chunks in adjacent data blobs. Edge weight accumulation and decay encode causal distance — the graph *is* the clock. See [The D-T-D Model](#the-d-t-d-model-data-transformation-data).
4. **Linear vs exponential decay**: sbxmlpoc used linear; exponential may be more biologically accurate
5. ~~**Cold start**: How to bootstrap useful clusters without history?~~ **RESOLVED**: Not a real problem. Within a session, the full conversation is in context until compaction — the memory system has no role until then. Across sessions, the first session runs normally, gets indexed at SessionEnd, and memory is available for subsequent sessions. There is no gap that needs filling.
6. **Cross-project memory**: Share associations across projects or isolate?
7. **Cluster hierarchy depth**: How many levels of abstraction?
8. **Long inactivity handling**: If a cluster isn't touched for months, should wall time eventually factor in?

### Causal Graph

1. **Cluster assignment**: How to determine which clusters a chunk "touches"? Embedding similarity threshold?
2. **Forward/reverse weight divergence**: Should they start equal and diverge, or be computed differently?
3. ~~**Path depth cutoff**: What `maxDepth` for traversal? 5 seems reasonable but needs tuning~~ **RESOLVED**: Depth sweep showed maxDepth=20 achieves 3.88x augmentation, matching forward decay (dies at 20 hops). Diminishing returns start at depth=15.
4. **Signal threshold**: What `minSignal` cutoff for negligible paths? 0.01? 0.001?
5. **Intent detection**: How to infer whether user needs explanatory vs predictive context?
6. **Edge initialisation**: When a new cluster pair first co-occurs, what initial weights?
7. **Human topic continuity detection**: Classify whether a user prompt is a causal continuation of the preceding assistant output or a new thread of thought. Proposed approach: hybrid of embedding distance + lexical heuristics. Needs benchmarking. See [Human Topic Continuity Detection](#human-topic-continuity-detection).

### Parallel Agents & Concurrency

1. ~~**Parallelism detection**: What metadata in Claude's JSONL identifies parallel agent execution?~~ **RESOLVED**: Progress events with `agentId`, `parentToolUseID`, and timestamps allow detection of parallel execution via overlapping time ranges.
2. ~~**Session relationships**: How are parent/child/sibling sessions represented in the data?~~ **RESOLVED**: `parentToolUseID` links agent to Task call; same `sessionId` ties all together; sibling agents share parent.
3. ~~**Clock partitioning**: Shared clock (simpler) vs agent-scoped clocks (preserves concurrency)?~~ **RESOLVED**: Vector clocks eliminated. Each agent builds edges within its own D-T-D chain; concurrency is a natural consequence of the edge creation rule (no edges between agents that share no D-T-D transitions). See [Agent Briefing and Debriefing](#agent-briefing-and-debriefing).
4. ~~**Merge point handling**: How to represent the causal join when parallel results converge?~~ **RESOLVED**: All-pairs edges from each agent's final D chunks to the parent's next D chunks (first data blob after all agents return).
5. ~~**Concurrent same-cluster ticks**: If parallel agents both touch `[testing]`, how to handle decay?~~ **RESOLVED**: No conflict. Each agent's edges accumulate independently on the same cluster nodes. No clocks to partition — edge weights on the shared graph handle this naturally.
6. ~~**Subagent transcript access**: Can we access parallel agent transcripts, or only the parent's view?~~ **RESOLVED**: Full transcripts at `<sessionId>/subagents/agent-<agentId>.jsonl`.
7. **Nested parallelism**: What if a subagent spawns its own parallel subagents? Likely recursive structure, needs verification.

### Cluster Representation

1. **Refresh frequency**: How often to run LLM semantic refresh? Per N sessions? On significant growth?
2. **Exemplar sampling**: How many exemplars to sample for LLM analysis? Too few loses breadth, too many adds cost
3. **Contrastive depth**: How many neighboring clusters to include in contrast analysis?
4. **Stale threshold**: When is a cluster's semantic description "stale enough" to warrant refresh?
5. **Retrieval mode selection**: When to return summary vs exemplars vs both?
6. **LLM cost budget**: How to allocate limited LLM calls across cluster maintenance tasks?
7. **Semantic drift**: How to detect when a cluster's LLM description no longer matches its exemplars?

### Chunk Assignment

1. **Bootstrap threshold**: What default angular threshold for new clusters with single exemplar?
2. **Threshold margin**: 1.2x max extent? Percentile-based? Adaptive?
3. **Exemplar promotion**: When does a member chunk get promoted to exemplar status?
4. **Compound cluster naming**: How to label clusters like `[dog, bed]`? LLM-generated compound label?
5. **Activity threshold**: How many ticks before a cluster is prioritized for LLM refresh?
6. **Cluster splitting**: When should a diffuse cluster be split? HDBSCAN periodically?
7. **Near-threshold ambiguity**: What if a chunk is near-threshold for multiple clusters?

### Timing & Injection

1. **PreCompact frequency**: How often does PreCompact fire in typical sessions? Need benchmarks
2. **Async queue depth**: How much to buffer before processing? Memory vs latency trade-off
3. **Checkpoint storage**: Where to persist session checkpoints? SQLite? Same as graph DB?
4. **CLAUDE.md update frequency**: After how many sessions to regenerate stable patterns?
5. **CLAUDE.md size budget**: How many tokens of auto-generated content is reasonable?
6. **SessionStart priming content**: What cluster info to include? Just labels? Recent activity counts?
7. **MCP tool latency budget**: What's acceptable latency for recall/explain/predict calls?
8. **PostToolUse selectivity**: Which tool uses warrant capture? Just file edits? All tools?

### Product

1. **Visualization**: Should there be a UI to explore the memory graph?
2. **Manual curation**: Allow users to pin/delete/edit memories?
3. **Export format**: What format for memory graph portability?
4. **Traversal transparency**: Show users "why" certain context was retrieved (path explanation)?

---

## References

### Academic Papers

- [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560) - ICLR 2024
- [A-MEM: Agentic Memory for LLM Agents](https://arxiv.org/abs/2502.12110) - NeurIPS 2025
- [HippoRAG: Neurobiologically Inspired Long-Term Memory](https://arxiv.org/abs/2405.14831) - NeurIPS 2024
- [Mem0: Production-Ready AI Agents with Scalable Long-Term Memory](https://arxiv.org/abs/2504.19413)
- [Graphiti: Temporal Knowledge Graph for AI Agents](https://arxiv.org/abs/2501.13956) - Zep
- [Cognee: Optimizing Knowledge Graphs for Complex Reasoning](https://arxiv.org/abs/2505.24478)
- [Memory in the Age of AI Agents Survey](https://arxiv.org/abs/2512.13564)

### Causal & Temporal Theory

- [Time, Clocks, and the Ordering of Events (Lamport)](https://lamport.azurewebsites.net/pubs/time-clocks.pdf) - Inspiration for causal ordering (vector clocks considered but superseded by D-T-D edge-weight model)
- [Transfer Entropy](https://en.wikipedia.org/wiki/Transfer_entropy) - Directional information flow
- [Granger Causality](https://en.wikipedia.org/wiki/Granger_causality) - Predictive causality
- [Perturbation Theory](https://en.wikipedia.org/wiki/Perturbation_theory) - Path summation convergence analogy

### Technical Resources

- [Claude Code Hooks Documentation](https://docs.anthropic.com/en/docs/claude-code/hooks)
- [Claude Code MCP Integration](https://docs.anthropic.com/en/docs/claude-code/mcp)
- [LanceDB Documentation](https://lancedb.github.io/lancedb/)
- [Kuzu Documentation](https://docs.kuzudb.com/)
- [FastEmbed Documentation](https://qdrant.github.io/fastembed/)
- [HDBSCAN Documentation](https://hdbscan.readthedocs.io/)
- [Leiden Algorithm](https://www.nature.com/articles/s41598-019-41695-z)

### Competitor Documentation

- [Mem0 Documentation](https://docs.mem0.ai/)
- [Cognee Documentation](https://docs.cognee.ai/)
- [Letta/MemGPT Documentation](https://docs.letta.com/)
- [Zep Documentation](https://docs.getzep.com/)
- [Microsoft GraphRAG](https://microsoft.github.io/graphrag/)

### Prior Art

- [sbxmlpoc](https://github.com/gvonness-apolitical/sbxmlpoc) - Hierarchical inference PoC with multi-lifespan temporal decay
