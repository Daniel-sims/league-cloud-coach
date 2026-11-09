# League Cloud Coach: current project state

Last reviewed: 9 November 2026. This is the durable session handoff, not a replacement for inspecting current source, Git, and service state.

## Stream integration: deployed

The owner has activated paid Cloudflare Stream and uploaded a test recording. This supersedes the earlier decision to defer paid video hosting. Account/video identifiers were supplied for integration; no Cloudflare API credential has been provided in chat or stored in source.

Stream support adds to the existing YouTube integration: verified private video-ID import through the `stream` Supabase Edge Function, owner playback, and account-free sessions. An unused Stream share must start within seven days. The explicit start atomically binds a viewer-session capability and fixes expiry at two hours; refresh/start/renew cannot extend it. Share and session hashes stay private. A second viewer capability cannot claim a started session. Playback tokens last at most five minutes, capped by session expiry; replacement, revocation, removal, or disabling the owner prevents renewal. Already-issued tokens and buffered media can outlive revocation. Session storage is per tab; it is not a physical-viewer guarantee or a spending cap.

Migration `202611090002_stream_sessions.sql` has been applied remotely, and the `stream` Edge Function is ACTIVE with gateway JWT verification disabled as designed. Owner actions verify JWTs in the handler; public actions use database-checked capabilities. The owner configured `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` directly in Supabase. Secret names were verified without revealing values. The deployed playback endpoint returns 410 for unknown capabilities. Frontend release `fb8f23015e034547a659296efc86712669086bf9` is deployed. [Pages workflow 42710333680](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/42710333680) passed verification and deployment. A public HTTP check returned 200 and confirmed the production bundle includes Stream import, explicit Start session, and the position-preserving renewal fix.

Verification: production frontend build and Deno runtime type check passed; 47 frontend/player/handler tests and six simulated-backend browser tests passed locally and in release CI. Both SQL security suites passed on PostgreSQL 17 in release CI. Both SQL permission suites passed against disposable PostgreSQL 16 locally (CI uses PostgreSQL 17), covering ownership/grants, fixed expiry, competing viewer claims, unused-link expiry, replacement/revocation, and disabled owners. Live server-side checks confirmed the uploaded recording is ready/private (about 28 minutes), unsigned manifest requests are denied, and signed master/variant playlists plus a video segment return HTTP 200. With an eight-second diagnostic token, the manifest and segment both returned HTTP 401 after expiry. The administrator-only diagnostic function was deleted afterward; only `stream` remains deployed. Live grants deny anonymous authorization/hash reads and authenticated bypass of verified Stream import. Cloudflare signs segment URLs separately; the player reloads the playlist on renewal while preserving position/pause state and avoids repeated renewal of a final deadline-capped lease. Renewal may briefly buffer. Actual browser playback, quality/audio/seeking, device behavior, and a full two-hour session remain unverified. Automatic retention/deletion, cumulative watch allowance, and a hard billing cap remain unimplemented. Direct uploads are described below.

Next: sign in as the owner and choose Upload video for a local recording, or Add existing video → Cloudflare Stream for the already-uploaded video ID. Then create a share link and perform browser playback/renewal acceptance. The in-app browser connection is unavailable in this session, so owner UI/login and visual acceptance require a subsequent browser session. Do not administratively assign the video to an arbitrary account. Removal keeps hosted media and its ongoing storage charge.

## Direct upload extension

Direct local-file uploads are deployed alongside **Add existing video**. The library has **Upload video** with file selection, title/date, a 30–120 minute maximum-duration choice and a 30 GB file limit. The backend verifies owner identity/membership, provisions a one-time TUS destination with signed URLs required, and tags it with the verified Cloudflare creator plus an app-upload marker. The browser sends 10 MiB chunks directly to Cloudflare with progress, retries and pause/resume. No new SQL migration is required.

Pending metadata and the limited upload capability are stored in browser local storage under the owner's ID. Reopening the dialog and selecting the same file resumes the same destination without reserving another video. Processing is polled; the backend rechecks creator/marker/privacy/readiness and imports only ready media. One pending transfer is tracked per owner/browser. Closing/forgetting does not delete provider media; expired URLs and cleared browser storage may require manual recovery through the shown video ID or a new upload. There is no finalization webhook, cross-device transfer queue, automatic deletion or hard quota. Library reconciliation now recovers completed app uploads independently of browser state, as described below.

Local verification: 55 unit/component/handler tests, seven browser contract tests, production build and Deno runtime type check passed. The new browser test exercises actual TUS-client HEAD/PATCH requests against a mocked provider, waits for processing, and checks that video bytes contain no API credentials. A live Cloudflare check used the same provisioning helper and a synthetic one-second MP4 with a padding atom: an initial 5 MiB chunk was accepted, HEAD confirmed the offset, the remaining bytes resumed successfully, and Cloudflare encoded the clip to ready/private with matching creator and upload marker. Unicode titles round-tripped correctly. The synthetic video and temporary administrator-only check endpoint were deleted. Empty TUS metadata values are returned as `TRUE` by Cloudflare, so optional dates are omitted when absent and normalized before import. No personal recording was used. At the initial direct-upload release, the `stream` Edge Function was at version 2, with unsigned upload-create/status requests denied (401); the finalization fix below supersedes that backend version. Frontend release `124f6332900092e680b84333569e15d3c8f6e616` passed all verification and Pages deployment in [workflow 42717584454](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/42717584454). Public HTTP/asset checks confirmed the live bundle contains Upload video, Add existing video, Upload to Cloudflare, and Pause upload. CI passed 55 tests, seven browser checks, runtime/build checks and both PostgreSQL permission suites. The first browser-check run exposed a test race with automatic processing completion; the corrected check waits for the resulting library entry. The synthetic provider test did not create owner library records. The owner later completed a real upload, whose missing library import was recovered as described below; actual playback quality/audio remains separate acceptance.

## Upload finalization and successful-dialog fix

A real owner upload reached ready/private in Cloudflare but was absent from the account database. The earlier uploader finalized only while its dialog polled; closing the dialog could leave the file unimported. Live diagnosis matched the uploaded video's creator tag to the single enabled owner and its app-upload marker/privacy/readiness. The tested reconciliation helper recovered exactly one missing recording into that matching account, without re-uploading, changing privacy or deleting media. A live database count confirmed one Stream recording afterward. No account identity, title, provider credentials or signed URLs were copied into this document.

Migration `202611090003_stream_import_recovery.sql` is now applied. Its private `stream_imports` table and insert trigger remember imports even after library removal; service-only `list_stream_imports` supports safe reconciliation and prevents ordinary recovery from restoring deliberately removed videos. Explicit Add existing video remains available for restoration. The migration and all three permission suites passed on disposable PostgreSQL 16 locally; release CI uses PostgreSQL 17.

Source now adds authenticated upload-sync against up to 1,000 recent owner-tagged Cloudflare videos, requiring the creator, app marker and privacy flag before import. Library load reconciles ready uploads and shows processing/uploading/error notices. It polls every 15 seconds while outstanding transfers/processing exist, and refreshes on upload-dialog close. The uploader shows an explicit Upload successful / Video added to your library state only after confirmed account insertion, remains open, and offers Watch video and Back to library. Completing a transfer alone remains a processing state. Successful completion resets search/shared filters so the new entry is visible.

Verification before rollout: 61 unit/component/handler tests, eight browser contract tests, build and runtime checks pass. Browser coverage includes processing without premature success, the persistent success dialog and watch link, and library recovery with no open upload dialog. The permanent backend is deployed as `stream` version 4, and the temporary administrator-only recovery endpoint was deleted. Frontend release `1135a13156d20b955d2824b352bf252c1844c9f7` passed verification and Pages deployment in [workflow 42721883003](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/42721883003). CI passed 61 tests, eight browser checks, build/runtime checks and all three PostgreSQL permission suites. The browser recovery check advances the polling clock rather than clicking a potentially disappearing refresh button. Public asset verification confirms the successful-dialog text, both actions and the processing/filter visibility notices. Owner playback quality/audio/full-session acceptance remains separate.

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
- Add a YouTube URL or a verified private Cloudflare Stream video ID with title/optional date; search/filter/sort, rename, open playback, and remove metadata. The YouTube form also supports preview before saving.
- Explicit share creation, copy, replacement, and revocation.
- Anonymous watch pages with normal video controls and clear unavailable states. Stream adds explicit session start, one viewer-session capability, a fixed two-hour deadline, and short-lived playback leases.
- RLS and narrow SQL RPCs enforce private libraries and owner isolation. Share capability hashes are stored; raw links are shown at creation.
- Development-only local preview uses browser storage and can copy YouTube URLs. It cannot create cloud watch links or impersonate an authenticated account.
- Responsive desktop/mobile UI and native modal keyboard/focus behaviour.

The private timed workflow is **upload in Cloudflare Stream → enable Require signed URLs → add the video ID here → create a share link**. The original **YouTube Studio Unlisted upload → add link → share** workflow remains supported. The app also offers Upload video for local files directly to Cloudflare, with private playback required automatically. It does not confirm YouTube Unlisted status, manage a channel, or delete hosted videos.

## Original YouTube release verification

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

- The initial deployed release uses free YouTube hosting. The owner has now authorized paid Cloudflare Stream; its backend and frontend are deployed as described above. R2 and Supabase Storage remain unused.
- Unlisted does not mean private: recipients can forward the YouTube URL. Revoking an app link cannot revoke YouTube access or an already loaded embed.
- No public library directory and no viewer account requirement.
- Supabase Free may pause inactive projects; YouTube controls processing, limits, branding, and playback availability. Recheck provider terms/limits when making future service decisions.
- Current schema migrations: `202611090001_cloud_coach.sql` and `202611090002_stream_sessions.sql` in `supabase/migrations/`. These and `202611090003_stream_import_recovery.sql` are applied remotely. Add new migrations for changes; do not edit/reset the live schema casually.

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
