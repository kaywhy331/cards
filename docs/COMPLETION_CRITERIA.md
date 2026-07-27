# EZ Cards MVP completion criteria

The MVP is complete only when every **implementation** and **deployment** gate below passes. External providers remain credential-gated until the workspace owner supplies their own Telegram, X, Stripe, or optional Supabase credentials.

## 1. Build and isolation

- `npm run validate` passes.
- All JavaScript and Netlify function modules parse under Node 22.
- The static site builds into `dist/`.
- The MV3 extension archive is valid.
- The extension is limited to `ezcards.netlify.app`, `localhost:8888`, and `127.0.0.1:8888`.
- The educational lab contains no real-retailer host permission, cookie API, proxy API, CAPTCHA solver, queue-token transfer, or payment integration.

## 2. Centralized membership and persistence

- Netlify Blobs provides zero-configuration production persistence.
- The optional Supabase adapter activates only when server-only credentials are present.
- One-time owner bootstrap, invite-only registration, login/logout, scrypt password hashing, secure sessions, roles, plans, suspension, and invitations pass automated tests.
- Members can manage watch rules; administrators can manage users and invitations.

## 3. Signal intake and classification

- Telegram structured entities and emoji/UTF-16 offsets parse correctly.
- Telegram update IDs, source identities, forwarded/X source identities, content fingerprints, retailer listings, canonical events, member matches, and device jobs have independent deduplication.
- Edited messages create linked versions rather than disappearing as duplicates.
- Short links resolve once with redirect-chain persistence and private-network blocking.
- X post enrichment is implemented through the official API when an owner token is configured.
- Dynamic aliases and curator corrections update canonical classification.
- Live restock, status update, sold out, scheduled drop, presale, deadline, and announcement intent paths are covered.
- Telegram webhook work is dispatched to a signed background function with an inline fallback.

## 4. Personalized execution

- Rules implement AND across categories, OR within categories, and exclusion precedence.
- Each user/event combination creates at most one active execution job.
- The extension pairs with short-lived codes, authenticates per device, verifies HMAC-signed plans, prevents replay by plan version, and supports revocation.
- Scheduled jobs are cached locally and activated with one-time browser alarms.
- The extension can open only `/local-retailer`, `/retailer-lab`, or `/retailer-lab.html` on an approved EZ Cards origin.
- Queue state, mock challenge, readiness, and completion are reported back without sending page contents.

## 5. Membership billing

- Beta, Individual, and Family entitlements are enforced.
- Stripe Checkout, signed webhook processing, duplicate event rejection, subscription-state updates, and Customer Portal session creation are implemented.
- Sandbox plan activation remains available before Stripe setup and is disabled for ordinary members after Stripe is connected.
- No payment-card data is accepted or stored by EZ Cards.

## 6. Localized education environment

- `/local-retailer` serves an original same-origin CardForge storefront replica.
- The storefront demonstrates product, pre-queue, queue, mock human verification, purchase window, fake checkout, and fake receipt states.
- `/lab.html` demonstrates task groups, queue modes, synthetic account/device/route profiles, duplicate-session defenses, mock challenges, fake inventory races, and idempotent fake orders.
- Both pages display permanent education/simulation boundaries.

## 7. Deployment

- GitHub CI passes validation, all automated tests, build, static markers, and extension archive verification.
- Netlify Deploy Preview returns HTTP 200 for the web app, API health, AIO lab, local retailer, and extension archive.
- After merge, the production smoke workflow verifies version `0.5.1` and the same endpoints at `https://ezcards.netlify.app`.

## Credential activation gates

These do not block code completion, because they require owner-controlled third-party secrets:

- **Telegram live intake:** owner enters a BotFather token; EZ Cards validates it and registers the webhook.
- **X enrichment:** owner enters an official X API bearer token.
- **Stripe billing:** owner enters Stripe secret key, webhook secret, and Price IDs.
- **Supabase:** owner applies `supabase/schema.sql` and supplies server-only project credentials; otherwise Netlify Blobs remains the active production database.
