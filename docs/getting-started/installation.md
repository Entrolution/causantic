# Installation

This guide covers installing Entropic Causal Memory (ECM) and its dependencies.

## Prerequisites

- **Node.js 20+**: ECM requires Node.js version 20 or later

### Verify Prerequisites

```bash
node --version  # Should be v20.x or higher
```

## Installation

### Option 1: npm (Recommended)

```bash
npm install entropic-causal-memory
```

### Option 2: From Source

```bash
git clone https://github.com/Entrolution/entropic-causal-memory.git
cd entropic-causal-memory
npm install
npm run build
```

## Setup

Run the setup wizard to initialize ECM:

```bash
npx ecm init
```

This will:
1. Create the `~/.ecm/` directory structure
2. Initialize the database
3. Detect your Claude Code configuration path
4. Offer to configure MCP integration
5. Run a health check

## Verify Installation

```bash
# Check ECM is installed
npx ecm --version

# Run a health check
npx ecm health
```

## Next Steps

- [Quick Start](quick-start.md) - Get up and running
- [Configuration](configuration.md) - Customize settings
