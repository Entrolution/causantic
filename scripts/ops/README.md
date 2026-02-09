# Operational Scripts

Core operational commands for running ECM.

| Script | Description | Usage |
|--------|-------------|-------|
| `ingest.ts` | Ingest a single session | `npm run ingest -- <path>` |
| `batch-ingest.ts` | Ingest multiple sessions from a directory | `npm run batch-ingest -- <dir>` |
| `recall.ts` | Query the memory system | `npm run recall -- <query>` |
| `recluster.ts` | Run HDBSCAN clustering on all embeddings | `npm run recluster` |
| `recluster-fast.ts` | Fast incremental clustering | `npm run recluster-fast` |
| `refresh-clusters.ts` | Refresh cluster descriptions via LLM | `npm run refresh-clusters` |
| `mcp-server.ts` | Start the MCP server | `npm run mcp-server` |
