# Agent guide: League Cloud Coach

All paths and commands below are relative to the repository root, even when this guide is read from `web/AGENTS.md`. In the standalone repository this same guide is exported as root `AGENTS.md`.

## Start of session

1. Read the product README (`web/README.md`, also exported as root `README.md` in the standalone repository).
2. Read `docs/PROJECT_STATE.md` for the current deployment, verified state, and outstanding acceptance work.
3. Read `docs/league-cloud-coach-web-plan.md` for design decisions and native integration findings. Its implementation-order sections explain the original plan; they are not evidence that completed work is still pending.
4. Inspect Git status, branch, and remotes. Do not overwrite unrelated edits. Read the files relevant to the task before changing architecture or recreating services.

## Intent and current scope

Help a League player share full game recordings with a coach and eventually review them with League Helper's timeline experience. The current release is a working video library and account-free watch page, not the complete review platform.

- Google sign-in uses Supabase Auth and PKCE.
- Only explicitly enabled owner memberships can manage a library. Additional Google accounts may authenticate but gain no management permission automatically.
- The owner can upload a local file directly to Cloudflare through the app, add an existing private Stream video ID, or add a YouTube Studio **Unlisted** URL. There is no automatic YouTube channel access.
- Anonymous viewers resolve a share capability and watch with ordinary video controls. Stream requires explicit session start; YouTube retains unlisted playback. They cannot enumerate a library or mutate recordings.
- Home includes saved Riot profiles, current ranks, cached match history/scoreboards and native-style stats.
- Video pages have the native-style review timeline: the owner attaches a synced game (its Riot timeline is fetched once by the backend and stored with the recording), syncs the game clock, and both the owner and anyone with the watch link add timestamped comments. League Helper can now Push to web: local timeline preparation and ultimate detection, then original-video upload and reduced review publication through an approved upload-only companion capability. Match-level notes, AI review and automatic YouTube uploads remain planned.
- Cloudflare Stream is now an authorized optional paid provider, with its backend deployed. Keep existing YouTube recordings working. See the Stream setup/limitations in the README and current handoff before publishing.

## Architecture and source map

| Path | Responsibility |
|---|---|
| `web/src/App.tsx` | Account state, library, forms/dialogs, owner video pages, public watch routes |
| `web/src/components/Home.tsx`, `Loadout.tsx`, `web/src/league.css` | Owner Home, profile/champion selection, stats, history and scoreboard UI |
| `web/src/lib/league.ts`, `league-repository.ts` | Native-matched stats/filter rules and private profile/match repository |
| `supabase/functions/riot/` | Verified owner-only Riot requests, encrypted per-owner tokens, request budget and persisted match cache |
| `web/src/main.tsx` | Completes the OAuth callback before rendering the app |
| `web/src/lib/supabase.ts` | Browser Supabase client, RPC repository, PKCE handoff, app URLs |
| `web/src/lib/auth-errors.ts` | Safe classification of provider errors without echoing codes/secrets |
| `web/src/lib/youtube.ts` | Validates URLs/IDs; never accepts arbitrary iframe HTML |
| `web/src/lib/local.ts` | Development-only localStorage preview, never a cloud/auth substitute |
| `web/src/components/Player.tsx`, `SeekControls.tsx` | YouTube playback and shared 1/10/30-second seek controls |
| `web/src/components/VideoReview.tsx`, `TimelineRows.tsx`, `web/src/review.css` | Review timeline beside the player: events, comments, clock sync, game attachment |
| `web/src/lib/review-timeline.ts`, `review.ts` | Port of native `ReviewTimeline.swift` detectors and clock anchor; owner/watch-link review repositories |
| `supabase/functions/riot/timeline.ts` | Reduces a Riot match timeline to the stored review payload (no puuids/Riot IDs) |
| `web/src/lib/theme.ts`, `web/src/theme.css` | Browser-local light/dark preference and appearance overrides; bottom Settings navigation |
| `web/src/components/UploadDialog.tsx`, `web/src/lib/uploads.ts` | Direct private TUS upload, progress/pause/resume, per-owner browser recovery, library reconciliation and confirmed success state |
| `web/src/components/StreamPlayer.tsx` | Private HLS playback, explicit session start, fixed deadline, playlist renewal |
| `supabase/functions/companion/`, `web/src/components/CompanionConnection.tsx` | Upload-only native connection approval/revocation, provider-verified upload and strict reduced-review publication |
| `supabase/functions/stream/` | Verified Stream import, owner playback, anonymous session authorization and short playback leases |
| `web/src/components/Dialog.tsx` | Native modal dialog, focus restoration, Escape handling |
| `web/src/styles.css` | Responsive neutral visual system with restrained accents |
| `web/src/**/*.test.*` | Vitest/component tests |
| `web/e2e/` | Chrome/Chromium UI and simulated cloud-contract tests |
| `supabase/migrations/` | Append-only PostgreSQL schema/permission changes |
| `supabase/tests/` | Disposable-database ownership/security checks |
| `.github/workflows/cloud-coach-web.yml` | Tests first, then builds/deploys GitHub Pages |

This is a static React/TypeScript/Vite client, not a Next.js application. GitHub Pages runs no server handlers. Supabase RPCs implement library/share operations; `supabase/functions/stream/` handles verified owner actions and private playback leases. Video bytes come directly from YouTube or Cloudflare. The upload backend provisions one-time TUS destinations; video bytes upload directly to Cloudflare. There is no object-storage bucket. Stream backend secrets and deployment are configured; inspect current handoff for frontend publication and actual playback verification.

## Data and access rules

- Keep `owner_memberships`, `recordings`, and `recording_shares` private with row-level security and explicit grants. A frontend email check is not authorization.
- Owner mutations run through narrow RPCs. Derive identity from `auth.uid()` and enforce membership/ownership server-side.
- Keep privileged SQL functions' `search_path` fixed, references schema-qualified, and execution grants explicit. The private helper schema is not a public API.
- Share tokens are random 256-bit capabilities. Store hashes only; show the raw token at creation. Replacing a share deliberately revokes its predecessor.
- Anonymous resolution returns only display metadata, provider IDs, and the session deadline. Do not expose account identities, token hashes, or directory endpoints.
- YouTube revocation/removal invalidates only the app link. For Stream, stop issuing five-minute playback leases; existing tokens and buffered media can outlive revocation briefly. A Stream session starts only on explicit claim, binds to a hashed viewer capability, and has a fixed two-hour deadline. Unused Stream shares expire after seven days. Only service-role RPCs may authorize leases or insert verified Stream metadata. Removing library metadata never deletes the YouTube video.
- Upload actions must verify the JWT and enabled membership before reserving capacity. Provision signed-URL-required media and tag the Cloudflare creator with the verified owner. Finalization must recheck creator, upload marker, privacy and ready state before insertion. No file bytes or Cloudflare API credentials pass through the frontend/backend API.
- `stream_imports` is private service-only import history, maintained atomically by a recordings insert trigger. It survives library removal so reconciliation does not intentionally restore removed entries. Never let anonymous/authenticated clients enumerate or erase this history.
- A pasted URL cannot prove channel ownership or Unlisted visibility. Do not imply either is verified by the basic embed preview.
- Migrations are append-only once applied. Do not reset the live project or run `supabase/tests/bootstrap-local.sql` there.
- League profiles/matches have RLS and no anonymous/authenticated direct table grants. Enabled owners list only their own data through RPCs; only the verified Riot backend writes API-derived data. Settings submits user-entered Riot tokens once for validation and encrypted backend storage; never store them in browser persistence or return them from an API. Preserve `RIOT_TOKEN_ENCRYPTION_KEY` across deploys. Credential table access is service-only, with owner identity derived from verified JWTs. Tokens must never be added to public watch resolution. Watch links deliberately expose the attached game's reduced review payload (champions, team slots, positions, events, item purchases) through `get_shared_review`; never add puuids, Riot IDs, summoner names or raw match payloads to it. Review comments are written through narrow RPCs: owners by membership, guests by a valid watch link plus a per-browser author key whose hash is stored. Guests edit/delete only their own comments; owners edit their own and may delete any on their recordings. Revocation/expiry ends guest review reads and writes. Preserve native remake, role-scoping, ratio, opponent and patch/split semantics in `league.ts`; tests and the README record the parity limits.

## Authentication and deployment constraints

- Keep hash routing (`/#/library`, `/#/watch/<token>`) for Pages deep links. Respect the repository base path in Vite builds and OAuth callbacks.
- The Google authorised redirect URI is the **Supabase** `/auth/v1/callback` URL. The Pages origin belongs in Google's separate authorised JavaScript origins field.
- Google client ID and secret must belong to the same OAuth client. A masked secret is unusable. See `web/README.md` for the tested setup and failure diagnosis.
- PKCE must start and finish in the same browser. Remove response codes/errors from history, and never echo provider descriptions that can contain one-time codes.
- Keep the YouTube iframe origin/referrer behaviour; suppressing the referrer can cause error 153.
- Build configuration may contain a publishable Supabase key or legacy anon key. Never bundle `service_role`, `sb_secret_…`, Google secrets, management tokens, or refresh tokens.
- `web/.env.local`, backend function `.env` files, and Supabase `.temp` state are ignored. Cloudflare API credentials belong only in backend secrets; never bundle them. Use existing CLI logins/connections; do not copy credentials into Git or handoff documents.
- The GitHub workflow uses repository **variables** for public build configuration. It skips deployment until configured and rejects private keys. A successful push is not proof of successful deployment; check the run result when publishing changes.
- `supabase/config.toml` describes local development. Do not blindly push local auth defaults into the live service. Preview any hosted config changes and preserve unrelated settings.

## Local development and checks

Requires Node.js 24 and npm:

```sh
cd web
npm ci
npm run dev
npm test
npm run build
npm run test:browser
```

`npm run test:browser` uses installed Chrome on macOS, otherwise Playwright Chromium (`npx playwright install chromium`). Its backend is simulated; never describe those tests as real Google login or live Supabase authorization checks. CI independently runs real SQL permission tests against PostgreSQL 17. Setup, database-test commands, and browser limitations are in `web/README.md`.

Use appropriate checks for the change. Prose-only changes need link/path and export checks, not native builds or repeated full browser runs. Database permission changes require security tests, including cross-owner and anonymous access. Keep fixture tests disposable. Report verification limits honestly.

## Design and working style

Keep the UI quiet and video-focused: system fonts, neutral surfaces, restrained accent colors, responsive layouts, clear focus states, useful empty/error states, and actions near their content. Use the existing styles/components. Avoid dashboard clutter, decorative gradients, extra account gates for viewers, or placeholders for unbuilt timeline features.

## Handoff and repository boundaries

The standalone repo is `Daniel-sims/league-cloud-coach`. Native League Helper source is intentionally absent. If working from the original native workspace, `scripts/export-cloud-coach.py <destination>` copies web-only source, this guide as root `AGENTS.md`, the full product README, and shared handoff docs. Check destination edits before exporting. Never publish native history or local recordings as part of the web repository.

Do not depend on a previous session's temporary checkout, browser, CLI login, or running server. In a new session, inspect the repository and service status again. Update `docs/PROJECT_STATE.md` when behaviour, deployment, or remaining work materially changes; keep product scope in the README and architectural decisions in the plan. Store no personal account identifiers or secrets in these public documents.

Companion capabilities: only SHA-256 hashes are stored in private `companion_devices`; browser approval/revocation requires an enabled owner. Only the service role may authorize raw tokens or publish review data. Never accept raw Riot identity payloads in the companion review schema or add browser JWTs to native pairing links. `companion` uses its own authorization and must deploy with `verify_jwt = false`. Retain imported ultimate video timestamps when refreshing the same match timeline. Native app changes remain in the original workspace only.

Library browser cache: `web/src/lib/library-cache.ts` holds only explicitly allowlisted recording display metadata and bounded image blobs, scoped to project/account. Keep normal session/membership checks before reading it. Never persist signed image/playback URLs, share capabilities or credentials here. Clear on sign-out/account switch/explicit access denial; reject stale in-flight metadata writes after mutations/logout and prune removed recording previews. Library list metadata must render independently of upload reconciliation.
