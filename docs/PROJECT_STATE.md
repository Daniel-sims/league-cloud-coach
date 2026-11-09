# League Cloud Coach: current project state

Last reviewed: 9 November 2026. This is the durable session handoff, not a replacement for inspecting current source, Git, and service state.

## Product and deployment

- Live app: https://daniel-sims.github.io/league-cloud-coach/
- Standalone source: https://github.com/Daniel-sims/league-cloud-coach (`main`). It is a public, web-only repository for free GitHub Pages hosting.
- Supabase project ref: `qxzjulhpgcnwkihnfdqu`, region `eu-west-2`, PostgreSQL 17. Project refs and URLs are public configuration, not credentials.
- Supabase API URL: `https://qxzjulhpgcnwkihnfdqu.supabase.co`.
- Google callback: `https://qxzjulhpgcnwkihnfdqu.supabase.co/auth/v1/callback`.
- Production base path: `/league-cloud-coach/`. Local dev defaults to `/` at `http://127.0.0.1:5173/`.
- GitHub Pages uses `.github/workflows/cloud-coach-web.yml`, not a manually committed build branch.
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are configured as repository variables. Google credentials live in Supabase's provider settings. Read `web/.env.example` for local variable names; do not copy secret values into this file.

The hosted database, auth redirects, Google provider, and owner membership are configured. The user confirmed successful Google sign-in; one verified Google account was explicitly granted owner access. Other accounts do not automatically receive a library. Do not recreate the project, bootstrap another owner, or rotate credentials merely because a new session has started.

## Implemented behaviour

- Google login/logout and owner-only library management.
- Add a YouTube URL with title/optional date; validate/preview, search/filter/sort, rename, open playback, and remove metadata.
- Explicit share creation, copy, replacement, and revocation.
- Anonymous watch pages with normal YouTube controls and clear unavailable states.
- RLS and narrow SQL RPCs enforce private libraries and owner isolation. Share capability hashes are stored; raw links are shown at creation.
- Development-only local preview uses browser storage and can copy YouTube URLs. It cannot create cloud watch links or impersonate an authenticated account.
- Responsive desktop/mobile UI and native modal keyboard/focus behaviour.

The manual workflow is **upload as Unlisted in YouTube Studio → add its link here → create a share link**. The web app does not upload files, confirm Unlisted status, manage a channel, or delete YouTube videos.

## Verification at handoff

- 34 frontend tests passed, including callback errors, URL validation, and library interactions.
- Five browser tests passed: local library workflow, mobile/focus behaviour, unavailable links, simulated owner-to-guest sharing/revocation, and non-owner UI.
- GitHub CI passed those checks and real PostgreSQL permission tests; Pages deployment succeeded.
- The published site, base-path assets, anonymous unknown-link resolution, reload behaviour, and production/local-preview separation were checked in Chrome.
- Live Supabase anonymous requests were denied library/token-table enumeration and recording mutations.
- After actual Google login, a rollback-only smoke test checked the real owner's add/rename/share/anonymous-resolve/revoke/remove RPC flow. Exactly one owner membership was enabled, and no test recording was retained.

The owner's own full-game YouTube recording has not been provided for browser playback acceptance. Do not claim its quality, audio, full duration, or timeline alignment has been tested. Adding and watching that recording is the next useful product acceptance step.

## Resolved setup issues

- `redirect_uri_mismatch`: the Pages URL had been placed in Google's redirect field. The Supabase callback belongs under Authorised redirect URIs; the Pages origin belongs under Authorised JavaScript origins.
- `invalid_client` during provider code exchange: Google client credentials needed correction. The user updated them and confirmed sign-in worked. Use the full secret from the matching OAuth client, never Google's masked display value.
- The initial generic app error incorrectly suggested every provider failure was cancellation. `web/src/lib/auth-errors.ts` now distinguishes configuration/server errors from user cancellation without echoing provider codes or secrets.

Use the exact error and bounded auth logs to diagnose future failures. A successful redirect to Google proves neither successful token exchange nor working owner authorization.

## Accepted decisions and limitations

- Keep this initial release on free services. Paid Cloudflare Stream was considered and rejected for now. R2 and Supabase Storage are not part of this implementation.
- Unlisted does not mean private: recipients can forward the YouTube URL. Revoking an app link cannot revoke YouTube access or an already loaded embed.
- No public library directory and no viewer account requirement.
- Supabase Free may pause inactive projects; YouTube controls processing, limits, branding, and playback availability. Recheck provider terms/limits when making future service decisions.
- Current schema migration: `supabase/migrations/202611090001_cloud_coach.sql`. It is applied remotely. Add new migrations for changes; do not edit/reset the live schema casually.

## Planned work, not implemented

1. A separate macOS companion with the same Supabase account identity, reuse of existing capture, and a durable upload queue.
2. Automatic YouTube uploads after explicit channel authorization. Google identity login alone does not grant `youtube.upload`; recheck API/OAuth requirements when implementing it.
3. Versioned export/import of match identity, recording/game-clock anchors, and structured review timeline events.
4. A web timeline matching the existing League Helper review experience, then annotations and coach feedback with an explicit ownership model.
5. Broader user onboarding only when intentionally opening the product beyond its initial owner.

No ordering or implementation beyond the current release should be inferred as already authorized by the roadmap.

## Native integration and source ownership

The original workspace is League Helper, an implemented local SwiftUI/GRDB app. Cloud Coach's initial source is also kept under its `web/` and `supabase/` directories. `scripts/export-cloud-coach.py` exports only the web application and documentation into a separate checkout for `Daniel-sims/league-cloud-coach`; it is a copy operation, not automatic bidirectional sync. Inspect both checkouts before exporting so unrelated edits are not overwritten. The exporter also supplies the standalone root README and `AGENTS.md` from canonical web documents.

Temporary export directories used during development are disposable. In a fresh environment, clone the standalone repository or work from the original workspace; do not assume a prior `/private/tmp` checkout or server still exists. Native code and history must not be published into the public web repo.

Agent entry points are maintained explicitly: root `AGENTS.md` in the native workspace covers repository boundaries and native conventions; `web/AGENTS.md` is the canonical web/backend guide and is also exported as the standalone root `AGENTS.md`. The standalone root README is the full `web/README.md` with links rebased. Export includes this state file and the implementation plan, so future agents need no access to the original chat or native checkout to understand the web project.

Native capture writes HEVC/AAC MOV originals under `~/Movies/League Helper/`. Capture implementation is currently app-target code. The silent, low-frame-rate AI proxy is unsuitable for coaching playback. Preserve game/video clock anchors for later timelines. See the original workspace's `CLAUDE.md` and capture/review research before changing native behaviour; those native files are intentionally absent from the standalone web repository.

## Updating this handoff

After meaningful work, update the date, implemented behaviour, verification, remaining acceptance work, and deployment pointers as needed. Keep credentials and personal account data out. Keep architectural rationale in `docs/league-cloud-coach-web-plan.md` and repeatable operational steps in `web/README.md`. Check current Git/CI/service state instead of treating historical test counts or a previous deployment as a new verification.
