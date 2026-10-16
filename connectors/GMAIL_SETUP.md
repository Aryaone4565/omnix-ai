# Gmail connector setup (one-time)

The Gmail Worker is deployed as `omnix-connect` and uses the existing `omnix-memory` D1 database. Its encryption key is stored as a Cloudflare Worker secret. The browser page is wired to the Gmail API endpoints.

## 1. Create Google OAuth credentials

In Google Cloud Console, create/select a project for OMNIX and enable the **Gmail API**.

Configure the OAuth consent screen:
- Audience: External if this is a personal Gmail account.
- Add your own Gmail address as a test user while the app is in Testing.
- Request only the scopes used by this connector: `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/gmail.send`.

Create an OAuth client ID of type **Web application** and add this exact Authorized redirect URI:

`https://omnix-connect.aryaone4565.workers.dev/oauth/google/callback`

Google may show an unverified-app warning while the app is in testing. Only authorize your own app and your own account. Do not share client secrets in chat, GitHub, or screenshots.

## 2. Add the two Google secrets in Cloudflare

Open Cloudflare Dashboard → Workers & Pages → `omnix-connect` → Settings → Variables and Secrets. Add these as **Secrets**, not plain text variables:

- `GOOGLE_CLIENT_ID` — the OAuth client ID from Google Cloud Console.
- `GOOGLE_CLIENT_SECRET` — the matching OAuth client secret.

The `OMNIX_ENCRYPTION_KEY` secret is already configured. Never replace it after OAuth credentials have been stored, or OMNIX will no longer be able to decrypt them.

## 3. Test the connection

1. Open `https://arya4565.github.io/omnix-ai/connectors.html`.
2. Under Gmail, choose **Connect Gmail** and authorize the scopes.
3. After the redirect, open the Connected tab and refresh the inbox.
4. To send, fill in recipient, subject, and body, select **Review & send**, and confirm only after checking the exact preview.

The backend uses short-lived OAuth state, PKCE, AES-GCM encryption for stored tokens, owner-scoped database rows, one-use expiring send approvals bound to the exact email content, and redacted audit events. Disconnect removes the stored encrypted token from the connector row. Google-side access can also be revoked from the Google Account's third-party access page.

## Current limitations

- Only Gmail is implemented in this first backend.
- The Google OAuth client must be configured by the project owner; the assistant cannot create Google's OAuth credentials on your behalf.
- Gmail API access and OAuth consent/testing restrictions are controlled by Google.
- Inbox list currently shows up to 10 recent messages; message rendering is plain-text oriented.
- Never send an email without reviewing the recipient, subject, and full body.
