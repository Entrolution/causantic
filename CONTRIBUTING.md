# Contributing to Causantic

Thank you for your interest in contributing! This document provides guidelines and information for contributors.

## Development Setup

### Prerequisites

- Node.js 20+
- Python 3.8+ with pip
- Git

### Getting Started

```bash
# Clone the repository
git clone https://github.com/Entrolution/causantic.git
cd causantic

# Install dependencies
npm install
pip install hdbscan numpy

# Build
npm run build

# Run tests
npm test
```

## Code Style

- TypeScript with strict mode enabled
- ES modules (ESM)
- Use meaningful variable and function names
- Keep functions focused and small
- Add comments for complex logic

## Pull Request Process

1. **Create a branch** from `main` with a descriptive name:
   ```bash
   git checkout -b feature/add-new-tool
   git checkout -b fix/clustering-performance
   ```

2. **Make your changes** following the code style guidelines

3. **Write tests** for new functionality

4. **Run the test suite**:
   ```bash
   npm test
   ```

5. **Build and verify**:
   ```bash
   npm run build
   ```

6. **Submit your PR** with:
   - Clear title describing the change
   - Description of what and why
   - Link to related issues

## Commit Messages

Use clear, descriptive commit messages:

```
Add graph pruning for stale edges

- Implement lazy pruning during traversal
- Add startup pruning for orphaned nodes
- Update tests for new pruning behavior
```

## Testing

- Write unit tests for new functions
- Place tests in `test/` mirroring the `src/` structure
- Use Vitest for testing
- Run tests before submitting PRs

## Project Structure

```
src/
├── clusters/      # HDBSCAN clustering
├── config/        # Configuration management
├── hooks/         # Claude Code integration hooks
├── ingest/        # Session ingestion pipeline
├── mcp/           # MCP server and tools
├── models/        # Embedding models
├── parser/        # Session parsing
├── retrieval/     # Query and context assembly
├── storage/       # Database and vector store
└── utils/         # Shared utilities
```

## Reporting Issues

When reporting issues, please include:

- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Node.js version
- Operating system

## Feature Requests

Feature requests are welcome! Please:

- Check existing issues first
- Describe the use case
- Explain why this would be useful

## Questions

For questions about the codebase or contribution process:

- Open a GitHub Discussion
- Check existing documentation in `docs/`

## Recognition

Contributors are recognized in release notes and the project README.
