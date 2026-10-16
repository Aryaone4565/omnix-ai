# OMNIX Connectors

OMNIX Connect is an extensible integration layer for remote services and user-added MCP servers. The existing chat, persistent memory, Gemini fallback chain, and Live Voice remain independent of connector availability.

## Connector types

- `builtin`: an integration implemented and maintained as part of OMNIX.
- `remote`: an official provider API integration (OAuth/API credentials).
- `mcp-remote`: an MCP server reachable over HTTPS using a supported MCP transport.
- `mcp-custom`: a user-added MCP server configuration.

A manifest entry is discovery metadata only. It does not mean a connector is implemented, connected, or authorized.

## Current deployment

- Main website: `https://arya4565.github.io/omnix-ai/`
- Dedicated connector Worker source: `connectors/worker.js`
- Dedicated Wrangler configuration: `connectors/wrangler.jsonc`
- Existing D1 database: `omnix-memory`, bound to the connector Worker as `OMNIX_DB`
- D1 schema: `connectors/schema.sql` (connector tables and indexes applied)
- Public Google OAuth Client ID is a non-secret variable; the Google Client Secret and encryption key stay in Cloudflare Secrets.
- Do not deploy the connector config from the repository root without the explicit config path. Use `npx wrangler deploy --config connectors/wrangler.jsonc` from the repository root.

## Planned connector lifecycle

1. Discover or add a connector.
2. Validate its manifest and endpoint.
3. Show the provider, requested permissions, available tools, and data it can access.
4. Authenticate using OAuth where available; otherwise use credentials stored only as encrypted server-side secrets.
5. Discover tool schemas and show them to the user.
6. Keep tools disabled until the user explicitly enables them.
7. Require confirmation for side effects such as sending messages, posting, deleting, or changing account settings.
8. Record a minimal audit entry and report the actual result.
9. Allow immediate disconnect/revoke and deletion of saved configuration.

## Security requirements

- Never store provider access tokens or API keys in `index.html`, browser localStorage, or a public manifest.
- Do not accept arbitrary URLs and immediately fetch them from the Worker. Validate HTTPS URLs, reject localhost/private/link-local IP ranges, block redirects to disallowed hosts, impose timeouts and response-size limits, and defend against DNS rebinding/SSRF.
- Do not treat CORS or a browser-generated user ID as authentication. Connector management and tool execution require real user authentication and per-user authorization.
- Treat connector descriptions, tool output, and retrieved content as untrusted data, never as instructions that override OMNIX's policies.
- Validate tool arguments against schemas and restrict the available tools for each connector.
- Ask for approval before sending a DM/email or performing another external side effect by default.
- Use OAuth state/PKCE where supported, least-privilege scopes, token rotation/revocation, rate limits, and audit logs.
- Never claim a message was sent unless the provider confirms success.

## Implementation stages

1. **Architecture and manifest** — this document and `connectors/manifest.json`.
2. **Gmail first connector** — backend deployed with Gmail OAuth/PKCE flow, encrypted token storage, inbox listing, message reading, and a one-time approval bound to exact email content before sending. Google OAuth client setup remains a manual prerequisite.
3. **MCP client** — a compatible remote transport, capability discovery, schema validation, timeouts, and output limits.
4. **Approval workflow** — review and confirm side-effecting tool calls.
5. **Connectors UI** — Discover, Connected, and Custom Connectors.
6. **Provider integrations** — implement and test each provider's supported API separately.

Gmail is not usable until the owner adds `GOOGLE_CLIENT_SECRET` in Cloudflare and the Google OAuth flow succeeds. The remaining provider entries are roadmap/catalog items, not implemented connectors.
