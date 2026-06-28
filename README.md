# Elector

Elector is a turn-based strategy game about winning the US Electoral College. Players spend campaign funds across states and national networks, build coalition income, secure states, and race to 270 electoral votes.

## Release Target

Public v1 is focused on **web + iOS**. Android assets/config are present, but Android is treated as a fast-follow release after web and TestFlight/App Store verification.

## Stack

- React 19, TypeScript, Vite, Zustand
- Supabase Auth, Postgres RPCs, Realtime, and Edge Functions
- Tauri 2 for native iOS wrapping
- PostHog analytics
- Optional iOS StoreKit IAP and optional rewarded ads

## Commands

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 5174
npm run test
npm run lint
npm run build
npm run test:mobile-native
node test_vsbot_smoke.mjs
```

`test_vsbot_smoke.mjs` expects a dev server on `http://localhost:5174`.

## Release Gates

- Web domain, `/privacy`, `/support`, and account deletion path verified in production.
- Supabase SQL applied in dependency order by `.github/workflows/deploy-db.yml`.
- Edge functions deployed by `.github/workflows/deploy-functions.yml`.
- Email, Google, and Apple auth configured; anonymous auth disabled.
- Two-device online multiplayer completes through election/game-over.
- iOS TestFlight verifies guest solo, sign-in, online play, StoreKit prices, purchase fulfillment, rewarded ads, safe-area/orientation, and screenshots.

## Economy Notes

The v1 monetization posture is a fair soft launch. Paid candidates are earnable sidegrades, not direct cash purchases, and cosmetics are the preferred repeat-spend sink. There is no web Stripe rail; Campaign Funds IAP is native iOS only.
