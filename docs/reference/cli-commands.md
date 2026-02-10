# CLI Commands Reference

Reference for ECM command-line interface.

## General Syntax

```bash
npx ecm <command> [options]
```

## Commands

### init

Initialize ECM with an interactive setup wizard.

```bash
npx ecm init [options]
```

**Options**:

| Option | Description |
|--------|-------------|
| `--skip-mcp` | Skip MCP configuration (settings.json, project .mcp.json, skills, CLAUDE.md) |
| `--skip-encryption` | Skip the database encryption prompt |
| `--skip-ingest` | Skip the session import step |

The wizard performs the following steps:

1. Checks Node.js version (requires 20+)
2. Creates `~/.ecm/` directory structure
3. Offers database encryption setup (ChaCha20-Poly1305, key stored in system keychain)
4. Initializes the SQLite database
5. Configures MCP server in `~/.claude/settings.json`
6. Patches project-level `.mcp.json` files
7. Installs ECM skills to `~/.claude/skills/`
8. Updates `~/.claude/CLAUDE.md` with ECM reference block
9. Runs a health check
10. Offers to import existing Claude Code sessions
11. Runs post-ingestion processing (graph pruning, clustering)
12. Offers Anthropic API key setup for cluster labeling

**Example**:
```bash
# Full interactive setup
npx ecm init

# Non-interactive (skip all prompts)
npx ecm init --skip-mcp --skip-encryption --skip-ingest
```

### serve

Start the MCP server.

```bash
npx ecm serve [options]
```

**Options**:

| Option | Description |
|--------|-------------|
| `--port <port>` | HTTP port (default: stdio) |
| `--health-check` | Enable health check endpoint |

**Example**:
```bash
npx ecm serve
npx ecm serve --health-check
```

### ingest

Ingest a single session.

```bash
npx ecm ingest <session-path> [options]
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
npx ecm ingest ~/.claude/projects/my-project/session-123.jsonl
npx ecm ingest ~/.claude/projects/my-project/
```

### batch-ingest

Ingest all sessions from a directory.

```bash
npx ecm batch-ingest <directory> [options]
```

**Options**:

| Option | Description |
|--------|-------------|
| `--parallel <n>` | Number of parallel workers (default: 4) |
| `--force` | Re-ingest all sessions |

**Example**:
```bash
npx ecm batch-ingest ~/.claude/projects
npx ecm batch-ingest ~/.claude/projects --parallel 8
```

### recall

Query memory from the command line.

```bash
npx ecm recall <query> [options]
```

**Options**:

| Option | Description |
|--------|-------------|
| `--limit <n>` | Maximum results (default: 10) |
| `--json` | Output as JSON |

**Example**:
```bash
npx ecm recall "authentication flow"
npx ecm recall "error handling" --limit 5 --json
```

### maintenance

Run maintenance tasks.

```bash
npx ecm maintenance <subcommand> [options]
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
npx ecm maintenance run prune-graph
npx ecm maintenance run all
npx ecm maintenance status
npx ecm maintenance daemon
```

### config

Manage configuration.

```bash
npx ecm config <subcommand> [options]
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
npx ecm config show
npx ecm config validate
npx ecm config set-key anthropic
npx ecm config get-key anthropic
```

### encryption

Manage database encryption.

```bash
npx ecm encryption <subcommand> [options]
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
npx ecm encryption setup

# Check status
npx ecm encryption status

# Rotate key
npx ecm encryption rotate-key

# Back up key
npx ecm encryption backup-key ~/ecm-key-backup.enc

# Restore key
npx ecm encryption restore-key ~/ecm-key-backup.enc

# View last 20 audit entries
npx ecm encryption audit 20
```

### export

Export memory data.

```bash
npx ecm export [options]
```

**Options**:

| Option | Description |
|--------|-------------|
| `--output <path>` | Output file path |
| `--no-encrypt` | Skip encryption |
| `--format <fmt>` | Output format (json, archive) |

**Example**:
```bash
npx ecm export --output backup.ecm.json
npx ecm export --output backup.json --no-encrypt
```

### import

Import memory data.

```bash
npx ecm import <file> [options]
```

**Options**:

| Option | Description |
|--------|-------------|
| `--merge` | Merge with existing data |
| `--replace` | Replace existing data |

**Example**:
```bash
npx ecm import backup.ecm.json
npx ecm import backup.ecm.json --merge
```

### stats

Show memory statistics.

```bash
npx ecm stats [options]
```

**Options**:

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

**Example**:
```bash
npx ecm stats
npx ecm stats --json
```

### health

Check system health.

```bash
npx ecm health [options]
```

**Options**:

| Option | Description |
|--------|-------------|
| `--verbose` | Show detailed status |

**Example**:
```bash
npx ecm health
npx ecm health --verbose
```

### hook

Run a hook manually.

```bash
npx ecm hook <hook-name> [options]
```

**Hooks**:

| Hook | Description |
|------|-------------|
| `session-start` | Session start hook |
| `pre-compact` | Pre-compaction hook |
| `claudemd-generator` | Update CLAUDE.md |

**Example**:
```bash
npx ecm hook session-start
npx ecm hook claudemd-generator
```

### uninstall

Remove ECM and all its artifacts.

```bash
npx ecm uninstall [options]
```

**Options**:

| Option | Description |
|--------|-------------|
| `--force` | Skip confirmation prompt and export offer |
| `--keep-data` | Remove integrations but preserve `~/.ecm/` data |
| `--dry-run` | Show what would be removed without making changes |

Removes the following artifacts:
- CLAUDE.md ECM memory block
- `~/.claude/settings.json` MCP server entry
- Project `.mcp.json` ECM server entries
- `~/.claude/skills/ecm-*/` skill directories
- Keychain entries (`ecm-db-key`, `anthropic-api-key`)
- `~/.ecm/` data directory (unless `--keep-data`)

**Example**:
```bash
# Preview what would be removed
npx ecm uninstall --dry-run

# Remove integrations but keep data
npx ecm uninstall --keep-data

# Remove everything without prompts
npx ecm uninstall --force

# Full uninstall, non-interactive
npx ecm uninstall --force
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
