# Security Guide

ECM stores sensitive data about your work patterns and conversation history. This guide explains the security features and how to enable them.

## Threat Model

### What ECM Stores

| Data Type | Location | Risk if Exposed |
|-----------|----------|-----------------|
| Conversation text | `chunks` table | Direct content exposure |
| Embedding vectors | `vectors` table | Semantic reconstruction, topic inference |
| Causal relationships | `edges` table | Work patterns, debugging history |
| Topic clusters | `clusters` table | Project/feature groupings |
| Temporal ordering | `vector_clocks` table | Activity timeline |

### Why Encrypt Vectors?

Embedding vectors are a security risk even without the original text:

- **Embedding inversion**: ML models can approximate original text from embeddings
- **Cross-reference attacks**: Match embeddings against known text corpora
- **Cluster analysis**: Reveal topic patterns and work history
- **Semantic similarity**: Probe with test embeddings to find what you were working on

When database encryption is enabled, vectors are encrypted along with all other data.

### Threat Scenarios

1. **Rogue processes**: Malware reading `~/.ecm/memory.db`
2. **Disk theft/loss**: Unencrypted database on stolen device
3. **Shared systems**: Other users accessing your home directory
4. **Backup exposure**: Unencrypted backups in cloud storage

## Encryption at Rest

ECM supports full database encryption using SQLCipher-compatible ciphers.

### Enable Encryption

During initial setup:
```bash
npx ecm init
# "Enable database encryption? [Y/n]" → y
```

For existing installations:
```bash
npx ecm encryption setup
```

### Check Encryption Status

```bash
npx ecm encryption status
# Encryption: enabled
# Cipher: chacha20
```

### Verify Protection

```bash
# ECM can read (has the key)
npx ecm stats

# External tools cannot read
sqlite3 ~/.ecm/memory.db "SELECT * FROM chunks"
# Error: file is not a database

# Raw bytes show encryption
hexdump -C ~/.ecm/memory.db | head -5
# No "SQLite format 3" header visible
```

## Key Management

### Key Sources

ECM can retrieve the encryption key from multiple sources:

| Source | Best For | Configuration |
|--------|----------|---------------|
| `keychain` | Desktop use | Default on macOS/Linux with secret-tool |
| `env` | CI/CD, containers | Set `ECM_DB_KEY` environment variable |
| `prompt` | Manual operations | CLI prompts for password |

Configure in `ecm.config.json`:
```json
{
  "encryption": {
    "enabled": true,
    "cipher": "chacha20",
    "keySource": "keychain"
  }
}
```

### Backup Your Key

```bash
# Create encrypted key backup
npx ecm encryption backup-key ~/ecm-key-backup.enc
# Prompts for backup password
```

Store the backup file securely (password manager, secure USB, etc.).

### Restore Key on New Machine

```bash
npx ecm encryption restore-key ~/ecm-key-backup.enc
# Prompts for backup password
```

### Rotate Key

```bash
npx ecm encryption rotate-key
# Prompts for current and new passwords
```

This re-encrypts the entire database with a new key.

## Cipher Selection

ECM supports two ciphers:

| Cipher | Speed | Best For |
|--------|-------|----------|
| `chacha20` | 2-3x faster on ARM | Apple Silicon, Raspberry Pi |
| `sqlcipher` | Standard | Intel/AMD, compatibility |

Configure in `ecm.config.json`:
```json
{
  "encryption": {
    "cipher": "chacha20"
  }
}
```

## Audit Logging

Enable audit logging to track database access:

```json
{
  "encryption": {
    "auditLog": true
  }
}
```

View audit log:
```bash
npx ecm encryption audit
# 2024-01-15T10:30:00Z open    Database opened successfully
# 2024-01-15T10:30:01Z query   MCP server started
# 2024-01-15T12:45:00Z failed  Invalid encryption key
```

Audit logs are stored at `~/.ecm/audit.log`.

## Export/Import Security

### Encrypted Exports

Always use encrypted exports for backups:
```bash
npx ecm export --output backup.ecm
# Prompts for password
```

See [Backup & Restore](./backup-restore.md) for details.

### Transport Security

When transferring backups:
- Use encrypted export files (`.ecm`)
- Transfer over secure channels (SSH, HTTPS)
- Delete temporary copies after import

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `ECM_DB_KEY` | Database encryption key (when keySource=env) |
| `ECM_EXPORT_PASSWORD` | Export/import encryption password |
| `ECM_SECRET_PASSWORD` | Fallback encrypted file store password |

For production/CI environments, use secrets management:
```bash
# GitHub Actions
ECM_DB_KEY="${{ secrets.ECM_DB_KEY }}" npx ecm serve

# Docker
docker run -e ECM_DB_KEY="$ECM_DB_KEY" ecm-server
```

## Security Checklist

### Initial Setup
- [ ] Run `ecm init` with encryption enabled
- [ ] Verify encryption with `ecm encryption status`
- [ ] Back up encryption key with `ecm encryption backup-key`

### Ongoing
- [ ] Use encrypted exports for backups
- [ ] Don't commit `.ecm/` directory to version control
- [ ] Add `~/.ecm/` to backup encryption (Time Machine, etc.)

### Sharing/Migration
- [ ] Use `--redact-paths --redact-code` for shared exports
- [ ] Transfer files over encrypted channels
- [ ] Delete temporary decrypted copies

## Limitations

### What's Not Protected

- Memory during runtime (process memory)
- MCP communication (relies on Claude Code security)
- Log files (may contain chunk summaries)

### Recovery

**Lost encryption key = lost data**. There is no recovery without the key.

Mitigations:
- Back up key with `ecm encryption backup-key`
- Store backup password in password manager
- Keep unencrypted backup in secure location (optional)
