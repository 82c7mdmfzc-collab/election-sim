# Launch Readiness Notes

Current as of 2026-06-28.

This file is a short current-state companion to `LAUNCH_CHECKLIST.md`. Older chronological notes from June 2026 were removed because they described incomplete/manual steps that have since changed.

## Current Release State

- Public v1 target is **web + iOS first**.
- Android is a fast-follow.
- Latest iOS build uploaded to App Store Connect/TestFlight: build `25`.
- Delivery UUID: `e8aabaf6-9dea-4b02-a7db-e998854d690a`.
- `main` / `origin/main` includes the public-release readiness pass and iOS build bump.

## Current Product/Economy Truth

- Bobby Tooley is free and neutral: 300 starting cash, no synergies, no recurring income perk.
- Free candidates: Tooley, Trump, Harris, Lincoln, Joe Biden.
- Paid candidates: Reagan, Washington, Starmer, JFK at 4,500 Funds; Farage at 10,000 Funds.
- Cosmetics are live: Patriot/Gold share frames and three victory messages at 3,000 Funds each.
- Web Stripe is retired; there is no web purchase rail.
- iOS StoreKit consumables are implemented and verified server-side by `fulfill-purchase` once Apple secrets are configured.
- Rewarded ads are opt-in and server-quota-limited.

## What Is Still Manual

- Domain/DNS and final Vercel production-domain verification.
- Supabase auth provider settings and redirect allowlist.
- Supabase purchase verification secrets: `APPLE_ISSUER_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`.
- App Store Connect IAP product setup for all six funds SKUs.
- TestFlight processing, internal testing, screenshots, and App Review submission.
- Real two-device online multiplayer testing through election/game-over.

## Current Automated Gates

Known passing after the release-readiness pass:

```bash
npm run test
npm run lint
npm run build
npm run test:mobile-native
node test_vsbot_smoke.mjs
```

The production build still reports a large main JS chunk around 1.27 MB minified / 389 KB gzip. Treat code-splitting as a post-v1 performance follow-up unless real iOS startup testing shows it is launch-blocking.

## Active Reference

Use this file, `LAUNCH_CHECKLIST.md`, and the source code as the active release reference.
