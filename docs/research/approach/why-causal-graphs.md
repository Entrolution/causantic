# Why Causal Graphs?

This document explains why ECM uses causal graphs rather than simpler approaches.

## The Problem with Vector-Only Search

Vector databases are great for semantic similarity, but they miss relationships:

```
Query: "How did we fix the authentication bug?"

Vector search returns:
- Chunk about authentication
- Chunk about a different bug
- Chunk about fixes in general

Missing context:
- The debugging session that led to the fix
- The related error message that was encountered
- The follow-up testing that validated the fix
```

## What Causal Graphs Add

### Relationship Tracking

Edges capture how chunks relate:

```
[Error Message] --causes--> [Debugging] --leads-to--> [Fix]
                                 |
                                 v
                           [Related File]
```

### Temporal Flow

Vector clocks track logical ordering:

```
Chunk A (clock: {ui: 5})  happened before  Chunk B (clock: {ui: 7})
```

This works even if sessions were days apart.

### Context Assembly

Graph traversal finds related context that vector search misses:

```
1. Vector search finds: authentication fix (score: 0.9)
2. Graph traversal adds:
   - The error that triggered it (1 hop back)
   - The test that validated it (1 hop forward)
   - The config file involved (file-path edge)
```

## Edge Types

ECM tracks multiple relationship types, organized by evidence strength:

### Strong Evidence (0.9-1.0)

| Type | Weight | Description |
|------|--------|-------------|
| `file-path` | 1.0 | Explicit file path reference shared between chunks |
| `explicit-backref` | 0.9 | Explicit references like "the error", "that function" |
| `error-fragment` | 0.9 | Discussing a specific error message |
| `brief` | 0.9 | Parent agent spawning a sub-agent |
| `debrief` | 0.9 | Sub-agent returning results to parent |

### Medium Evidence (0.7-0.8)

| Type | Weight | Description |
|------|--------|-------------|
| `code-entity` | 0.8 | Shared function, class, or variable name |
| `tool-output` | 0.8 | Referencing tool execution results |
| `cross-session` | 0.7 | Continuation from a previous session |

### Weak Evidence (0.5)

| Type | Weight | Description |
|------|--------|-------------|
| `adjacent` | 0.5 | Consecutive chunks with no stronger link detected |

## Comparison

| Approach | Finds Similar | Finds Related | Temporal Aware |
|----------|--------------|---------------|----------------|
| Vector DB | Yes | No | No |
| Graph DB | No | Yes | Partial |
| ECM | Yes | Yes | Yes |

## Results

Graph-augmented retrieval provides 221% more relevant context than vector search alone.

See [../experiments/graph-traversal.md](../experiments/graph-traversal.md) for benchmark data.
