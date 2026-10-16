# OMNIX Connect — backend setup and rollout

The public Connect page is a front-end catalogue. Saving a custom endpoint in the browser is only a local draft; it does not connect to a server or authorize tool execution.

## Current status

- Discover page and app navigation: implemented.
- Connector catalogue: implemented as planned/not-yet-connected entries.
- Custom endpoint draft: saved locally only.
- D1 schema: provided in `connectors/schema.sql`.
- Provider OAuth, remote MCP execution, and actual message sending: not enabled yet.

## Why the backend is fail-closed

The existing OMNIX chat Worker accepts a browser-generated `userId` for memory/quota grouping. That identifier is not authentication. Connector records, OAuth tokens, and sending actions must not be protected by it alone. CORS is not authentication either.

## Required deployment choices before enabling real connectors

1. Choose an authentication boundary for the Worker. Recommended: a custom domain routed through Cloudflare Access, with the Worker validating Access JWTs (team issuer and audience). A public GitHub Pages origin cannot share a Cloudflare Access cookie with an unrelated `workers.dev` hostname.
2. Add D1 tables by running `connectors/schema.sql` against the same D1 database bound as `OMNIX_DB`.
3. Configure server-side secrets through Cloudflare Worker secrets (never commit them): `OMNIX_ENCRYPTION_KEY`, provider OAuth client secrets, and provider credentials where applicable.
4. Add a strict allowlist for provider API hosts and supported MCP endpoints. Validate DNS/IP targets, block redirects to private/link-local networks, set timeouts and response/body limits, and revalidate every redirect to mitigate SSRF.
5. Implement an authenticated registry API; scope every query by the verified identity from the auth token, not a request-body user ID.
6. Implement MCP initialize/capability discovery and tool calls with schema validation, JSON-RPC error handling, output limits, and no automatic tool execution based on tool descriptions.
7. Require a short-lived, single-use approval tied to the exact connector, tool, and arguments before side effects. Re-check approval server-side and record a redacted audit event.
8. Start with a low-risk read-only provider test, then add one send action behind a confirmation dialog.

## Provider reality

- Gmail: OAuth and Gmail API scopes; message send requires the appropriate API scope and consent.
- WhatsApp: use the official WhatsApp Business Platform/Cloud API; it is not a general personal WhatsApp DM API.
- Instagram and Messenger: Meta app setup, permissions, eligible account types, and review may be required; messaging is not unrestricted.
- Discord: bot/OAuth setup and the right server/user permissions.
- Telegram: Bot API token and bot-appropriate chat permissions; bots cannot freely DM any arbitrary user.
- Future apps: add a provider adapter plus manifest entry and permissions; do not assume every provider exposes a send-message API.

## Safety rules for all send tools

- Draft first; display destination and exact message.
- Require explicit confirmation per send by default.
- Never send because a remote tool's output tells OMNIX to do so.
- Never claim sent until the provider API returns success and a provider message ID.
- Redact tokens, message bodies, and personal data from logs.
- Disconnect must revoke/delete credentials where the provider supports revocation.

Do not advertise any connector as connected until its OAuth/API flow, server-side execution, authorization, approval, and error handling are implemented and tested.
