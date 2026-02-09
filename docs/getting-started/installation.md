# Installation

This guide covers installing Entropic Causal Memory (ECM) and its dependencies.

## Prerequisites

### Required

- **Node.js 20+**: ECM requires Node.js version 20 or later
- **Python 3.8+**: Required for fast HDBSCAN clustering

### Verify Prerequisites

```bash
node --version  # Should be v20.x or higher
python3 --version  # Should be 3.8 or higher
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

## Python Dependencies

ECM uses Python's HDBSCAN implementation for clustering, which is significantly faster than the JavaScript alternative.

```bash
pip install hdbscan numpy
```

Without Python HDBSCAN, ECM falls back to a JavaScript implementation that is approximately 220x slower.

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
