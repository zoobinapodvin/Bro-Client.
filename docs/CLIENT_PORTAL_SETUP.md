# Bro Client — Client panel, Whop, Discord and key fulfillment

## What is implemented
- Responsive Discord account panel, sign-in and **local** disconnect action.
- Refresh of verified purchases saved from signed Whop webhooks (not unverified claims).
- Private `BroClient.exe` download **only when a current paid entitlement exists**.
- License keys encrypted at rest (AES-256-GCM), with Copy and TXT download for the verified purchaser.
- Signed `/startkey` Discord command restricted to one exact operator ID and channel `1574104734124605460`.
- Separate purchase notifications for the four products after a verified, linked Whop payment.
- Admin-only upload of the exact executable supplied by the owner.
- GitHub secret hygiene, Dependabot, tests, CSP and same-origin protection.

## The exact variables required in Vercel **Production**
| Variable | Source | Status |
|---|---|---|
| `BRO_DISCORD_SUPABASE_PUBLISHABLE_KEY` | Supabase public API key | Already configured |
| `BRO_DISCORD_GUILD_ID` | Discord guild | Already configured |
| `BRO_DISCORD_CUSTOMER_ROLE_ID` | Customer role | Already configured |
| `BRO_DISCORD_LIFETIME_ROLE_ID` | Lifetime role | Already configured |
| `BRO_KEY_ENCRYPTION_KEY` | Random 256-bit AES key | Already configured; keep Sensitive |
| `BLOB_READ_WRITE_TOKEN` | Vercel private Blob store | Already configured |
| `BRO_DISCORD_BOT_TOKEN` | Developer Portal > Bot | Configure as Sensitive |
| `BRO_DISCORD_APPLICATION_ID` | Developer Portal > General Information | Configure |
| `BRO_DISCORD_PUBLIC_KEY` | Developer Portal > General Information | Configure |
| `BRO_DISCORD_OWNER_USER_ID` | **Your** exact Discord user ID, for /startkey | Configure |
| `WHOP_API_KEY` | Whop seller API credentials | Configure as Sensitive |
| `WHOP_ACCOUNT_ID` | Whop business/account ID | Configure |
| `WHOP_WEBHOOK_SECRET` | Signing secret for the Whop payment webhook | Configure as Sensitive |
| `BRO_DISCORD_WEBHOOK_DAY` | **Newly rotated** plan-day webhook URL | Configure as Sensitive |
| `BRO_DISCORD_WEBHOOK_WEEK` | **Newly rotated** plan-week webhook URL | Configure as Sensitive |
| `BRO_DISCORD_WEBHOOK_MONTH` | **Newly rotated** plan-month webhook URL | Configure as Sensitive |
| `BRO_DISCORD_WEBHOOK_LIFETIME` | **Newly rotated** lifetime webhook URL | Configure as Sensitive |

**Important:** The four Discord webhook URLs pasted into chat contain bearer secrets. Delete/regenerate them in Discord before use and keep the new URLs in Vercel only. Do not commit them or paste them into support tickets.

After configuring env variables, **redeploy Production** to apply them.

## Whop webhook
Configure the Whop `payment.succeeded` webhook to POST at:
`https://www.broclient.com/api/whop/webhook`

The server validates Whop's signature and then retrieves the authoritative payment data. The payment must contain checkout metadata matching an order created for a Discord-authenticated user. Only then will roles, customer download entitlement and plan notifications be processed.

**Guest purchases and historic purchases without a reliable Discord link are not attributed automatically.** Customers should open a support ticket for reconciliation. A browser refresh alone cannot attach those old payments to a Discord account.

The payment webhook should include the confirmed amount, Whop user ID (when Whop returns it), transaction ID, plan, and the Discord mention when linked. Keys are never sent through webhooks.

## Release upload
The supplied `BroClient.exe` is **not** stored in the public repository. To upload, sign in with the recognized administrator Discord account, open the customer dashboard, select the same `BroClient.exe` in the admin import panel and click **Importer BroClient.exe**.

The server checks the executable format, exact file size, and approved SHA-256 before storing it in **private** Vercel Blob. A byte-different executable is rejected. A binary integrity check **does not certify that the program is safe or malware-free**.

## Discord bot setup
Once all bot variables are configured, the admin dashboard can register:
- `/bro statut`
- `/bro acces`
- `/startkey acheteur:@DiscordUser cle:LICENSE-KEY`

Only the ID set as `BRO_DISCORD_OWNER_USER_ID` can run `/startkey`, and only in `1574104734124605460`. The selected Discord user must have a verified **active** purchase. The bot will give an ephemeral acknowledgement; it does **not** display the key in a public channel. A second assignment is rejected rather than overwriting an existing key.

A customer with a verified active pass and no key sees the **support ticket** invitation in their account. A user with no purchases sees no key assignment invitation or key download.

## Final validation checklist
1. Whop credentials and signed webhook enabled, four new Discord webhooks stored only in Vercel.
2. Discord bot token, application ID, public key and exact owner ID configured.
3. Admin imports the exact approved EXE using the private uploader.
4. Bot commands registered.
5. Make a paid test purchase from a Discord-authenticated test account.
6. Confirm the notification, transaction ID, Whop ID, mention and Customer/Lifetime roles.
7. Use `/startkey` in the staff channel for that test purchaser; verify key copy/TXT.
8. Confirm no direct download or key access is possible without an active purchase.
9. Rotate any exposed secrets and enable GitHub branch protection, reviews, secret scanning and 2FA.

## Discord disconnect
The dashboard's **Déconnecter Discord** button signs the browser out and clears local session cookies. It deliberately does **not** delete the Discord account's trusted purchase association, to avoid locking customers out of licenses. Full identity unlinking requires a second sign-in method and a separate account-recovery design.
