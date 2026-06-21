# Apple setup — Sign in with Apple & in-app purchases

Project facts you'll reuse below:

| Thing | Value |
| --- | --- |
| App bundle id | `com.playelector.app` |
| Supabase project | `rwavsfyjjqfwefabcfvv.supabase.co` |
| Supabase OAuth callback | `https://rwavsfyjjqfwefabcfvv.supabase.co/auth/v1/callback` |
| Web domains | `playelector.com`, `www.playelector.com` |
| Native deep link | `com.playelector.app://auth-callback` |

---

## Part 1 — "Sign in with Apple" (do this now)

This is **two dashboards + one code flag**. No purchases involved. When it's done, tell me and
I'll flip the flag and deploy.

### Step A — Apple Developer portal
Go to <https://developer.apple.com/account/resources> → **Certificates, Identifiers & Profiles**.

1. **App ID** — open the identifier `com.playelector.app` (or create it). Under Capabilities,
   tick **Sign In with Apple**. Save.

2. **Services ID** (this is the *web* OAuth client id) — Identifiers → **+** → **Services IDs**.
   - Description: `Elector Web Sign In`
   - Identifier: `com.playelector.signin`  ← remember this exact string
   - After creating, open it, tick **Sign In with Apple**, click **Configure**:
     - **Primary App ID:** `com.playelector.app`
     - **Domains and Subdomains:** `playelector.com`, `www.playelector.com`,
       `rwavsfyjjqfwefabcfvv.supabase.co`
     - **Return URLs:** `https://rwavsfyjjqfwefabcfvv.supabase.co/auth/v1/callback`
   - Save.

3. **Key** — Keys → **+**.
   - Name: `Elector Sign In Key`
   - Tick **Sign In with Apple**, Configure → Primary App ID `com.playelector.app`.
   - **Download the `.p8` file** — you only get one chance. Store it somewhere safe.
   - Note the **Key ID** (10 chars, shown on the key page).

4. **Team ID** — top-right of the portal (Membership), a 10-char string.

You now have four values: **Services ID** (`com.playelector.signin`), **Team ID**, **Key ID**,
and the **`.p8` private key** file.

### Step B — Supabase dashboard
Dashboard → your project → **Authentication → Providers → Apple** → toggle **ON**.

- **Client IDs:** `com.playelector.signin` (the Services ID). You can also add the bundle id
  `com.playelector.app` here for future native use, comma-separated.
- **Secret Key (for OAuth):** Supabase builds the client secret from your **Team ID**, **Key ID**,
  Services ID, and the **`.p8`** contents. Paste/enter those where the Apple provider screen asks.
  (Supabase's provider page has a "generate a new secret" helper — feed it the four values.)
- Save.

Then **Authentication → URL Configuration → Redirect URLs** — confirm these are present (they
already should be per `DEPLOY.md`):
`https://playelector.com`, `https://www.playelector.com`, `http://localhost:5174`,
`com.playelector.app://auth-callback`.

### Step C — Flip the code flag (I do this)
Once Step B is saved, tell me. I flip `APPLE_SIGNIN_ENABLED` from `false` to `true` in
`src/utils/authClient.ts`, rebuild, and `vercel --prod`. Until then the Apple button shows a
friendly "coming soon" message instead of erroring, so nothing is broken in the meantime.

### How to test
On `playelector.com`, open the account pill → the Apple button should start a real Apple OAuth
flow (no "coming soon") and return you signed in.

---

## Part 2 — Apple in-app purchases (BUILT — finish the manual setup)

Native StoreKit purchases are implemented: the app uses `tauri-plugin-iap` (StoreKit 2), the
client forwards the signed-transaction JWS to `supabase/functions/fulfill-purchase`, and
`verifyApple()` validates it against the App Store Server API before `fulfill_purchase` credits the
funds. **Web purchasing (Stripe) has been removed** — funds are bought only in the iOS app.

Four manual steps remain (none are code):

1. **Paid Apps Agreement** — App Store Connect → Business (Agreements, Tax, and Banking): accept
   the Paid Apps agreement and complete tax + banking. IAP will not function (even in sandbox)
   until this shows **Active**.

2. **Create the 4 Consumable products** (Monetization → In-App Purchases). Product IDs must match
   the app's SKUs **exactly**, with per-territory prices:

   | Product ID | Type | USD | GBP |
   | --- | --- | --- | --- |
   | `funds_1500` | Consumable | $2.99 | £1.99 |
   | `funds_4000` | Consumable | $4.99 | £3.99 |
   | `funds_9000` | Consumable | $8.99 | £7.99 |
   | `funds_20000` | Consumable | $14.99 | £14.99 |

   Other territories take Apple's auto price matrix from the USD tier. Characters are unlocked with
   in-game funds, so they need **no** App Store products.

3. **App Store Connect API key (In-App Purchase)** — Users and Access → Integrations → In-App
   Purchase → generate a key. Note the **Issuer ID** + **Key ID** and download the `.p8` (once).
   Set them as Supabase Edge Function secrets (server-side only — never in the client bundle):

   ```bash
   supabase secrets set APPLE_ISSUER_ID=...      # from App Store Connect
   supabase secrets set APPLE_KEY_ID=...         # the IAP key's Key ID
   supabase secrets set APPLE_PRIVATE_KEY="$(cat AuthKey_XXXX.p8)"
   ```

   Until these are set, `verifyApple()` fails closed (503) and no purchase is credited.

4. **Sandbox test** — create a Sandbox Apple ID (Users and Access → Sandbox), or add a local
   `.storekit` config in Xcode for the Simulator. Buy each pack and confirm the balance updates.

> Note: the Sign-in `.p8` (Part 1) and the IAP `.p8` (this part) are **different keys** for
> different purposes. Don't reuse one for the other.
