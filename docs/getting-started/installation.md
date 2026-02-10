# Installation

This guide covers installing Causantic and its dependencies.

## Prerequisites

- **Node.js 20+**: Causantic requires Node.js version 20 or later

### Verify Prerequisites

```bash
node --version  # Should be v20.x or higher
```

## Installation

### Option 1: npm (Recommended)

```bash
npm install causantic
```

### Option 2: From Source

```bash
git clone https://github.com/Entrolution/causantic.git
cd causantic
npm install
npm run build
```

## Setup

Run the setup wizard to initialize Causantic:

```bash
npx causantic init
```

The interactive setup wizard will:
1. Create the `~/.causantic/` directory structure
2. Offer to enable database encryption (recommended)
3. Initialize the database
4. Detect your Claude Code configuration path
5. Offer to configure MCP integration
6. Run a health check
7. Offer to import existing Claude Code sessions
8. Build topic clusters from imported sessions
9. Offer to configure Anthropic API key for cluster labeling

### Setup Options

```bash
# Full interactive setup (recommended)
npx causantic init

# Skip specific steps
npx causantic init --skip-encryption  # Skip encryption prompt
npx causantic init --skip-mcp         # Skip MCP configuration
npx causantic init --skip-ingest      # Skip session import
```

### Session Import

During setup, Causantic will detect existing Claude Code sessions in `~/.claude/projects/` and offer to import them:

- **All projects**: Import everything at once
- **Select specific**: Choose which projects to import by number
- **Skip**: Import later with `npx causantic batch-ingest`

For large session histories, the initial import may take a few minutes.

After importing sessions, Causantic automatically:
- **Prunes graph**: Removes dead edges and orphan nodes
- **Builds clusters**: Groups related chunks by topic using HDBSCAN

### Cluster Labeling (Optional)

Causantic can use Claude Haiku to generate human-readable descriptions for topic clusters. This requires an Anthropic API key.

During setup, you'll be prompted to add your API key. The key is stored securely in your system keychain (macOS Keychain / Linux libsecret).

You can add or update the API key later:
```bash
npx causantic config set-key anthropic-api-key
npx causantic maintenance run refresh-labels
```

## Verify Installation

```bash
# Check Causantic is installed
npx causantic --version

# Run a health check
npx causantic health
```

## Uninstalling

To cleanly remove Causantic and all its artifacts:

```bash
npx causantic uninstall
```

This removes MCP config entries, CLAUDE.md references, skill files, keychain secrets, and the `~/.causantic/` data directory. You'll be shown a preview and asked to confirm.

```bash
# Preview what would be removed without making changes
npx causantic uninstall --dry-run

# Remove integrations but keep your data for later
npx causantic uninstall --keep-data

# Skip prompts (CI/scripts)
npx causantic uninstall --force
```

To reinstall after uninstalling: `npx causantic init`

## Next Steps

- [Quick Start](quick-start.md) - Get up and running
- [Configuration](configuration.md) - Customize settings
