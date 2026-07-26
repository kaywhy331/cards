# EZ Cards

Invite-only TCG signal intelligence, personalized watch rules, device-bound browser handoff, subscription-ready membership, and an isolated AIO education lab.

## Live architecture

- **Web application:** responsive member/admin interface deployed on Netlify.
- **Persistence:** Netlify Blobs by default; optional Supabase Postgres adapter through `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- **Authentication:** one-time owner bootstrap, scrypt passwords, secure HTTP-only sessions, role checks, and single/multi-use invitations.
- **Signals:** Telegram Bot API webhook, signed background processing, manual/calendar intake, safe redirect resolution, optional official X enrichment, dynamic aliases, taxonomy classification, source/event deduplication, and personalized matching.
- **Devices:** six-character pairing, per-device authentication/signing secrets, signed job polling, exact-time one-shot alarms for cached schedules, replay protection, status reporting, and revocation.
- **Membership:** beta/individual/family entitlements, sandbox subscriptions, optional Stripe Checkout, signed webhooks, and Stripe Customer Portal.
- **Education lab:** original localized CardForge storefront, queue modes, mock human challenge, fake inventory, fake checkout, AIO task console, and downloadable MV3 extension.

## Safety boundary

The production extension can open only:

- `https://ezcards.netlify.app/local-retailer`
- `http://localhost:8888/local-retailer`
- `http://127.0.0.1:8888/local-retailer`

It has no real-retailer host permissions, cookie access, proxy API, CAPTCHA solver, queue-token transfer, payment handling, or third-party checkout automation.

## Local development

```bash
npm install
npx netlify dev
```

Open `http://localhost:8888`.

Run all completion checks:

```bash
npm run completion
```

The complete gate matrix is in `docs/COMPLETION_CRITERIA.md`.

## First production setup

1. Visit the deployment.
2. Redeem the one-time owner setup token.
3. Generate member invitations from **Admin**.
4. Optionally connect a Telegram bot from **Admin**.
5. Pair the browser extension from **Devices**.
6. Use sandbox membership until Stripe test configuration is added.

## Telegram

Add the configured bot to an owned relay channel. The webhook accepts channel posts, edited channel posts, direct forwards, and edited messages. Telegram update IDs, message identities, forwarded-source identities, X status IDs, canonical retailer listings, event windows, user matches, and device jobs are deduplicated independently.

## Supabase

Run `supabase/schema.sql`, then add the two server-only environment variables listed in `.env.example`. The server automatically switches its persistence adapter on the next deploy. Browser code never receives the service-role key.

## Secret management

Set `EZCARDS_MASTER_KEY` and `EZCARDS_INTERNAL_SECRET` as server-only Netlify environment variables before adding production integration credentials. The application can self-initialize them for an invite-only demo, but separate environment-backed secrets provide the stronger production boundary.
