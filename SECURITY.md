# Security Policy

## Reporting a vulnerability

Report a vulnerability privately through GitHub's private vulnerability reporting on this
repository: go to the Security tab and choose "Report a vulnerability", or open
`https://github.com/jramsahai/obsidian-mcp-brain/security/advisories/new` directly.

**Do not report a vulnerability as a public issue.** A public issue is visible to everyone
before a fix exists.

## Supported versions

There are no tagged releases yet. Treat the latest commit on the default branch as the
supported version.

## Trust boundary

- **The server only touches the vault directory it is configured with** (`OBSIDIAN_VAULT`).
  Tools take note names or vault-relative paths; requests that resolve outside the vault are
  rejected. Source: `server/src/vault.ts`.
- **Machine edits are append-only**, except for adding wikilink brackets. Nothing is deleted
  by a tool call. Source: `server/src/edits.ts`, `server/src/tools.ts`.
- **Automated passes snapshot the vault in git** before and after their edits, so every
  change is reviewable and revertible. Source: `server/src/git.ts`.
- **The server has no network surface of its own.** It speaks MCP over stdio to the agent
  runtime that launches it. Whatever reaches it has already passed that runtime's controls.
