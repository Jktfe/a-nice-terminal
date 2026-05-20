# Security Policy

## Supported Versions

The public release tracks the current `main` branch until formal versioned
releases are cut.

## Reporting a Vulnerability

Please report security issues privately via GitHub Security Advisories:

https://github.com/Jktfe/a-nice-terminal/security/advisories/new

Do not open public issues for vulnerabilities, exposed tokens, authentication
bypasses, or data disclosure findings.

## Secrets and Local State

Do not commit:

- `.env` or `.env.*` files, except `.env.example`
- SQLite databases such as `fresh-ant.db`
- launchd plists containing local paths or secrets
- `.mcp.json`, Claude/Codex local settings, or local agent state
- screenshots or artefacts containing private room content

Use bearer tokens only over trusted local/private networks or HTTPS.
