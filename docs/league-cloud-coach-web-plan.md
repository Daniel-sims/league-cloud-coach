# League Cloud Coach: web MVP plan

Updated 9 November 2026. Decision: use unlisted YouTube videos for the first release, replacing the proposed Cloudflare Stream integration. The web app is implemented under `web/`, published as source in [Daniel-sims/league-cloud-coach](https://github.com/Daniel-sims/league-cloud-coach), and live at [League Cloud Coach](https://daniel-sims.github.io/league-cloud-coach/). The schema is applied to Supabase project `qxzjulhpgcnwkihnfdqu` (PostgreSQL 17). Google sign-in is confirmed and the owner's verified Google account has access; exactly one owner membership is enabled. The sections below retain the implementation scope and design decisions.

Verification: 34 frontend tests, five browser tests, CI database security checks, live anonymous API access checks, and a rollback-only owner add/rename/share/anonymous-view/revoke/remove smoke test passed. No test recording was retained. Browser playback of the owner's own recording remains a user acceptance step once a real video is added.

## Outcome and scope

You upload a recording to YouTube as **Unlisted**, sign in to League Cloud Coach with Google, add its YouTube link and a title to your library, then copy a League Cloud Coach watch link. Your coach opens that link without an account and watches using normal YouTube controls embedded in our page.

This intentionally changes the first release from a file uploader inside our site to **upload on YouTube, then add the link here**. No Cloudflare subscription, object storage, encoding service, upload webhooks, or video bandwidth billing is needed for this release. The new Mac companion, automatic uploads, timelines, annotations, Riot sync, and AI reviews remain follow-on milestones.

Videos are unlisted, with no public library or anonymous listing endpoint. Anyone with the YouTube link can watch or forward it. Our app cannot make an unlisted YouTube video private or revoke a YouTube link.

## Findings from the existing repository

The README and some research-document status sections describe an empty repository; implemented source is the reliable reference.

| Existing code | Implication |
|---|---|
| `LeagueHelper/Recorder/GameProcessObserver.swift` | Game process launch/termination already drives automatic recording. |
| `LeagueHelper/Recorder/CaptureEngine.swift`, `RecordingWriter.swift` | ScreenCaptureKit window capture, AVAssetWriter encoding, and game audio already work. These currently belong to the app target, not a reusable package. |
| `LeagueHelper/Recorder/RecordingCoordinator.swift` | Coordinates capture, local persistence, recovery, game-clock anchoring, and match linking. It is coupled to the existing database and app lifecycle. |
| `LeagueHelper/Recorder/RecordingStorage.swift` | Originals live in `~/Movies/League Helper/`; no bulk migration is needed for manual upload. |
| `LeagueHelperKit/Sources/Persistence/Recording.swift` | Stores recording identity, timestamps, dimensions, bytes, match ID, and game/video clock anchor. Local integer IDs must not become global IDs. |
| `LeagueHelperKit/Sources/Domain/Recording/RecordingEncoding.swift` | 30 fps; approximately 6.2 Mbps video at 1080p plus 160 kbps audio. At the target rate a 40-minute recording is about 1.9 GB, before container overhead; actual sizes vary. |
| `LeagueHelper/Recorder/RecordingWriter.swift` | Originals are HEVC video and AAC audio in fragmented MOV files. Uploading these to plain object storage does not guarantee cross-browser playback. |
| `LeagueHelper/AIReview/RecordingProxyTranscoder.swift` | Existing H.264 conversion is an analysis-only, silent, low-frame-rate proxy. It is unsuitable as the coaching VOD. |
| `LeagueHelperKit/Sources/Domain/Recording/GameClockAnchor.swift` | Preserve the game-time/video-offset pair for later timeline alignment. |
| `LeagueHelper/Recordings/ReviewTimelineModel.swift`, `LeagueHelperKit/Sources/Domain/Timeline/ReviewTimeline.swift` | Timeline rows derive from Riot data, participant context, and locally detected casts. A video upload alone cannot recreate the existing review. |
| `LeagueHelperKit/Sources/Domain/Review/TimelineExport.swift` | Current sharing export is text for YouTube descriptions, not a structured cloud interchange format. |
| `LeagueHelperKit/Sources/DesignSystem/Tokens.swift` | Reuse the visual direction: neutral surfaces, muted gold accent, restrained semantic color, 4-point spacing, system typography. SwiftUI components themselves are not reusable on the web. |

Also inspected `project.yml`, `LeagueHelperKit/Package.swift`, recording research, and the former `../lol-journal/prisma/schema.prisma`. The old VOD/annotation model is useful domain context, but its single-user assumptions should not be copied. No existing web frontend or account layer was found here.

## Architecture

| Component | Choice | Reason |
|---|---|---|
| Web client | React + TypeScript + Vite under `web/` | Small static app, independent of native builds. |
| Hosting | GitHub Pages via GitHub Actions | Serves built HTML, CSS, and JavaScript. |
| Identity | Supabase Auth with Google | Shared account identity for the web and future companion. |
| Metadata | Supabase Free Postgres with row-level security | Owner library, YouTube IDs, and app share links; no video bytes. |
| Share backend | Small Supabase database RPCs | Create/revoke/resolve opaque share links without anonymous library access. No video-provider API calls. |
| Video | Your YouTube channel, Unlisted uploads | YouTube handles storage, processing, and delivery. |
| Playback | Standard YouTube iframe player | Normal controls now; IFrame API supplies seeking/events for later timelines. |

Basic embeds do not require a YouTube Data API key or YouTube upload permissions. Google sign-in authenticates your app account; it does not authorize our app to manage your channel. No YouTube OAuth scopes are requested in the MVP.

Use hash routes beneath the Pages repository base path: `/#/library` and `/#/watch/<share-token>`. This supports direct links and reloads without server rewrite rules. Handle the Supabase PKCE callback on the deployed base URL before initializing hash routing, and allow only validated internal return destinations. Configure Vite's base path and exact local/production OAuth redirect URLs.

GitHub Pages cannot run API handlers or hold secrets. The frontend calls Supabase's database API/RPCs. Only the Supabase URL and publishable key are public configuration; the Google client secret belongs in Supabase's provider settings, never frontend code. Reassess Pages hosting before offering a commercial service.

## Accounts and permissions

- Enable Google OAuth in Google Cloud and Supabase; use PKCE and basic identity scopes.
- Allow account creation, but grant library management only to your Supabase user UUID in an administrator-controlled `owner_memberships` table. Other Google users can authenticate without gaining management access.
- Bootstrap your membership administratively after the first login. No public first-user administrator logic, frontend-only email checks, or client-writable access grants.
- Apply membership and ownership checks through row-level security and RPC authorization, including for direct API requests that bypass the UI.
- Anonymous viewers need no Supabase session or user record. They can resolve one active app share token, never list the owner's library.

## Initial data model

Use UUID primary keys, UTC `timestamptz`, foreign keys, constraints, and append-only migrations under `supabase/migrations/`. Preserve the existing local SQLite store.

| Table | Fields and rules |
|---|---|
| `owner_memberships` | `user_id` references `auth.users`, `enabled`, timestamps. Administrative writes only. |
| `recordings` | `id`, `owner_id`, title, provider (`youtube`), validated `youtube_video_id`, timestamps. Optional recorded date, Riot match ID, game-time anchor, video-offset anchor. Both anchor values must be set together. Unique `(owner_id, youtube_video_id)` to prevent accidental duplicates in a library. |
| `recording_shares` | `id`, `recording_id`, unique hash of a random 256-bit share token, created/revoked timestamps. Raw tokens returned when created, never exposed via anonymous table reads. |

Index recordings by `(owner_id, created_at desc)` and shares by token hash and recording ID. Anonymous direct reads of all three tables are denied. Active owners can manage only their own recording metadata; membership grants and share hashes are not arbitrary client-writable fields.

Use narrow `create-share`, `revoke-share`, and `resolve-share` database functions. If privileged SQL functions are needed, fix their search path, qualify referenced objects, restrict execution grants, and explicitly check owner identity/membership for mutations. Resolve a token to only the display title and YouTube video ID. Never expose owner UUIDs, email addresses, or unrelated rows. Return the same unavailable response for invalid, revoked, or deleted links. Do not log raw share tokens.

No uploaded/processing/ready state is claimed in our database: without the YouTube Data API, the site cannot authoritatively confirm processing, channel ownership, or Unlisted visibility. Store owner-entered metadata and let the player report playback availability.

## Manual workflow

1. Upload a completed recording using YouTube Studio. Select **Unlisted**, allow embedding, and wait for processing. Enable uploads longer than 15 minutes by verifying your YouTube account if necessary.
2. Sign in to League Cloud Coach and choose **Add video**. The form has a YouTube URL, editable title, and optional recorded date. Provide a nearby **Upload on YouTube** link and brief instructions.
3. Parse and validate the URL. Accept standard `youtube.com/watch?v=…` and `youtu.be/…` links; optionally support the existing native parser's other supported formats. Store only the validated 11-character video ID. Ignore unrelated parameters and do not accept arbitrary iframe HTML or arbitrary embed hosts. Whole-game playback starts at zero; pasted timestamp parameters are not game-clock anchors.
4. Show a playable preview before saving. Errors explain processing delays, private/deleted videos, or disabled embedding. Do not claim the preview proves the video is Unlisted or belongs to the signed-in account. A syntactically valid link may still be unavailable.
5. Save metadata to the owner's library under row-level security. Offer explicit Share to create/copy the stable app watch URL. Creating a share does not change YouTube privacy settings.
6. A signed-out visitor opens the app watch link. Resolve its token, then load the standard YouTube player with play/pause, scrubbing, volume, and fullscreen. No autoplay or account gate. Offer an Open on YouTube link when embedded playback is unavailable.
7. Owner can rename the app title, revoke an app link, or **Remove from library**. Removing first makes app shares unavailable and removes metadata. It does not delete the YouTube video; avoid naming this action Delete video.
8. To stop access to the actual video, change its visibility to Private or delete it in YouTube Studio. Revoking an app share cannot stop an already loaded player or viewers holding the underlying YouTube URL.

Test one actual League Helper HEVC MOV through YouTube Studio before launch: processing, audio, readable HUD, complete duration, and seeking. If ingestion fails, prepare a full-quality H.264/AAC MP4 with unchanged timing. Do not rename file extensions or reuse the silent low-frame-rate AI analysis proxy. Keep originals locally.

The site cannot enforce Unlisted status in this MVP; the upload instructions and preview make the workflow explicit. YouTube processing, availability, branding, and playback restrictions remain under YouTube's control.

## Visual and interaction direction

Use neutral light/dark surfaces, muted gold actions, system typography, a 4-point spacing scale, subtle separators, and a compact header. Keep a 1280px content cap and responsive mobile viewing. No decorative dashboards, gradients, glass panels, or timeline placeholders.

- **Sign-in:** compact brand, one sentence about sharing game recordings, Google sign-in button. Watch links open directly for guests.
- **Library:** heading, Add video action, simple rows with title, date, and optional thumbnail. Put Share, Rename, and Remove beside the recording. Empty state explains the two steps: upload on YouTube, then add its link.
- **Add video panel:** URL, title, preview, Save; link to YouTube Studio. No file drop zone or upload progress bar, since our site is not receiving the file.
- **Watch:** large responsive YouTube player with title below. Standard provider controls; no custom review transport or login prompt.

Support keyboard navigation, visible focus, reduced motion, and useful invalid-link, missing-video, loading, and revoked-link states. With the IFrame API, handle errors for unavailable/private videos, blocked embedding, and missing client identification. Use `strict-origin-when-cross-origin` for the iframe and supply the correct origin when enabling the JS API: do not suppress the referrer entirely, which can trigger YouTube error 153. Respect the player's minimum dimensions. Use a compatible CSP and verify on the actual Pages domain.

Request no search indexing of watch pages. This is not access control: recipients can forward links, and the player exposes the YouTube identity of the video.

## Implementation order and acceptance

1. **Real recording check:** upload a completed recording manually as Unlisted and verify signed-out playback, embedding, audio, readable quality, and cross-browser seeking. This has not yet been performed.
2. **Web foundation:** add `web/`, shared design tokens, routes, and sign-in/library/add/watch layouts. Isolate the web build from native build settings.
3. **Supabase and Google:** migrations, ownership policies, share RPCs, OAuth configuration, and administrative bootstrap of your membership. Verify unauthorized users and direct API requests cannot write records or inspect another owner's library.
4. **Add-video workflow:** URL validation, preview, save, duplicate handling, rename, and removal. Mirror meaningful cases from `YouTubeVideo.swift` / `YouTubeVideoTests.swift` in web parser tests; cover invalid/lookalike hosts and malformed IDs.
5. **Anonymous sharing:** explicit create/copy/revoke, minimal token resolution, standard player, and unavailable states. Integration tests check anonymous listing is denied and revoked/removed app links fail.
6. **Pages deployment:** workflow, base path, exact OAuth callback, and public environment configuration. Run production build, focused policy/RPC checks, and browser checks for sign-in, add, share, direct reload, signed-out playback, mobile layout, and removal.

Done means your Google account can add a real Unlisted recording and your coach can watch its League Cloud Coach link in a signed-out browser. No direct file uploading or automated channel management is implied.

External setup: Supabase Free project, Google OAuth client, your owner UUID after first sign-in, a YouTube channel with long-video uploads enabled, and Pages enabled for the chosen repository. No Cloudflare account, paid subscription, video API key, or YouTube upload OAuth grant is required for this version.

## Companion and timeline follow-on

Keep the separate Mac companion as the next milestone. Extract reusable capture/process observation/writing into a macOS package module; adapt the database-coupled coordinator. The current app and companion must not both auto-record a game.

Automated uploading would use YouTube's resumable upload API and an explicit YouTube authorization grant in addition to the Supabase app login. Save returned video IDs into the same Supabase user's library. Set `status.privacyStatus = unlisted` explicitly; never rely on upload defaults. Recheck the current OAuth verification, quota, channel, and API compliance requirements before implementing this feature, then test actual upload visibility. Google identity sign-in alone does not grant channel upload permission.

The companion should use registered native callbacks/PKCE, Keychain token storage, a durable upload queue, retries, and stable source recording UUIDs for deduplication. Enqueue only after file finalization and playable-file validation. Keep originals on upload failure.

Preserve match identity and clock anchors for later timelines. Define a versioned structured JSON export from LeagueHelper's existing domain logic rather than immediately duplicating the Swift coaching algorithms in TypeScript. Use the YouTube IFrame API's time/seek/events when review functionality arrives. The existing `YouTubeVideo.swift`, `YouTubePlayerModel.swift`, and `YouTubePlayerView.swift` offer useful native behavior references, though the web implementation remains separate.

## Cost and service limits

The chosen MVP needs no paid subscriptions: GitHub Pages serves the frontend, Supabase Free holds authentication and small metadata records, and YouTube serves videos. No video bytes consume Supabase storage/egress, and there is no Cloudflare usage bill.

Supabase Free has quotas and pauses inactive projects after a week; review availability expectations at launch. YouTube has account, upload, processing, and playback limits, so this is not a promise of unlimited hosting or guaranteed availability. Long recordings require channel verification. Do not activate paid services or paid automatic upgrades for this MVP.

## Official references

- [GitHub Pages overview](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) and [limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
- [Vite deployment](https://vite.dev/guide/static-deploy.html).
- [Supabase Google authentication](https://supabase.com/docs/guides/auth/social-sign-in/auth-google) and [Free plan limits](https://supabase.com/pricing).
- [YouTube Unlisted visibility](https://support.google.com/youtube/answer/157177) and [long-video verification](https://support.google.com/youtube/answer/71673).
- [YouTube IFrame API, seeking, and player errors](https://developers.google.com/youtube/iframe_api_reference).
- [YouTube uploads API for the future companion](https://developers.google.com/youtube/v3/docs/videos/insert).
