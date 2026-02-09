# Troubleshooting Guide

Common issues and solutions for ECM.

## Installation Issues

### "Node.js version too old"

ECM requires Node.js 20+.

**Solution**:
```bash
# Using nvm
nvm install 20
nvm use 20

# Verify
node --version
```

## MCP Server Issues

### "MCP server not responding"

**Check 1**: Verify the server starts:
```bash
npx ecm serve
# Should output: "MCP server started on stdio"
```

**Check 2**: Test health endpoint:
```bash
npx ecm health
```

**Check 3**: Check Claude Code config:
```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["ecm", "serve"]
    }
  }
}
```

### "Tool returned empty results"

**Cause**: No data ingested yet.

**Solution**:
```bash
# Ingest existing sessions
npx ecm batch-ingest ~/.claude/projects

# Verify ingestion
npx ecm stats
```

## Query Issues

### "Queries are slow"

**Cause 1**: Too many edges need traversal.
```bash
npx ecm maintenance run prune-graph
```

**Cause 2**: Large database needs optimization.
```bash
npx ecm maintenance run vacuum
```

### "Expected context not recalled"

**Check 1**: Verify the session was ingested:
```bash
npx ecm list-sessions
```

**Check 2**: Search for specific content:
```bash
npx ecm search "your expected content"
```

**Check 3**: Check clustering:
```bash
npx ecm clusters list
```

If content is in a different cluster than expected, adjust `clustering.threshold`.

## Storage Issues

### "Database locked"

**Cause**: Multiple processes accessing the database.

**Solution**: Ensure only one ECM process runs at a time:
```bash
# Kill any running ECM processes
pkill -f "ecm serve"

# Restart
npx ecm serve
```

### "Disk space running low"

**Check storage**:
```bash
du -sh ~/.ecm/
du -sh ~/.ecm/memory.db
du -sh ~/.ecm/vectors/
```

**Solutions**:
1. Run vacuum: `npx ecm maintenance run vacuum`
2. Prune old edges: `npx ecm maintenance run prune-graph`
3. Archive old sessions if needed

## Secret Management Issues

### "No API key found"

**macOS**:
```bash
# Set key in Keychain
npx ecm config set-key anthropic
```

**Linux**:
```bash
# Using secret-tool (GNOME)
sudo apt install libsecret-tools
npx ecm config set-key anthropic

# Or via environment variable
export ECM_ANTHROPIC_KEY="sk-ant-..."
```

### "Keychain access denied"

**macOS**: Grant terminal access in System Preferences > Security & Privacy > Privacy > Keychain Access.

## Hook Issues

### "Hook not firing"

**Check Claude Code configuration**:
```bash
cat ~/.claude/settings.json
```

Verify hooks are configured:
```json
{
  "hooks": {
    "session-start": {
      "command": "npx ecm hook session-start"
    }
  }
}
```

### "Hook fails silently"

**Enable debug logging**:
```bash
export ECM_DEBUG=1
npx ecm hook session-start
```

## Getting Help

If issues persist:

1. Check [GitHub Issues](https://github.com/Entrolution/entropic-causal-memory/issues)
2. Run diagnostics: `npx ecm diagnose`
3. Open a new issue with:
   - ECM version: `npx ecm --version`
   - Node.js version: `node --version`
   - OS and version
   - Error messages
   - Steps to reproduce
