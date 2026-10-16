# Gmail connector setup

The Gmail connector is deployed as `omnix-connect` and uses the existing `omnix-memory` D1 database. Its Worker source and Wrangler config are in `connectors/worker.js` and `connectors/wrangler.jsonc`.

## 1. Google OAuth

In Google Cloud Console, enable the **Gmail API** for the OMNIX project. Configure the OAuth consent screen; for personal testing, add your own Google account as a test user while the app is in Testing.

Create a **Web application** OAuth client and add this exact Authorized redirect URI:

`https://omnix-connect.aryaone4565.workers.dev/oauth/google/callback`

## 2. Cloudflare settings

- `GOOGLE_CLIENT_ID`: public client identifier; already present as a text variable and in `connectors/wrangler.jsonc`.
- `GOOGLE_CLIENT_SECRET`: add as a Cloudflare **Secret** on the `omnix-connect` Worker.
- `OMNIX_ENCRYPTION_KEY`: already configured as a secret. **Do not replace it**, or previously encrypted tokens would become unreadable.
- `OMNIX_DB`: existing D1 binding to `omnix-memory`; the four connector tables are present.

Never commit secrets, access tokens, or refresh tokens to GitHub or share them in chat/screenshots.

## 3. Test

1. Open `https://arya4565.github.io/omnix-ai/connectors.html`.
2. Choose **Connect Gmail** and authorize the requested read/send scopes.
3. After redirect, check the Connected tab and refresh the inbox.
4. For sending, inspect the exact recipient, subject, and body before confirming.

## Current limitations

- Only Gmail is implemented in this first backend; other connector catalog entries are planned.
- Inbox listing returns up to 10 recent messages and message display is plain-text oriented.
- Google's OAuth consent/testing restrictions apply. Testing-mode refresh tokens for Gmail scopes may expire after seven days.
- Disconnect removes the stored OMNIX credential but does not necessarily revoke the Google-side grant.
