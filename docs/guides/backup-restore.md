# Backup & Restore

Causantic supports encrypted, compressed exports for secure backup and migration of your memory data.

## Export Memory

### Encrypted (recommended)

```bash
# Interactive - prompts for password
npx causantic export --output backup.causantic

# Prompted for password:
# Enter encryption password: ********
# Confirm password: ********
```

### Unencrypted

```bash
npx causantic export --output backup.json --no-encrypt
```

### Filter by Project

```bash
npx causantic export --output backup.causantic --projects my-project
npx causantic export --output backup.causantic --projects project-a,project-b
```

### With Redaction (for sharing)

```bash
# Redact file paths and code blocks
npx causantic export --output backup.causantic --redact-paths --redact-code
```

### Without Vectors (lightweight)

```bash
# Skip vector embeddings for a smaller file
# Note: semantic search will not work after import until re-embedding
npx causantic export --output backup.causantic --no-vectors
```

## Import Memory

### Encrypted Archive

```bash
# Interactive - prompts for password
npx causantic import backup.causantic

# Prompted:
# Enter decryption password: ********
```

### Merge with Existing Data

```bash
npx causantic import backup.causantic --merge
```

Without `--merge`, existing data is replaced.

### Dry Run (validate without importing)

```bash
npx causantic import backup.causantic --dry-run
```

## Environment Variable (CI/Scripts)

For non-interactive environments, set the password via environment variable:

```bash
# Export
CAUSANTIC_EXPORT_PASSWORD="your-secure-password" npx causantic export --output backup.causantic

# Import
CAUSANTIC_EXPORT_PASSWORD="your-secure-password" npx causantic import backup.causantic
```

## What Gets Exported

| Data | Description |
|------|-------------|
| Chunks | Conversation segments with semantic content |
| Edges | Causal relationships (forward/backward links) with identity and link counts |
| Clusters | Topic groupings with centroids, exemplar IDs, distances, and membership hashes |
| Vectors | Embedding vectors for semantic search (skip with `--no-vectors`) |

## Archive Format

### Version History

| Version | Changes |
|---------|---------|
| 1.1 | Added vector embeddings, full cluster data (centroid, distances, exemplars), gzip compression, edge identity |
| 1.0 | Initial format (chunks, edges, basic clusters) |

Archives are backward-compatible: v1.1 can import v1.0 archives (with a warning that vectors are missing).

### Compression

All v1.1 exports are gzip-compressed. On import, Causantic auto-detects compressed, encrypted, and plain JSON formats.

### Encryption Details

Causantic uses strong encryption for archive files:

- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key Derivation**: scrypt (N=16384, r=8, p=1)
- **Nonce**: 12 bytes (random per encryption)
- **Salt**: 16 bytes (unique per password)

The archive format uses magic bytes (`CST\0`) to identify encrypted files.

### File Structure

**Encrypted + compressed:**
```
[Magic: 4 bytes "CST\0"]
[Salt: 16 bytes]
[Nonce: 12 bytes]
[Auth Tag: 16 bytes]
[Ciphertext: gzip(JSON) encrypted with AES-256-GCM]
```

**Unencrypted compressed (default):**
```
[gzip(JSON)]
```

**Plain JSON (v1.0 backward compat):**
```json
{
  "format": "causantic-archive",
  "version": "1.1",
  "created": "2024-01-15T10:30:00Z",
  "metadata": { ... },
  "chunks": [ ... ],
  "edges": [ ... ],
  "clusters": [ ... ],
  "vectors": [ ... ]
}
```

## Migration Workflow

### Moving to a New Machine

1. Export on old machine:
   ```bash
   npx causantic export --output ~/backup.causantic
   ```

2. Transfer `backup.causantic` to new machine

3. Initialize Causantic on new machine:
   ```bash
   npx causantic init
   ```

4. Import:
   ```bash
   npx causantic import ~/backup.causantic
   ```

### Sharing Memory (Sanitized)

For sharing conversation patterns without sensitive data:

```bash
# Export with redactions
npx causantic export --output shared.causantic --redact-paths --redact-code

# Recipient imports
npx causantic import shared.causantic --merge
```

## Troubleshooting

### "Archive is encrypted. Please provide a password."

The file was encrypted but no password was provided. Either:
- Run interactively and enter the password when prompted
- Set `CAUSANTIC_EXPORT_PASSWORD` environment variable

### "Invalid archive format"

The file is not a valid Causantic archive. Check that:
- The file wasn't corrupted during transfer
- It's the correct file (not a random JSON file)

### "Decryption failed"

Wrong password. Re-enter the password carefully.

### "Archive version 1.0: no vector embeddings"

The archive was created with v1.0 (before vector support). After import:
- Semantic search (`recall`, `search`, `predict`) won't work until vectors are regenerated
- Run `npx causantic maintenance run scan-projects` to re-ingest and generate embeddings
