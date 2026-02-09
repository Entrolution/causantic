# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it by opening a private security advisory on GitHub:

1. Go to the [Security tab](https://github.com/Entrolution/entropic-causal-memory/security)
2. Click "Report a vulnerability"
3. Provide details about the issue

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will respond within 48 hours and work with you to understand and address the issue.

## Security Considerations

### Data Storage

- Memory data is stored locally in SQLite and LanceDB
- No data is transmitted to external servers (except when using Anthropic API for cluster labeling)
- API keys are stored in the system keychain (macOS) or encrypted file (Linux)

### MCP Server

- The MCP server runs locally and communicates via stdio
- Optional token-based authentication can be enabled for network deployments
- No network listeners are opened by default

### Best Practices

- Keep your Anthropic API key secure
- Use encrypted exports when sharing memory data
- Review data before sharing exports
