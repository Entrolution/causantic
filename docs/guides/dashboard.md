# Web Dashboard

Causantic includes a web dashboard for visually exploring your memory graph, clusters, and search results.

## Quick Start

```bash
npx causantic dashboard
```

Opens at [http://localhost:3333](http://localhost:3333). Use `--port` to change:

```bash
npx causantic dashboard --port 8080
```

## Pages

### Overview

Collection-wide statistics at a glance:

- Total chunks, edges, and clusters
- Graph connectivity metrics
- Per-project breakdown
- Recent ingestion activity

### Search

Interactive query interface:

- Type a query and see retrieval results in real time
- Results show source attribution (`vector`, `keyword`, `cluster`, `graph`)
- View matching chunks with relevance scores
- Filter by project

### Graph Explorer

Visual exploration of the causal graph:

- Interactive node-edge visualization (D3.js force layout)
- Click nodes to see chunk content
- Color-coded by project or cluster membership
- Zoom, pan, and filter by edge type
- Hover edges to see type and weight

### Clusters

Browse HDBSCAN topic clusters:

- Cluster list with member counts and labels
- Click a cluster to see member chunks
- View cluster centroids and quality metrics
- Noise ratio and coverage statistics

### Projects

Per-project views:

- Sessions per project with time ranges
- Chunk distribution across sessions
- Project-specific graph statistics

## API Routes

The dashboard exposes a REST API that powers the UI. These routes can also be used programmatically:

| Route                                   | Description                                     |
| --------------------------------------- | ----------------------------------------------- |
| `GET /api/stats`                        | Collection statistics (chunks, edges, clusters) |
| `GET /api/chunks`                       | List chunks with pagination                     |
| `GET /api/edges`                        | List edges with filtering                       |
| `GET /api/clusters`                     | List clusters with member counts                |
| `GET /api/projects`                     | List projects with chunk counts                 |
| `GET /api/graph`                        | Graph data for visualization (nodes + edges)    |
| `GET /api/search?q=<query>`             | Search memory with retrieval pipeline           |
| `GET /api/sessions?project=<slug>`      | List sessions for a project                     |
| `GET /api/benchmark-collection`         | Run benchmark and return results                |
| `GET /api/benchmark-collection/history` | Historical benchmark results                    |

## Architecture

The dashboard is a single-page React application served by an Express backend:

- **Backend**: Express server in `src/dashboard/server.ts` with API routes in `src/dashboard/routes/`
- **Frontend**: React + Vite in `src/dashboard/client/` with D3.js for graph visualization
- **Data**: Reads directly from the SQLite/LanceDB stores — no separate database

The dashboard is read-only and does not modify any data.
