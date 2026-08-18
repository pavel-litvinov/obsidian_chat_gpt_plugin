# Vault Toolkit Bridge

Vault Toolkit Bridge is a desktop Obsidian plugin that exposes the current vault to local AI clients through the Model Context Protocol (MCP). It uses the standard Obsidian plugin API for note content, active-note state, metadata, tags, frontmatter, and atomic writes.

The server listens on `127.0.0.1` only. It does not send vault data to an external service, collect telemetry, or require an Obsidian account.

## MCP tools

- `read_note` — read a note and its metadata.
- `read_active_note` — read the note active in this Obsidian window.
- `search_notes` — filter by path/title, tag, multiple tags, and frontmatter.
- `list_notes` — list Markdown notes in the vault.
- `get_note_metadata` — return timestamps, tags, and frontmatter.
- `get_vault_metadata` — summarize notes, folders, and tag usage.
- `create_note` — create a note, parent folders, and optional frontmatter.
- `update_note` — replace an entire note atomically.
- `append_to_note` — append Markdown content.
- `patch_note` — replace one exact, unique text fragment.
- `update_frontmatter` — set or remove a frontmatter property atomically.

The Obsidian command palette also includes controls for starting, stopping, and restarting the MCP server, copying its endpoint, and using the note operations manually.

## Multiple vaults

Enable the plugin in every vault that an AI client should access. Each open vault starts at port `8766`; if that port is occupied, it automatically tries later ports. The preferred port and scan range are configurable per vault.

`GET http://127.0.0.1:<port>/health` identifies the vault name and selected port. A multi-vault MCP client can scan the configured range and route each operation to a specific vault.

## Installation

### GitHub release

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest GitHub release.
2. Create `<Vault>/.obsidian/plugins/vault-toolkit-bridge/`.
3. Copy the three files into that directory.
4. Reload Obsidian, then enable **Vault Toolkit Bridge** in **Settings → Community plugins**.

### BRAT

Add this repository in BRAT:

```text
https://github.com/pavel-litvinov/obsidian_chat_gpt_plugin
```

Then enable **Vault Toolkit Bridge** in every vault you want to expose.

## MCP connection

The plugin serves JSON-RPC MCP requests at:

```text
http://127.0.0.1:8766/mcp
```

Use **Vault Toolkit Bridge: Copy MCP endpoint** to copy the actual URL when several vaults are open.

If a bearer token is configured, send it as:

```http
Authorization: Bearer <token>
```

## Development

Node.js 18 or newer is required.

```bash
npm install
npm run typecheck
npm run lint
npm run build
```

The production build writes `main.js` at the repository root. A release tag must exactly match the version in `manifest.json`; GitHub Actions builds and attaches `main.js`, `manifest.json`, and `styles.css` to the release.

## Security

- Desktop only: the plugin uses Node's local HTTP server.
- The server binds only to `127.0.0.1`.
- Optional bearer-token authentication is available in settings.
- No network requests, analytics, telemetry, ads, or paid services are included.
- Write tools modify vault files and should be used with normal backups or version control.
