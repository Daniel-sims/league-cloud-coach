# League Cloud Coach

A static web app for League match history, player statistics, a personal recording library and account-free watch links. Upload recordings directly to Cloudflare Stream for private two-hour sessions, add an existing Stream video ID, or use unlisted YouTube links.

**Deployment status:** The Stream migration and backend function are deployed, with Cloudflare credentials stored in backend secrets. See [current project state](../docs/PROJECT_STATE.md) for frontend publication and live acceptance status before configuring or publishing.

Live app: [League Cloud Coach](https://daniel-sims.github.io/league-cloud-coach/). Source: [Daniel-sims/league-cloud-coach](https://github.com/Daniel-sims/league-cloud-coach).

## Intent and product scope

League Helper already provides a local Mac workflow for recording games and reviewing them with a timeline. League Cloud Coach extends that experience so a coach can see a player's games through a web link, without installing the native app or creating an account.

League Helper remains the recorder and local preparation companion. Its Push to web action uploads completed recordings, an attached match timeline, clock sync and ultimate-cast markers to this web application. Watching, sharing and commenting work entirely in the browser. A separate companion application is not required.

Library rows show the title, date and provider, with a Shared indicator only when a link exists. Private Cloudflare videos use a signed thumbnail sampled at `0s`; previews load near the viewport and renew once if the image URL expires. YouTube entries retain YouTube's supplied thumbnail, since its embed API does not expose arbitrary frames. Thumbnail failures keep the play placeholder without blocking the library.

The library keeps an account/project-scoped browser cache of display metadata for up to seven days. Returning to the list or reloading shows that snapshot immediately after the normal sign-in/membership checks, then refreshes from the server in the background. Upload reconciliation no longer blocks the first list render. Private thumbnail image bytes are kept in IndexedDB (up to 96 images, 256 KiB each); signed image URLs, share tokens and credentials are not persisted by this cache. Unchanged images can display without another thumbnail authorization request or video playback. Sign-out/account switching clears the cache, successful mutations invalidate metadata, and removing a recording prunes its preview. Storage-disabled browsers continue to work using memory/direct image requests.

## Push to web from League Helper

In the native app, choose **Push to web…** from a recording's actions or its player toolbar (Command-Shift-U). Choose **Connect to web**, approve the matching eight-character code in the browser using your enabled owner account, then return to League Helper and choose **Check connection**. The web sidebar's **Connected apps** page lists connections and lets you disconnect them. A connection expires after 90 days; use **Replace expired or disconnected connection** in League Helper to connect again.

Attach the correct match, focus the summoner who played it, confirm the game-clock/video-position anchor and enter a title. Push to web fetches a missing Riot timeline using the native app's Riot key, detects ultimate casts locally, uploads the original video directly to Cloudflare using resumable TUS chunks, and publishes the reduced timeline and clock anchor. **Open in web** appears only after both the video and review data are saved. Originals remain on your Mac. Gate detection, ultimate ratings, local review comments and AI findings are not exported.

A failed or paused push can be retried from the same recording. The app keeps the private upload destination in a protected Application Support job file and asks Cloudflare for its saved offset. Once the video is processing or published, retries reuse it. Processing is checked for up to ten minutes per attempt; if it takes longer, retry later. **Update web timeline** republishes the current match/anchor/markers using the existing video. Change the recording title on the web after the upload has been reserved. Removing a recording from the web does not silently restore it on a retry; explicitly use Add existing video to restore it first.

Ultimate markers retain video timestamps and move against game time when you resync the clock. Both owners and watch-link viewers see them, and the Ultimates filter can hide them. Refreshing the same Riot timeline retains imported markers; attaching a different match or detaching the timeline clears that imported review. Detection uses the existing Twisted Fate HUD colour thresholds and capture layout; arbitrary HUD scales, champions and cropped videos have not been validated. Scanning adds no Cloudflare processing charge; normal Stream storage and playback charges still apply.

The native capability is upload-only and stored in macOS Keychain. The browser approves its SHA-256 hash; raw capabilities, browser sessions, Riot credentials and Cloudflare credentials never appear in shared reviews. The `companion` Edge Function verifies that capability and enabled membership on every API request, verifies provider ownership/readiness/privacy before publishing, and strictly validates the reduced review schema. Apply migration `202611100004_companion.sql` and deploy `companion` with gateway JWT verification off (the handler implements capability authorization). Existing Stream/Riot functions and OAuth configuration need no changes.

### Current release

- Google authentication through Supabase, with library management restricted to explicitly enabled owner memberships.
- Home with saved Riot accounts, profile level/current ranks, recent-game statistics, champion selection, season/split champion records, filtered match history and expandable team scoreboards. Riot data is fetched on the backend and stored privately per owner.
- Upload a video file directly to Cloudflare with progress, pause/resume, retry, and processing checks. Add a YouTube URL or an already-uploaded private Cloudflare Stream video ID with a title and optional game date. Stream IDs are verified against the configured account on the backend.
- Search, filter, sort, rename, open, and remove recordings from the owner's library.
- Create, replace, copy, and revoke share links.
- Account-free watch pages with standard video controls. Stream links must start within seven days, bind to the first browser session, and expire two hours after starting. YouTube sharing retains its existing behavior.
- A clearly labelled development-only local preview, plus automated frontend, browser, and database permission checks.

Other Google users may authenticate, but signing in does not automatically grant management access. Data ownership is part of the schema rather than hardcoded to one person's email, allowing deliberate expansion later.

### Outside the current release

There is no automatic YouTube/channel integration, Mac companion, match-level notes or AI analysis in this web release.

### Review timeline

On desktop, the timeline fills the available window height independently of the video; on phones it stacks below the player with its own scroll area. Each video page shows a timeline beside the player, ported from the Mac app's review panel: kills and deaths, teamfight cards (who was there, outcome, dive callouts, and your part or where you were), fights worth a rewatch, recalls with purchases and the resulting build, minute-by-minute lane matchups, objectives and (off by default) the lane opponent's purchases. Choose **Attach game** to pick a synced game from Home; the backend fetches its Riot timeline once with your token and stores a reduced copy with the video, so coaches never need a Riot token. Then pause on a frame, choose **Sync clock**, and type the in-game timer: that one reading maps every event onto the video for you and anyone with the watch link. Comments and timeline events seek to their exact timestamp. Only ultimate casts and deaths seek five seconds early, including death moments inside fight cards; kills, assists, fights, flags, objectives, recalls, purchases and checkpoints seek exactly.

Comments are pinned to the video position and shown in game time once the clock is synced. The owner adds comments, questions or mindset notes; anyone with a valid watch link adds comments and questions under a name they choose. A coach can edit or delete only the comments written from their browser; the owner can remove any comment on their videos. Revoking or replacing the link ends guest access to the review as well as the video. Press **N** to comment at the playhead. Riot sync for Home is implemented; it does not migrate the Mac's local journal, recordings or historical rank observations.

The current manual flow is **YouTube Studio upload as Unlisted → Add video in Cloud Coach → Share an app watch link**. YouTube visibility is selected by the uploader; the site cannot verify it or claim that an unlisted video is private.

### Service and cost decisions

Use GitHub Pages for the static frontend and Supabase for identity/private metadata plus a Stream Edge Function. Cloudflare Stream is an optional paid video provider; existing YouTube recordings remain supported. Stream currently charges $5/month per 1,000 stored minutes of capacity, bought in blocks, plus $1 per 1,000 delivered minutes. Recheck [provider pricing](https://developers.cloudflare.com/stream/pricing/) before purchase. Expiring/removing a share does not delete hosted media or stop storage charges.

## Architecture and privacy

| Component | Responsibility |
|---|---|
| React + TypeScript + Vite | Browser UI and hash routing compatible with GitHub Pages |
| Supabase Auth | Google login with PKCE; no YouTube upload grant |
| Supabase PostgreSQL 17 | Private owner memberships, recording metadata, and hashed share capabilities |
| Narrow database RPCs | Owner mutations and minimal anonymous share resolution |
| YouTube iframe / HLS video player | Provider-hosted playback with standard controls |
| Supabase `stream` Edge Function | Verify owner actions/share sessions, check Cloudflare privacy, mint five-minute playback tokens |
| Supabase `riot` Edge Function | Verify owner JWT/membership, resolve Riot accounts, refresh current ranks and cache completed matches |
| GitHub Actions + Pages | Verification, configured production build, and static deployment |

Video files never pass through our website/backend. GitHub Pages has no server handlers. The `stream` Supabase Edge Function returns short-lived playback authorization; Cloudflare delivers the media. There are no video-storage buckets. Owner libraries are protected by database permissions and row-level security; anonymous viewers can resolve a valid capability but cannot list libraries or edit records.

YouTube recordings use unlisted sharing. Anyone with a YouTube URL can watch or forward it. Replacing/revoking an app link does not stop an already loaded player or invalidate that YouTube URL. The owner must change visibility or delete the video in YouTube Studio to stop access to the actual media.

## Source and documentation map

| Path | Contents |
|---|---|
| `web/src/App.tsx` | Account UI, library, forms, and watch routes |
| `web/src/lib/` | Supabase/RPC repository, safe auth errors, YouTube validation, and local preview |
| `web/src/components/` | YouTube player and accessible native modal wrapper |
| `web/src/styles.css` | Responsive visual styles |
| `web/src/**/*.test.*`, `web/e2e/` | Frontend/component tests and browser workflows |
| `supabase/migrations/` | Versioned schema and permission changes |
| `supabase/tests/` | Disposable-database permission/security checks |
| `.github/workflows/cloud-coach-web.yml` | Verification and deployment pipeline |

For agents, read `web/AGENTS.md` (also the standalone root `AGENTS.md`), then [current project state](../docs/PROJECT_STATE.md) and the [implementation decisions](../docs/league-cloud-coach-web-plan.md). The state file records completed setup and remaining acceptance work so a fresh session does not recreate resources. These are durable project documents; previous chat history, a temporary checkout, or an existing login should not be assumed.

In the original native workspace, `scripts/export-cloud-coach.py` copies web-only source to the standalone repo. The exported root README is generated from this complete document with relative links rebased, and root `AGENTS.md` comes from `web/AGENTS.md`. Native source, history, database files, and recordings must not be published in the public web repository.

## Home and League account setup

The root route and Google sign-in now open Home (`/#/home`). Video library remains at `/#/library`, and existing owner/watch links continue working. Choose **Add League account**, enter `Name#TAG`, and select EUW, EUNE, NA or KR (the same regions as the native app). Saved accounts switch independently of your Google identity; adding a Riot ID is a profile lookup, not proof of Riot account ownership. The last selected account, recent-game window and Solo/Duo preference are remembered in that owner's browser.

Choose **Settings → Riot connection**, paste your Riot API token into the masked field, select its region, and choose **Save token**. The backend saves it encrypted for your Google account and checks it with Riot. If verification fails, the token is still saved and a warning explains that newly generated tokens may take a few minutes to work. The form never reads a saved token back. Replace expired tokens here or choose **Remove saved token**; removing the token keeps synced games. Home refreshes after saving. See [Riot's key guidance](https://developer.riotgames.com/docs/portal) and [League API documentation](https://developer.riotgames.com/docs/lol). No Riot password or additional Google permission is needed.

For deployment, apply all pending migrations and deploy `riot` with `supabase functions deploy riot --project-ref YOUR_PROJECT_REF`. The existing hosted project has `RIOT_TOKEN_ENCRYPTION_KEY` configured. New installations need a random 32-byte key, base64 encoded, in that backend secret. Preserve it during redeployment; changing it requires owners to re-enter their tokens. Tokens use AES-GCM with fresh nonces and service-only ciphertext storage; raw values exist only in the submission and backend memory. Never log or bundle tokens/encryption keys. An optional legacy `RIOT_API_KEY` backend secret remains a fallback for owners with no personal token; personal tokens take precedence.

Saved matches render before background refresh. The first visit refreshes current ranks and up to 20 recent games; **Refresh match history** fetches at least the selected recent-game window. **Sync older games** adds the next 20, using a server-persisted cursor. Each backend page fetches at most five games, caches immutable results and preserves completed work after errors. Request scheduling is shared across backend instances; rate-limit errors are actionable without dropping saved history. Match history is grouped by the local calendar date each game started. Date headings follow the selected newest/oldest order and only show games matching the current filters; the game count reflects the visible rows. Histories and season totals describe synced games, not an implied complete lifetime archive. Riot may no longer serve older matches. A new browser can load the saved matches; the local preview remains video-only.

Statistics follow native `RecentGames.swift`: remakes occupy a recent-window slot but are excluded from averages and records; deathless KDA is Perfect; farm/gold rates use total time, and role-sensitive dashboard rates use the most-played role. Champion farm uses every decided game on that champion. Kill participation and damage share average per-game shares, skipping zero denominators. Result filters narrow rows while the matchup record includes both outcomes. Opponent filters match the enemy in the player's lane, falling back to any enemy when Riot supplies no position. Season is the major patch version; season 16 splits start at 16.1, 16.9 and 16.15, matching native defaults. Other seasons show whole-season totals until boundaries are added; custom native split settings are not synchronized.

Expanded scoreboards show the complete available roster, champion/level, KDA, damage dealt/taken, wards/control wards/vision score, farm and items. Match rows include spells/runes, lane opponent, duration, queue and patch. Current rank/LP is supported; per-game historical LP changes need rank observations and are not inferred from today's rank. Local journal/check-in/AI review data and match-to-recording links are not transferred by Riot sync. Existing uploads remain in Video library.

## Appearance and Settings

**Settings** is at the bottom of the desktop sidebar. Open **Settings → Appearance → Dark mode** to switch between light and dark. The choice applies immediately and is remembered in this browser, including after reload and sign-out. It is not stored on the server. Light remains the default.

## Drawing and timeline captures

On an owner video page or a shared watch page, choose **Draw** beneath the player
(or press **D** outside a text field). Playback pauses and an editor opens on a
frozen frame. Draw with the pen, highlighter, arrow or eraser; choose ink colour
and width, undo/redo or clear. Add an optional note, then choose **Capture to
timeline**. Coaches enter a display name, as they do for comments. Cancel
returns to the paused video without saving.

Captures appear chronologically with thumbnails. Open one to view the marked
frame, **Jump to video** at its exact timestamp, or delete it. Owners can delete
any capture on their recording; coaches can delete only captures created with
their browser's author key. Reloading or using another browser can read saved
captures through the same owner account or valid watch link. Revoked/expired
watch links and disabled owners lose capture access through the same review
checks. Downloaded image bytes cannot be recalled.

Cloudflare uses the paused video's decoded frame (its media must allow CORS).
YouTube's embed API does not expose video pixels: the browser asks you to share
**this tab** for a one-frame screenshot, then immediately stops sharing. Keep
the full player visible and check the frozen preview before drawing. Choosing
a window/screen is rejected; selecting a different tab cannot be reliably
detected, so cancel if the preview is wrong. Tab capture requires a supported
desktop browser and HTTPS (localhost also works); mobile YouTube tab capture is
not supported. Drawing on Cloudflare videos works with mouse, pen or touch.

Saved captures are flattened JPEGs, up to a 1280-pixel long edge and 256 KiB,
with at most 50 per recording. Drawing can be revised before capture; saved
stills can be viewed or deleted. They are stored as private bounded binary
rows in PostgreSQL, fetched separately from timeline metadata and loaded near
the viewport. This avoids a public image URL or an additional storage service;
a full 50-image recording uses at most 12.5 MiB of image bytes. Removing the
recording's metadata cascades to its captures; video files remain unchanged.

Deployment requires the append-only migration
`supabase/migrations/202611100005_drawing_captures.sql` before publishing the
frontend. No Edge Function or native app change is required. Run
`supabase/tests/capture-security.sql` only against a disposable test database.

## Video keyboard controls

While an uploaded video or its seek buttons are focused, use **Left/Right** to move 1 second, **Shift + Left/Right** for 10 seconds, and **Ctrl + Left/Right** for 30 seconds. Ctrl takes precedence if Shift is also held. Jumps use video time regardless of playback rate, stop at the video boundaries and preserve paused/playing state. The seek buttons support the same modifiers when clicked. For YouTube, focus the seek buttons below the embed to use these shortcuts; keyboard events inside the embedded YouTube player remain controlled by YouTube.

## Upload from your computer

Choose **Upload video** in the library, select an MP4, MOV, M4V, MKV, WebM or AVI recording (up to 30 GB), give it a title, and choose a maximum duration longer than the recording (30, 60, 90 or 120 minutes). Then choose **Upload to Cloudflare**. Video bytes go directly from the browser to a one-time Cloudflare TUS destination; the backend never proxies the file or exposes the Cloudflare API token. Privacy is set at provisioning with `requiresignedurls`, rather than enabled after a public upload.

Progress is shown during transfer. **Pause upload**, closing the dialog, leaving the library, or closing the page stops the local transfer. Open **Upload video** again and select the same file (name, size and modification time) to resume completed chunks in the same browser. The pending upload destination is stored in browser local storage under the signed-in owner's ID, rather than a shared fingerprint pool. One pending transfer is tracked per owner/browser. Upload URLs are limited upload capabilities; never paste them into logs or public documents. There is no recovery across browsers/devices; an expired upload URL requires a new upload. Clearing browser data also clears this recovery state. **Start another upload** forgets local tracking and retains previous media in Cloudflare; its video ID is shown for manual recovery through Add video.

After transfer, the dialog polls processing. The backend verifies the Cloudflare creator matches the authenticated owner and the upload marker/private flag are present, then imports the recording only when Cloudflare reports it ready. Processing failures do not create playable library entries. Repeated readiness checks are idempotent. Private import history remembers completed imports even after deliberate library removal, so recovery skips them; Add existing video is the explicit restoration path. The dialog remains open and shows **Upload successful → Video added to your library** only after the account save is confirmed, with **Watch video** and **Back to library** actions. Closing during processing is supported: the library reconciles owner-tagged uploads on load and every 15 seconds while transfers/processing remain outstanding. A processing notice stays visible until ready. There is no webhook when nobody is using the app; the next library visit finishes recovery, even if browser pending state was cleared. Existing recordings still use **Add existing video** with the provider selector.

Cloudflare temporarily reserves the selected maximum duration from your available storage until the upload is processed or expires. A recording longer than the selected limit fails processing. Upload creation is restricted to enabled owners, but these controls are not a hard spending quota. Closing/forgetting an upload does not delete provider media or stop charges for completed stored videos. Preserve local originals.

## Cloudflare Stream setup and acceptance

1. Activate Stream in the intended Cloudflare account. Upload a recording in the dashboard, wait for processing, and enable **Require signed URLs**.
2. Create a Cloudflare API token scoped to that account with **Stream Read** and **Stream Write** permissions. Keep it out of chat, Git, and `VITE_…` variables.
3. In the existing Supabase project → Edge Functions → Secrets, store `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. See [backend environment example](../supabase/functions/.env.example). The hosted runtime supplies Supabase URL, anon key and service-role key.
4. Preview and apply the pending append-only migration, then deploy from the repository root: `supabase functions deploy stream --project-ref YOUR_PROJECT_REF`. The checked-in function configuration sets `verify_jwt = false` because guests authenticate with capabilities. The handler verifies owner JWTs with Supabase Auth and checks membership before owner actions. Do not push the entire local auth configuration.
5. Export/synchronize the web-only repository, verify its changes, then publish the frontend through its existing Pages workflow. Backend deployment must precede the frontend. Never push native history into the web repository.
6. Sign in, choose **Add video → Cloudflare Stream**, paste the 32-character video ID, enter a title, and save. The backend rejects videos outside the configured account, videos still processing, and videos without signed-URL protection.
7. Create a share and open it in a signed-out browser. Metadata lookup does not claim the session; **Start session** claims it atomically. Check audio, HUD readability, duration, seeking, pause/resume, refresh, and renewal beyond five minutes with the actual recording. Verify a different browser cannot claim it, and that revocation/replacement ends renewal. Verify expiry with an actual session before describing live acceptance as complete.

The database stores only hashes of share and viewer-session capabilities. The viewer secret is kept in per-tab session storage. Reloads reuse it and cannot extend the two-hour deadline; closing/losing that tab may require the owner to issue a replacement. Duplicating a tab may copy browser session storage; this is a session claim, not a guarantee of one physical viewer or a hard spending cap. Anyone obtaining both capabilities or a still-valid playback URL can reuse them during their validity.

Playback tokens last at most five minutes and never extend beyond the session deadline. The player renews about one minute before expiry and reloads the playlist to obtain fresh Cloudflare segment signatures, preserving position and pause state. Renewal may briefly buffer and needs device acceptance. A final lease that reaches the session deadline is not renewed again. Transient failures retry until the current token expires, then unload media. Revocation/replacement stops new tokens; previously issued tokens can remain valid for up to five minutes and already buffered/captured media cannot be recalled. There is no cumulative watch-minute budget or billing cap.

Owners can load their own recordings without spending a shared session; their playback still incurs delivery charges. Removing a recording only removes app metadata and access. Delete media separately in Cloudflare to stop its storage usage. There is no automatic retention/deletion policy.

Run `deno check --config supabase/functions/stream/deno.json supabase/functions/stream/index.ts` from the repository root to check the Edge Function. `npm test` in `web/` includes mocked provider/handler tests; SQL tests use a disposable database and browser tests simulate backend responses. None prove real Cloudflare playback.

## Run locally

Requires Node.js 24 and npm.

```sh
cd web
npm ci
npm run dev
```

Open the printed local URL. Before the cloud connection is configured, **Open local preview** lets you add, search, watch, rename, and remove videos stored in this browser. Local preview can copy the original YouTube link, but cannot create cloud watch pages. It is development-only and never acts as authentication.

To enable accounts and persistent sharing, complete the following setup.

## 1. Create the database

For a new installation, create a Supabase project and apply all files in [migrations](../supabase/migrations/) in filename order. For the existing hosted project, preserve applied migrations and apply only pending files. Link the CLI and preview with `supabase db push --dry-run` before `supabase db push`. Stream additionally needs the backend configuration below.

The migration creates a private recording library, owner memberships, and hashed share capabilities. Authenticated accounts have no owner permission until granted explicitly. Never run `supabase/tests/bootstrap-local.sql` on Supabase; it is only for disposable plain PostgreSQL tests.

## 2. Configure Google sign-in

1. In Google Cloud, create an OAuth client of type **Web application** and configure its consent screen. If the app is in Testing, add your Google account as a test user.
2. Add `http://127.0.0.1:5173` and your production site's origin as authorised JavaScript origins. GitHub project paths are not part of an origin.
3. Add `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` as the authorised Google redirect URI.
4. In Supabase Authentication → Sign In / Providers → Google, enable Google and enter that client ID and client secret. Request basic identity scopes only. No YouTube scopes are required.
5. In Supabase Authentication → URL Configuration, set Site URL to your production base URL, such as `https://YOUR_USERNAME.github.io/league-cloud-coach/`. Add that **exact URL** and `http://127.0.0.1:5173/` as allowed redirect URLs. If using a different local port, add its exact origin/base URL too.

Copy [.env.example](.env.example) to `web/.env.local` and fill in the project URL and **publishable** key from the Supabase project connection/API settings. A legacy `anon` key also works. Never use the `service_role` or `sb_secret_…` key in frontend configuration.

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_BASE_PATH=/
```

Restart the dev server. Sign in using Google in the same browser that initiated the flow (PKCE). The app should show that your account is signed in but not yet granted access.

If Google reports `redirect_uri_mismatch`, check the exact Supabase callback under the Google client's **Authorised redirect URIs**. The GitHub Pages origin belongs in the separate **Authorised JavaScript origins** field.

If the app returns a Google connection error and Supabase's auth logs show `invalid_client` during code exchange, replace the provider's secret with the full secret from the **same** Google OAuth client as the configured client ID. A masked value such as `****abcd` is not usable. If Google no longer shows the full value, add a new client secret, copy it immediately into Supabase's Google provider settings, and save. Never put it in frontend configuration or share it in chat.

## 3. Grant your account library access

In the Supabase SQL Editor, replace the address below with the Google email you just used:

```sql
insert into public.owner_memberships (user_id, enabled)
select id, true from auth.users where lower(email) = lower('you@example.com')
on conflict (user_id) do update set enabled = true;
```

Confirm this inserted or updated exactly your intended account. Reload the website. Your empty library should now appear. Repeat this explicit administrative step only when intentionally admitting another owner; each owner's library remains separate.

To disable an owner, update their membership's `enabled` to `false`. This blocks their management RPCs and resolution of their existing share links. Google users without membership can sign in, but cannot manage recordings.

## 4. Add and share a real recording

1. Upload a completed recording from `~/Movies/League Helper/` to YouTube Studio.
2. Set visibility to **Unlisted**, enable embedding, and wait for processing. Verify your YouTube channel if the upload is longer than 15 minutes.
3. In the app, choose Add video, paste its YouTube URL, and enter a title. Optional Preview video checks basic embedded playback.
4. Save, choose Share, and create/copy a watch link.
5. Open that link in a signed-out/private browser window. The watch page should play without signing in.

The site validates URLs but cannot verify channel ownership or Unlisted visibility without additional YouTube API authorization. Keep Google login permission separate from channel-management permission.

Creating a replacement watch link invalidates the old app link. Raw capabilities are shown only when created; only their hashes are stored in the database. Copy/save the link at creation, or explicitly replace it later.

Revoking a share or removing a recording stops new requests to its app watch page. It does not stop already loaded players or revoke YouTube URLs. To stop video access itself, set the YouTube video to Private or delete it in Studio. Removing from the library never deletes the original video.

## 5. Deploy to GitHub Pages

The repository includes [the workflow](../.github/workflows/cloud-coach-web.yml). It tests the frontend and database permissions before deploying `web/dist`. Native Swift builds are unaffected.

1. Push this repository to the intended GitHub repository. Keep any unrelated local/native source private unless you intentionally choose to publish it. A public GitHub Pages site does not itself require publishing personal recording data; those records stay in Supabase.
2. In Settings → Pages, select **GitHub Actions** as the source. Availability for private repositories depends on your GitHub plan. A dedicated public repository containing only `web/`, `supabase/`, and the workflow is an option for a free account.
3. Under Settings → Secrets and variables → Actions → **Variables**, set:

   | Variable                        | Value                                                                                                |
   | ------------------------------- | ---------------------------------------------------------------------------------------------------- |
   | `VITE_SUPABASE_URL`             | Supabase project URL                                                                                 |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key or legacy anon key                                                                   |
   | `VITE_BASE_PATH`                | Optional; defaults to `/REPOSITORY_NAME/`. Set `/` for an account Pages repository or custom domain. |

4. Ensure the production base URL is present in Supabase's redirect allowlist (step 2).
5. Push to `main` or `master`, or run the Cloud Coach web workflow manually. A pull request runs checks without deployment. Deployment stays skipped until both Supabase variables are present. The deploy job rejects invalid configuration and secret keys rather than publishing a disconnected app.

For a separate web-only repository, copy the directory structure unchanged, include the root `.gitignore`, and retain the workflow paths. Do not include `.env.local`, local app data, or recordings.

Hash routing makes URLs such as `https://YOUR_USERNAME.github.io/league-cloud-coach/#/watch/TOKEN` work on direct load and refresh. Do not configure a server-side SPA router or change links to history routes without providing a fallback host.

## Verification

```sh
cd web
npm test
npm run build
# Uses installed Google Chrome on macOS if available, otherwise Playwright Chromium.
# On another machine, install Chromium first:
npx playwright install chromium
npm run test:browser
```

Browser tests cover local library interactions, persistence, mobile width, keyboard dialogs, and public unavailable states. They do not substitute for a real Google login or playback of your own YouTube recording.

Database tests run against an isolated PostgreSQL 17 database. With the connection environment pointing at a **disposable test database**:

```sh
psql -v ON_ERROR_STOP=1 -f supabase/tests/bootstrap-local.sql
for migration in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -f "$migration"; done
psql -v ON_ERROR_STOP=1 -f supabase/tests/security.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/stream-security.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/review-security.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/companion-security.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/capture-security.sql
```

Run those paths from the repository root. The tests check validation, private listings, unauthorized accounts, direct mutation denial, cross-owner operations, anonymous capability lookup, share rotation/revocation, disabled owners, and deletion. The fixture transaction rolls back. The CI workflow runs the same tests.

Before launch, manually verify real Google login, add a completed game, signed-out playback with audio, seeking, watch-page reload, link revocation, and library removal. YouTube error 100 means unavailable/private; 101/150 means embedding is blocked; 153 means the embed lacks client identification. The app sends an origin and retains a normal cross-origin referrer.

## Service limits

The YouTube path needs no paid video subscription. Cloudflare Stream usage is billed separately. Supabase Free has quotas and may pause a project after one week of inactivity. YouTube controls upload limits, processing, ads/branding, and availability. Unlisted videos are accessible to anyone holding their YouTube link. Keep the local originals.

## Future work

Direct Cloudflare uploads, review timelines and League Helper Push to web are implemented. Automatic YouTube channel uploads remain future work and require explicit upload authorization.

Imported timelines already preserve match identity, game/video anchors and versioned ultimate timestamps. Future work includes richer review cards, threaded feedback and exporting local comments. Broader user onboarding is a deliberate product decision; do not enable library management for every Google sign-in by default.

Keep the interface modern and uncluttered: neutral surfaces, system typography, restrained accents, a recording-focused library, and a large video player. Add review controls when the corresponding functionality exists, rather than filling the current watch page with future-feature placeholders.
