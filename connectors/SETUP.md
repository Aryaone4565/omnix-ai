# OMNIX Connect — Gmail connector setup

## Current implementation

- Gmail connector Worker: `omnix-connect` in Cloudflare.
- D1 tables: connector configs, OAuth states, approvals, and audit events are present in the `omnix-memory` database.
- Credential encryption: the Worker has an `OMNIX_ENCRYPTION_KEY` secret binding.
- Gmail UI: `connectors.html` includes connect/status, inbox list, message read, and an explicit send confirmation flow.
- The Worker’s `workers.dev` subdomain has been enabled.
- Gmail OAuth is **not configured until** `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are added as Worker secrets. Do not call Gmail connected until the OAuth flow succeeds.

## One-time Google OAuth setup

1. Open Google Cloud Console and create/select a project.
2. Enable the **Gmail API**.
3. Configure the OAuth consent screen. For personal testing, choose External if required, add your Google account as a test user, and leave the app in Testing while testing.
4. Create an OAuth client ID of type **Web application**.
5. Add this exact Authorized redirect URI:
   `https://omnix-connect.aryaone4565.workers.dev/oauth/google/callback`
6. In Cloudflare Dashboard → Workers & Pages → `omnix-connect` → Settings → Variables and Secrets, add:
   - `GOOGLE_CLIENT_ID` as a secret/text variable containing the OAuth client ID.
   - `GOOGLE_CLIENT_SECRET` as a secret containing the OAuth client secret.
   Save/deploy the new version.
7. Open the OMNIX Connect page and press **Connect Gmail**. Sign in to the intended Google account and review the requested Gmail read/send permissions.
8. Return to OMNIX Connect and check the Gmail status. Test reading a recent inbox message first. For sending, review the exact recipient, subject and full body in the confirmation dialog before approving.

Google's OAuth testing mode can cause refresh tokens to expire after seven days for apps requesting Gmail scopes. If that happens during testing, reconnect. Gmail scopes may also trigger Google verification requirements before the app can be used by a broader audience.

## Connector API

- Base: `https://omnix-connect.aryaone4565.workers.dev`
- Health/config check: `GET /health`
- Start OAuth: `POST /gmail/connect`
- OAuth callback: `GET /oauth/google/callback`
- Status: `GET /gmail/status`
- Recent inbox: `GET /gmail/messages`
- Read a message: `GET /gmail/message?id=...`
- Prepare a send approval: `POST /gmail/send/prepare`
- Send after explicit confirmation: `POST /gmail/send`
- Disconnect locally: `POST /gmail/disconnect`

## Safety notes

- The browser owner token is generated locally and sent as a bearer token; it is not a replacement for a full multi-user identity system. Keep the browser account/device private.
- Send requires a short-lived, single-use server-side approval bound to the exact recipient, subject, and body, plus the explicit confirmation string.
- Tokens are encrypted at rest using the Worker secret; never put OAuth secrets or tokens in GitHub.
- Disconnect removes the stored credentials from OMNIX, but it may not revoke the Google grant itself. Revoke OMNIX in your Google Account's third-party access settings if you want to revoke Google's authorization.
- Gmail is the first connector. The other catalog entries remain planned and are not functional yet.
