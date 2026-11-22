# Security policy — Bro Client

## Reporting
Report sensitive security issues privately to the project owner through the official support channel. Never paste secrets, license keys, customer data, or exploit details in a public GitHub issue.

## Secrets
Store provider credentials only as **Sensitive** environment variables on Vercel. Rotate Discord webhook tokens, Bot Tokens, Whop API tokens, Supabase keys, and license encryption keys immediately if exposed.

The site repository is currently public: never commit `.env`, `BroClient.exe`, license keys, webhook URLs, raw OAuth tokens, or Whop payment information.

## Access control
- Authentication: Discord via Supabase, session cookies HttpOnly + Secure.
- Orders: grant entitlements only from verified Whop payment webhooks with a trusted account-to-Discord association.
- Downloads: private Vercel Blob, streamed only after checking the authenticated user's active entitlements.
- Keys: AES-256-GCM encryption at rest, customer session validation before display/copy/download.
- `/startkey`: signed Discord interaction, server ID, designated staff channel and exact operator ID.
- Admin uploads: verified administrator session and exact expected binary SHA-256.
- Browser cannot see Vercel Blob credentials, Whop credentials, Discord webhook URLs or encryption keys.

## Required operational setup
1. Configure Whop API and signed webhook, the four freshly rotated notification webhooks, and Discord bot credentials in Vercel Production.
2. Set `BRO_DISCORD_OWNER_USER_ID` to the exact Discord user ID authorized to execute `/startkey`.
3. Register application commands after the bot keys are configured.
4. Upload the approved executable through the admin panel, not GitHub.
5. Enable GitHub branch protection on `main` (require reviews and status checks), two-factor authentication, secret scanning and Dependabot alerts via repository settings.

## Incident response
Immediately rotate a disclosed token at its provider, replace the matching Vercel environment secret, and redeploy. Review provider logs and revoke affected sessions. Do not assume removing a secret from the repository history makes it safe to reuse.
