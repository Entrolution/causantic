# Backup & Restore

ECM supports encrypted exports for secure backup and migration of your memory data.

## Export Memory

### Encrypted (recommended)

```bash
# Interactive - prompts for password
npx ecm export --output backup.ecm

# Prompted for password:
# Enter encryption password: ********
# Confirm password: ********
```

### Unencrypted

```bash
npx ecm export --output backup.json --no-encrypt
```

### Filter by Project

```bash
npx ecm export --output backup.ecm --projects my-project
```

### With Redaction (for sharing)

```bash
# Redact file paths and code blocks
npx ecm export --output backup.ecm --redact-paths --redact-code
```

## Import Memory

### Encrypted Archive

```bash
# Interactive - prompts for password
npx ecm import backup.ecm

# Prompted:
# Enter decryption password: ********
```

### Merge with Existing Data

```bash
npx ecm import backup.ecm --merge
```

Without `--merge`, existing data is replaced.

## Environment Variable (CI/Scripts)

For non-interactive environments, set the password via environment variable:

```bash
# Export
ECM_EXPORT_PASSWORD="your-secure-password" npx ecm export --output backup.ecm

# Import
ECM_EXPORT_PASSWORD="your-secure-password" npx ecm import backup.ecm
```

## What Gets Exported

| Data | Description |
|------|-------------|
| Chunks | Conversation segments with semantic content |
| Edges | Causal relationships (backward/forward links) |
| Clusters | Topic groupings from HDBSCAN clustering |
| Vector Clocks | Temporal ordering metadata |

## Encryption Details

ECM uses strong encryption for archive files:

- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key Derivation**: scrypt (N=16384, r=8, p=1)
- **Nonce**: 12 bytes (random per encryption)
- **Salt**: 16 bytes (unique per password)

The archive format uses magic bytes (`ECM\0`) to identify encrypted files.

## File Formats

### Encrypted (.ecm)

Binary format with structure:
```
[Magic: 4 bytes "ECM\0"]
[Salt: 16 bytes]
[Nonce: 12 bytes]
[Auth Tag: 16 bytes]
[Ciphertext: variable]
```

### Unencrypted (.json)

Standard JSON with structure:
```json
{
  "format": "ecm-archive",
  "version": "1.0",
  "created": "2024-01-15T10:30:00Z",
  "metadata": { ... },
  "chunks": [ ... ],
  "edges": [ ... ],
  "clusters": [ ... ]
}
```

## Migration Workflow

### Moving to a New Machine

1. Export on old machine:
   ```bash
   npx ecm export --output ~/backup.ecm
   ```

2. Transfer `backup.ecm` to new machine

3. Initialize ECM on new machine:
   ```bash
   npx ecm init
   ```

4. Import:
   ```bash
   npx ecm import ~/backup.ecm
   ```

### Sharing Memory (Sanitized)

For sharing conversation patterns without sensitive data:

```bash
# Export with redactions
npx ecm export --output shared.ecm --redact-paths --redact-code

# Recipient imports
npx ecm import shared.ecm --merge
```

## Troubleshooting

### "Archive is encrypted. Please provide a password."

The file was encrypted but no password was provided. Either:
- Run interactively and enter the password when prompted
- Set `ECM_EXPORT_PASSWORD` environment variable

### "Invalid archive format"

The file is not a valid ECM archive. Check that:
- The file wasn't corrupted during transfer
- It's the correct file (not a random JSON file)

### "Decryption failed"

Wrong password. Re-enter the password carefully.
