# OMNIX Connect — Gmail connector setup

## Current implementation

- Dedicated Worker: `omnix-connect` in Cloudflare.
- Source: `connectors/worker.js`.
- Wrangler config: `connectors/wrangler.jsonc` (Worker name, compatibility date, public Google Client ID, and the existing D1 binding).
- D1 database: `omnix-memory`, bound as `OMNIX_DB`.
- Schema: `connectors/schema.sql`; the four connector tables and their indexes have been applied to the existing database.
- Secrets: `OMNIX_ENCRYPTION_KEY` already exists in Cloudflare. Never commit secret values or replace the encryption key after encrypted credentials have been saved.
- The Worker’s `workers.dev` subdomain is enabled.
- Gmail is not connected until the OAuth flow succeeds.

## Google OAuth setup

1. In Google Cloud Console, enable the **Gmail API** for the OMNIX project.
2. Configure the OAuth consent screen. For personal testing, choose External if needed and add your own Google account as a test user while the app is in Testing.
3. Create a **Web application** OAuth client.
4. Add this exact Authorized redirect URI:
   `https://omnix-connect.aryaone4565.workers.dev/oauth/google/callback`
5. `GOOGLE_CLIENT_ID` is a public client identifier and is set in `connectors/wrangler.jsonc` and Cloudflare as a text variable.
6. In Cloudflare → Workers & Pages → `omnix-connect` → Settings → Variables and Secrets, add `GOOGLE_CLIENT_SECRET` as a **Secret**. Never put it in GitHub, Wrangler config, screenshots, or chat.
7. Save/deploy the Worker configuration if you edit it. Keep the existing `OMNIX_ENCRYPTION_KEY` secret unchanged.
8. Open `https://arya4565.github.io/omnix-ai/connectors.html`, choose **Connect Gmail**, sign in to the intended Google account, and review the requested Gmail read/send permissions.
9. Confirm the UI shows connected, then test reading a recent message. Before sending anything, review the exact recipient, subject, and full body in the approval screen.

## Wrangler commands

Run these from the repository root if using a computer with Node.js and Wrangler installed:

```sh
npx wrangler deploy --config connectors/wrangler.jsonc
```

To re-apply the idempotent schema if needed:

```sh
npx wrangler d1 execute omnix-memory --remote --file=connectors/schema.sql --config connectors/wrangler.jsonc
```

The config uses the existing production database ID. Do not create a second database or replace the ID. `keep_vars` is enabled to preserve dashboard-managed variables not declared in the config; secrets must still be managed securely in Cloudflare.

## Connector API

- Base: `https://omnix-connect.aryaone4565.workers.dev`
- Health/config check: `GET /health`
- Start OAuth: `POST /gmail/connect`
- OAuth callback: `GET /oauth/google/callback`
- Status: `GET /gmail/status`
- Recent inbox: `GET /gmail/messages`
- Read a message: `GET /gmail/message?id=...`
- Prepare send approval: `POST /gmail/send/prepare`
- Send after explicit confirmation: `POST /gmail/send`
- Disconnect locally: `POST /gmail/disconnect`

## Safety and limitations

- OAuth uses state and PKCE; provider tokens are encrypted at rest using the server-side key.
- Sending requires a short-lived, single-use server approval bound to the exact recipient, subject, and body.
- The local browser owner token is not a full multi-user identity system. Keep the browser profile/device private.
- Disconnect removes stored OMNIX credentials but may not revoke Google's grant; revoke it separately in Google Account third-party access if desired.
- Gmail is the first implemented provider. Other connector catalog entries remain planned and are not yet functional.
- Google's OAuth Testing mode can cause refresh tokens to expire after seven days for apps using Gmail scopes; reconnect if needed. Broader distribution may require Google verification.
