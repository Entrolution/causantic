# CLI Commands Reference

Reference for Causantic command-line interface.

## General Syntax

```bash
npx causantic <command> [options]
```

## Commands

### init

Initialize Causantic with an interactive setup wizard.

```bash
npx causantic init [options]
```

**Options**:

| Option | Description |
|--------|-------------|
| `--skip-mcp` | Skip MCP configuration (settings.json, project .mcp.json, skills, CLAUDE.md) |
| `--skip-encryption` | Skip the database encryption prompt |
| `--skip-ingest` | Skip the session import step |

The wizard performs the following steps:

1. Checks Node.js version (requires 20+)
2. Creates `~/.causantic/` directory structure
3. Offers database encryption setup (ChaCha20-Poly1305, key stored in system keychain)
4. Initializes the SQLite database
5. Configures MCP server in `~/.claude/settings.json`
6. Patches project-level `.mcp.json` files
7. Installs Causantic skills to `~/.claude/skills/`
8. Updates `~/.claude/CLAUDE.md` with Causantic reference block
9. Runs a health check
10. Offers to import existing Claude Code sessions
11. Runs post-ingestion processing (graph pruning, clustering)
12. Offers Anthropic API key setup for cluster labeling

**Example**:
```bash
# Full interactive setup
npx causantic init

# Non-interactive (skip all prompts)
npx causantic init --skip-mcp --skip-encryption --skip-ingest
```

### serve

Start the MCP server.

```bash
npx causantic serve [options]
```

**Options**:

| Option | Description |
|--------|-------------|
| `--port <port>` | HTTP port (default: stdio) |
| `--health-check` | Enable health check endpoint |

**Example**:
```bash
npx causantic serve
npx causantic serve --health-check
```

### ingest

Ingest a single session.

```bash
npx causantic ingest <session-path> [options]
```

**Arguments**:

| Argument | Description |
|----------|-------------|
| `session-path` | Path to session JSONL file or project directory |

**Options**:

| Option | Description |
|--------|-------------|
| `--force` | Re-ingest even if already processed |
| `--dry-run` | Show what would be ingested |

**Example**:
```bash
npx causantic ingest ~/.claude/projects/my-project/session-123.jsonl
npx causantic ingest ~/.claude/projects/my-project/
```

### batch-ingest

Ingest all sessions from a directory.

```bash
npx causantic batch-ingest <directory> [options]
```

**Options**:

| Option | Description |
|--------|-------------|
| `--parallel <n>` | Number of parallel workers (default: 4) |
| `--force` | Re-ingest all sessions |

**Example**:
```bash
npx causantic batch-ingest ~/.claude/projects
npx causantic batch-ingest ~/.claude/projects --parallel 8
```

### recall

Query memory from the command line.

```bash
npx causantic recall <query> [options]
```

**Options**:

| Option | Description |
|--------|-------------|
| `--limit <n>` | Maximum results (default: 10) |
| `--json` | Output as JSON |

**Example**:
```bash
npx causantic recall "authentication flow"
npx causantic recall "error handling" --limit 5 --json
```

### maintenance

Run maintenance tasks.

```bash
npx causantic maintenance <subcommand> [options]
```

**Subcommands**:

| Subcommand | Description |
|------------|-------------|
| `run <task>` | Run a specific task |
| `run all` | Run all tasks |
| `status` | Show task status |
| `daemon` | Run as background daemon |

**Tasks**:

| Task | Description |
|------|-------------|
| `scan-projects` | Discover and ingest new sessions |
| `update-clusters` | Re-run HDBSCAN clustering |
| `prune-graph` | Remove dead edges and orphans |
| `refresh-labels` | Update cluster descriptions (requires API key) |
| `vacuum` | Optimize database |

**Example**:
```bash
npx causantic maintenance run prune-graph
npx causantic maintenance run all
npx causantic maintenance status
npx causantic maintenance daemon
```

### config

Manage configuration.

```bash
npx causantic config <subcommand> [options]
```

**Subcommands**:

| Subcommand | Description |
|------------|-------------|
| `show` | Display current configuration |
| `validate` | Validate configuration files |
| `set-key <name>` | Store an API key |
| `get-key <name>` | Retrieve an API key |

**Example**:
```bash
npx causantic config show
npx causantic config validate
npx causantic config set-key anthropic
npx causantic config get-key anthropic
```

### encryption

Manage database encryption.

```bash
npx causantic encryption <subcommand> [options]
```

**Subcommands**:

| Subcommand | Description |
|------------|-------------|
| `setup` | Enable encryption and generate a key |
| `status` | Show encryption status |
| `rotate-key` | Rotate the encryption key |
| `backup-key [path]` | Back up the encryption key to a password-protected file |
| `restore-key <path>` | Restore an encryption key from a backup file |
| `audit [limit]` | Show recent audit log entries |

**Example**:
```bash
# Enable encryption
npx causantic encryption setup

# Check status
npx causantic encryption status

# Rotate key
npx causantic encryption rotate-key

# Back up key
npx causantic encryption backup-key ~/causantic-key-backup.enc

# Restore key
npx causantic encryption restore-key ~/causantic-key-backup.enc

# View last 20 audit entries
npx causantic encryption audit 20
```

### export

Export memory data.

```bash
npx causantic export [options]
```

**Options**:

| Option | Description |
|--------|-------------|
| `--output <path>` | Output file path |
| `--no-encrypt` | Skip encryption |
| `--format <fmt>` | Output format (json, archive) |

**Example**:
```bash
npx causantic export --output backup.causantic.json
npx causantic export --output backup.json --no-encrypt
```

### import

Import memory data.

```bash
npx causantic import <file> [options]
```

**Options**:

| Option | Description |
|--------|-------------|
| `--merge` | Merge with existing data |
| `--replace` | Replace existing data |

**Example**:
```bash
npx causantic import backup.causantic.json
npx causantic import backup.causantic.json --merge
```

### stats

Show memory statistics.

```bash
npx causantic stats [options]
```

**Options**:

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

**Example**:
```bash
npx causantic stats
npx causantic stats --json
```

### health

Check system health.

```bash
npx causantic health [options]
```

**Options**:

| Option | Description |
|--------|-------------|
| `--verbose` | Show detailed status |

**Example**:
```bash
npx causantic health
npx causantic health --verbose
```

### hook

Run a hook manually.

```bash
npx causantic hook <hook-name> [options]
```

**Hooks**:

| Hook | Description |
|------|-------------|
| `session-start` | Session start hook |
| `pre-compact` | Pre-compaction hook |
| `claudemd-generator` | Update CLAUDE.md |

**Example**:
```bash
npx causantic hook session-start
npx causantic hook claudemd-generator
```

### dashboard

Launch the web dashboard for exploring your memory graph, clusters, and search results.

```bash
npx causantic dashboard [options]
```

**Options**:

| Option | Description |
|--------|-------------|
| `--port <port>` | HTTP port (default: 3333) |

**Example**:
```bash
# Launch on default port
npx causantic dashboard

# Launch on custom port
npx causantic dashboard --port 8080
```

The dashboard provides 5 pages: Overview (collection stats), Search (query memory), Graph Explorer (visualize causal graph), Clusters (browse topic clusters), and Projects (per-project breakdowns).

See [Dashboard Guide](../guides/dashboard.md) for details.

### benchmark-collection

Run benchmarks against your collection to evaluate health, retrieval quality, graph value, and latency.

```bash
npx causantic benchmark-collection [options]
```

**Options**:

| Option | Description |
|--------|-------------|
| `--quick` | Health only (~1 second) |
| `--standard` | Health + retrieval (~30 seconds, default) |
| `--full` | All categories (~2-5 minutes) |
| `--categories <list>` | Comma-separated: health,retrieval,graph,latency |
| `--sample-size <n>` | Number of sample queries (default: 50) |
| `--seed <n>` | Random seed for reproducibility |
| `--project <slug>` | Limit to one project |
| `--output <path>` | Output directory (default: ./causantic-benchmark/) |
| `--json` | Output JSON only (no markdown) |
| `--no-tuning` | Skip tuning recommendations |
| `--history` | Show trend from past runs |

**Example**:
```bash
# Quick health check
npx causantic benchmark-collection --quick

# Standard benchmark with reproducible sampling
npx causantic benchmark-collection --seed 42

# Full benchmark for a specific project
npx causantic benchmark-collection --full --project my-app

# View historical trends
npx causantic benchmark-collection --history
```

See [Benchmarking Guide](../guides/benchmarking.md) for details on interpreting results and acting on recommendations.

### uninstall

Remove Causantic and all its artifacts.

```bash
npx causantic uninstall [options]
```

**Options**:

| Option | Description |
|--------|-------------|
| `--force` | Skip confirmation prompt and export offer |
| `--keep-data` | Remove integrations but preserve `~/.causantic/` data |
| `--dry-run` | Show what would be removed without making changes |

Removes the following artifacts:
- CLAUDE.md Causantic memory block
- `~/.claude/settings.json` MCP server entry
- Project `.mcp.json` Causantic server entries
- `~/.claude/skills/causantic-*/` skill directories
- Keychain entries (`causantic-db-key`, `anthropic-api-key`)
- `~/.causantic/` data directory (unless `--keep-data`)

**Example**:
```bash
# Preview what would be removed
npx causantic uninstall --dry-run

# Remove integrations but keep data
npx causantic uninstall --keep-data

# Remove everything without prompts
npx causantic uninstall --force

# Full uninstall, non-interactive
npx causantic uninstall --force
```

## Global Options

These options work with all commands:

| Option | Description |
|--------|-------------|
| `--config <path>` | Use specific config file |
| `--debug` | Enable debug logging |
| `--quiet` | Suppress non-error output |
| `--version` | Show version |
| `--help` | Show help |

## Exit Codes

| Code | Description |
|------|-------------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Configuration error |
| 4 | Database error |
