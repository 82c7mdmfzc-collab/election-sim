# Historical Handoff Notes

This file is intentionally retained as an archive marker, not an active work plan.

The previous mobile-native/notifications handoff described a June 2026 branch and several interrupted tasks. The active state is now `main`.

Current active release state is documented in:

- `README.md`
- `LAUNCH_CHECKLIST.md`
- `DEPLOY.md`
- `IOS_RELEASE_GUIDE.md`
- `MONETIZATION_SETUP.md`
- `APPLE_SETUP.md`

Current facts:

- `main` is the active branch.
- Latest pushed commit is build `25` for iOS.
- TestFlight upload for build `25` succeeded with delivery UUID `e8aabaf6-9dea-4b02-a7db-e998854d690a`.
- `supabase/notifications.sql` exists and is included in DB deploy ordering.
- Local notification support exists via `@tauri-apps/plugin-notification`; remote APNs multiplayer push remains a future enhancement unless explicitly picked back up.

Do not follow old instructions that mention `.claude/worktrees`, Phase 8, uncommitted notification files, or mandatory Claude co-author commit trailers.
