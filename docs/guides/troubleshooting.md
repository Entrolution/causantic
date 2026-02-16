# Troubleshooting Guide

Common issues and solutions for Causantic.

## Installation Issues

### "Node.js version too old"

Causantic requires Node.js 20+.

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
npx causantic serve
# Should output: "MCP server started on stdio"
```

**Check 2**: Test health endpoint:

```bash
npx causantic health
```

**Check 3**: Check Claude Code config:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["causantic", "serve"]
    }
  }
}
```

### "Tool returned empty results"

**Cause**: No data ingested yet.

**Solution**:

```bash
# Ingest existing sessions
npx causantic batch-ingest ~/.claude/projects

# Verify ingestion
npx causantic stats
```

## Query Issues

### "Queries are slow"

**Cause 1**: Large database needs optimization.

```bash
npx causantic maintenance run vacuum
```

### "Expected context not recalled"

**Check 1**: Verify the session was ingested:

```bash
npx causantic list-sessions
```

**Check 2**: Search for specific content:

```bash
npx causantic search "your expected content"
```

**Check 3**: Check clustering:

```bash
npx causantic clusters list
```

If content is in a different cluster than expected, adjust `clustering.threshold`.

## Storage Issues

### "Database locked"

**Cause**: Multiple processes accessing the database.

**Solution**: Ensure only one Causantic process runs at a time:

```bash
# Kill any running Causantic processes
pkill -f "causantic serve"

# Restart
npx causantic serve
```

### "Disk space running low"

**Check storage**:

```bash
du -sh ~/.causantic/
du -sh ~/.causantic/memory.db
du -sh ~/.causantic/vectors/
```

**Solutions**:

1. Run vacuum: `npx causantic maintenance run vacuum`
2. Configure `vectors.maxCount` to cap collection size
3. Lower `vectors.ttlDays` to expire old vectors sooner

## Secret Management Issues

### "No API key found"

**macOS**:

```bash
# Set key in Keychain
npx causantic config set-key anthropic
```

**Linux**:

```bash
# Using secret-tool (GNOME)
sudo apt install libsecret-tools
npx causantic config set-key anthropic

# Or via environment variable
export CAUSANTIC_ANTHROPIC_KEY="sk-ant-..."
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
      "command": "npx causantic hook session-start"
    }
  }
}
```

### "Hook fails silently"

**Enable debug logging**:

```bash
export CAUSANTIC_DEBUG=1
npx causantic hook session-start
```

## Getting Help

If issues persist:

1. Check [GitHub Issues](https://github.com/Entrolution/causantic/issues)
2. Run diagnostics: `npx causantic diagnose`
3. Open a new issue with:
   - Causantic version: `npx causantic --version`
   - Node.js version: `node --version`
   - OS and version
   - Error messages
   - Steps to reproduce
