# Storage API Reference

Reference documentation for Causantic's storage layer APIs.

## Overview

The storage layer provides persistence for the Causantic memory system. It consists of several stores:

| Store         | Purpose                                 | Module             |
| ------------- | --------------------------------------- | ------------------ |
| Chunk Store   | Conversation segments                   | `chunk-store.ts`   |
| Edge Store    | Sequential causal connections           | `edge-store.ts`    |
| Vector Store  | Embedding vectors for similarity search | `vector-store.ts`  |
| Keyword Store | FTS5 full-text search with BM25 ranking | `keyword-store.ts` |
| Cluster Store | Topic groupings                         | `cluster-store.ts` |

All stores use SQLite for persistence via `better-sqlite3-multiple-ciphers`.

## Data Types

### Chunks

Chunks are the fundamental unit of storage, representing segments of conversation.

```typescript
interface StoredChunk {
  id: string; // UUID
  sessionId: string; // Claude session ID
  sessionSlug: string; // Project folder name
  turnIndices: number[]; // Turn indices included (0-based)
  startTime: string; // ISO timestamp of first message
  endTime: string; // ISO timestamp of last message
  content: string; // Rendered text content
  codeBlockCount: number; // Number of code blocks
  toolUseCount: number; // Number of tool uses
  approxTokens: number; // Approximate token count
  createdAt: string; // ISO timestamp when stored
  agentId: string | null; // 'ui' for main, agent ID for sub-agents
  spawnDepth: number; // 0=main, 1=sub-agent, 2=nested
  projectPath: string | null; // Full cwd path for disambiguation
  teamName: string | null; // Team name for agent team sessions
}
```

### Edges

Edges represent causal connections between chunks.

```typescript
interface StoredEdge {
  id: string;
  sourceChunkId: string;
  targetChunkId: string;
  edgeType: 'backward' | 'forward';
  referenceType: ReferenceType | null;
  initialWeight: number; // 0-1, before decay
  createdAt: string;
  linkCount: number; // Boost count for duplicates
}
```

### Reference Types

Edge reference types are purely structural roles that determine initial weight:

| Type            | Weight | Description                                                                     |
| --------------- | ------ | ------------------------------------------------------------------------------- |
| `within-chain`  | 1.0    | D-T-D causal edge within one thinking entity (m×n all-pairs at turn boundaries) |
| `brief`         | 0.9    | Parent agent spawning a sub-agent (m×n all-pairs, with 0.9^depth penalty)       |
| `debrief`       | 0.9    | Sub-agent returning results to parent (m×n all-pairs, with 0.9^depth penalty)   |
| `team-spawn`    | 0.9    | Lead agent spawning a team member via Task with team_name                        |
| `team-report`   | 0.9    | Team member reporting results back to lead via SendMessage                       |
| `peer-message`  | 0.85   | Teammate-to-teammate communication via SendMessage                              |
| `cross-session` | 0.7    | Session continuation (previous final chunks ↔ new first chunks, m×n)            |

### Weighted Edges

During traversal, edges include computed weight after decay:

```typescript
interface WeightedEdge extends StoredEdge {
  weight: number; // Computed: initialWeight × hopDecay(depth) × linkBoost
}
```

## Chunk Store API

### createChunk(input: ChunkInput): string

Create a new chunk. Returns the chunk ID.

```typescript
const id = createChunk({
  id: generateId(),
  sessionId: 'abc-123',
  sessionSlug: 'my-project',
  turnIndices: [0, 1, 2],
  startTime: '2024-01-15T10:00:00Z',
  endTime: '2024-01-15T10:05:00Z',
  content: 'Discussion about authentication...',
  codeBlockCount: 2,
  toolUseCount: 1,
  approxTokens: 150,
});
```

### createChunks(inputs: ChunkInput[]): string[]

Batch create chunks in a transaction.

### getChunkById(id: string): StoredChunk | null

Retrieve a chunk by ID.

### getChunksBySession(sessionId: string): StoredChunk[]

Get all chunks for a session, ordered by start time.

### getChunksBySlug(slug: string): StoredChunk[]

Get all chunks for a project slug.

### deleteChunk(id: string): boolean

Delete a chunk. Returns true if deleted.

### getChunkCount(): number

Get total chunk count.

### isSessionIngested(sessionId: string): boolean

Check if a session has been ingested (has any chunks).

## Edge Store API

### createEdge(edge: EdgeInput): string

Create a new edge. Returns the edge ID.

```typescript
const id = createEdge({
  sourceChunkId: 'chunk-1',
  targetChunkId: 'chunk-2',
  edgeType: 'backward',
  referenceType: 'within-chain',
  initialWeight: 1.0,
});
```

### getForwardEdges(chunkId: string): StoredEdge[]

Get edges where `source_chunk_id = chunkId AND edge_type = 'forward'`. Used by the chain walker for forward traversal.

### getBackwardEdges(chunkId: string): StoredEdge[]

Get edges where `target_chunk_id = chunkId AND edge_type = 'forward'`. Used by the chain walker for backward traversal.

### deleteEdge(id: string): boolean

Delete an edge by ID.

### deleteEdgesForChunk(chunkId: string): number

Delete all edges connected to a chunk. Returns count deleted.

## Vector Store API

The vector store is a singleton: `import { vectorStore } from './vector-store.js'`

### vectorStore.insert(id: string, embedding: number[]): Promise<void>

Insert a vector embedding.

### vectorStore.insertBatch(items: Array<{id, embedding}>): Promise<void>

Batch insert embeddings in a transaction.

### vectorStore.search(query: number[], limit: number): Promise<VectorSearchResult[]>

Search for similar vectors. Returns results sorted by angular distance (ascending).

```typescript
const results = await vectorStore.search(queryEmbedding, 10);
// [{ id: 'chunk-456', distance: 0.15 }, ...]
```

**Distance metric**: Angular distance (0 = identical, 2 = opposite)

### vectorStore.searchWithinIds(query, candidateIds, limit): Promise<VectorSearchResult[]>

Search only within a subset of IDs. Useful for filtering by project or session.

### vectorStore.delete(id: string): Promise<boolean>

Delete a vector.

### vectorStore.count(): Promise<number>

Get total vector count.

## Keyword Store API

The keyword store provides FTS5-backed full-text search with BM25 ranking.

```typescript
import { KeywordStore } from './keyword-store.js';

const store = new KeywordStore();
```

### store.search(query: string, limit: number): KeywordSearchResult[]

Full-text search with BM25 ranking. Porter stemming enables matching of word variants (e.g., "authenticating" matches "authentication").

```typescript
const results = store.search('authentication JWT', 10);
// [{ id: 'chunk-123', score: 2.5 }, ...]
```

Query preprocessing automatically escapes FTS5 special characters and strips boolean operators.

### store.searchByProject(query, projects, limit): KeywordSearchResult[]

Full-text search filtered by project slug(s).

```typescript
const results = store.searchByProject('error handling', 'my-project', 10);
const results = store.searchByProject('error handling', ['proj-a', 'proj-b'], 10);
```

**Graceful degradation**: If FTS5 is unavailable (SQLite built without it) or the `chunks_fts` table is corrupted, methods return empty results instead of throwing.

## Cluster Store API

### createCluster(input: ClusterInput): string

Create a new cluster.

### updateCluster(id: string, updates: Partial<ClusterInput>): boolean

Update cluster metadata (name, description, centroid, exemplars).

### getClusterById(id: string): StoredCluster | null

Get a cluster by ID.

### getAllClusters(): StoredCluster[]

Get all clusters.

### assignChunkToCluster(chunkId, clusterId, distance): void

Assign a chunk to a cluster with its distance from centroid.

### getClusterAssignments(chunkId: string): ChunkClusterAssignment[]

Get all cluster assignments for a chunk (soft clustering).

### getChunksInCluster(clusterId: string): string[]

Get all chunk IDs in a cluster.

### deleteCluster(id: string): boolean

Delete a cluster and its assignments.

## Database

### getDb(): Database

Get the SQLite database instance. Creates database and tables if needed.

### generateId(): string

Generate a new UUID.

### closeDb(): void

Close the database connection.

## Error Handling

Storage operations throw standard JavaScript errors. Common error scenarios:

| Scenario                  | Error Type                                |
| ------------------------- | ----------------------------------------- |
| Database not initialized  | `Error: Database not initialized`         |
| Duplicate ID              | `Error: SQLITE_CONSTRAINT`                |
| Invalid foreign key       | `Error: SQLITE_CONSTRAINT`                |
| Vector dimension mismatch | Detected at search time via NaN distances |

## Transaction Support

Batch operations use SQLite transactions for atomicity:

```typescript
// These are all-or-nothing:
createChunks([...]);
createEdges([...]);
vectorStore.insertBatch([...]);
```

## Performance Notes

| Operation          | Complexity | Notes                                  |
| ------------------ | ---------- | -------------------------------------- |
| Chunk lookup by ID | O(1)       | Primary key index                      |
| Chunks by session  | O(k)       | Indexed by session_id                  |
| Edge lookup        | O(1)       | Primary key index                      |
| Outgoing edges     | O(k)       | Indexed by source_chunk_id             |
| Vector search      | O(n)       | Brute-force, optimize if >100k vectors |
| Keyword search     | O(log n)   | FTS5 inverted index with BM25 ranking  |
| Batch insert       | O(n)       | Single transaction                     |

## Related

- [Types Reference](../src/storage/types.ts) - Full type definitions
- [Traversal Algorithm](./traversal-algorithm.md) - How edges are traversed
- [Decay Models](../research/archive/decay-models.md) - Decay curve details (historical, pre-v0.3)
