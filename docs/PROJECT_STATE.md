# League Cloud Coach: current project state

Last reviewed: 11 November 2026. This is the durable session handoff, not a replacement for inspecting current source, Git, and service state.

## Event-linked discussions

Each timeline event has a Comment action (Reply plus a count once discussed).
It opens a composer beneath that event, naming its subject and exact timestamp.
Player/coach notes render as a connected discussion with author labels and the
existing editing/moderation rules. Notes attach to match + event identity, not
nearby timestamps, including when two moments share a timestamp. Simple and
Detailed reuse references where the same event is shown. Comments for an event
hidden by mode/filter or belonging to an older attached game remain standalone
with an explicit saved event caption; no old notes are automatically reassigned.
The header comment action still adds a general playhead note, now styled as a
separate card. Failed saves retain drafts. Starting an event note pauses playback
and stops automatic timeline following while the user writes.

Migration `202611110001_event_comments.sql` is applied remotely. It adds nullable
bounded display-only event metadata and separate owner/shared event-comment
RPCs; original RPC signatures keep working. References validate the recording's
attached match, bounded event identity/label/time, and allowlisted fields. Old
comments, RLS, guest author-key enforcement, owner moderation, revocation and
comment limits remain intact. No companion/native API contract changed.

Validation: 136 unit tests, production build and ten review Chrome workflows
pass. The owner-to-coach browser flow covers grouping, exact event timestamp
versus playhead, save failure/retry, own-note editing, shared visibility and
Simple mode. Desktop/mobile screenshots inspected. All nine database permission
suites pass in an isolated local PostgreSQL 16 fixture, including the new event
suite; CI also runs them under PostgreSQL 17. A remote dry-run listed only the
new migration before it was applied. Release
`c0b25bf78908c1605779b1cc5ce8347471bdb532` is pushed and deployed through the
[successful CI/Pages workflow](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/43007864996),
including the full browser suite and all nine PostgreSQL 17 permission suites.

## Objectives in Simple timeline

Simple now includes neutral-objective events alongside the player's deaths and
ultimate casts. It reuses the stored objective data and bundled monster icons
(dragon variants, Baron, Herald, grubs and Atakhan where present), with a team
border colour and full event/team/time accessibility label. Rows stay compact;
no objective cards are shown in Simple. Objectives respect the existing filter
and seek exactly, preserving the five-second lead only for deaths/ultimates.
Scuttle timestamps are not available from the currently stored reduced payload;
no jungle-CS inference or synthetic events are added. No backend/native changes.
Validation: 135 unit tests, production build and nine review Chrome workflows
pass, including objective icon assets, allied/enemy labels, exact objective seeking
and filtering in Simple for both owner and shared-viewer routes. Screenshot inspected.
Objectives are deployed in `f839394f5b16516c0d9d33000e6aba7155a7fa7f` through
[successful CI/Pages workflow](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/43005556959).

## Timeline controls and larger drawing editor

Current control placement supersedes the older Video tools placement below:
the settings cog and cinema toggle live in the timeline header, including
Exit cinema mode. Draw remains directly over the upper-right of the video.
Collapsed timelines keep the settings/cinema controls beside the reopen rail.
Narrow panels use an icon-only Comment action with an accessible name. Settings
and Filter retain shared state and full-panel dropdown alignment. Preserve the
new Simple/Detailed timeline preference for both owners and shared viewers.

The drawing editor now fills almost the whole window: a large frozen frame on
the left, and a 300px right pane containing tools, colour, width, opacity, notes
and save/cancel. Phones stack the image above the controls. Ink opacity ranges
from 0–100%, separately remembered during editing for pen/highlighter/arrow
(defaults 100/35/100). Opacity belongs to each stroke and survives undo/redo and
flattened JPEG saving. Erasing remains fully effective regardless of opacity;
source frames and capture size/security limits are unchanged.

Verification: 135 unit tests, production build and seven review Chrome workflows
pass. A real-canvas pixel check verifies 50% ink alpha and its preservation
through history actions; desktop checks verify the image exceeds 1000px at a
1440px viewport with controls to its right. Desktop/mobile screenshots inspected.
Release `ecc7b658f8e315518e0f390ce25de831e1800212` is deployed through the
[successful CI/Pages workflow](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/43003092370),
including the full browser and database suites.

## Cinema mode

The button beside Video tools switches owner and shared watch pages to a view
containing only the video and timeline, hiding workspace/sidebar navigation,
page title/share actions, shared branding and footers. It uses the full page
width with no outer insets or gap between video and timeline. The video is
vertically centred on black, with square corners and its aspect ratio preserved;
the timeline reaches the top, bottom and right edges. The divider remains
draggable using an overlapping hit area that reserves no horizontal space.
The same player stays mounted at its current position;
the timeline opens on entry and fills the available desktop height. Phones
retain the stacked layout. Exit cinema or Escape returns to the normal page;
Escape dismisses an open menu/dialog first. Entering starts at the page top;
exiting restores the previous scroll position. The mode is per visit, not saved.

Verification: 134 unit tests, production build and seven review Chrome workflows
pass, including owner/shared cinema views, unchanged media element/position,
edge-to-edge bounds and vertical video centring, menu/dialog Escape handling,
exit button/focus, hidden mobile navigation with
the collapsed sidebar preference, and no horizontal overflow. Desktop/mobile
screenshots inspected. Release `866c57142fbdc0c090f9570e6cc45c9ac6c948ba` is deployed
through the [successful CI/Pages workflow](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/43000286626),
including the full browser and database permission suites. No backend or native
changes. The edge-to-edge refinement is deployed as
`db69bfc0695a7b26980c952ef7628cc682fb0a71` through the
[successful CI/Pages workflow](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/43001858851).

## Video tools location and dropdown behavior

Current behavior supersedes the earlier menu placements below: **Video tools**
is a labelled button at the upper-right of the video. It contains Draw first,
then owner-only game and clock settings. This removes Settings from the narrow
timeline header and its clipping boundary. The browser-provided video three-dot
menu cannot contain app actions; it retains playback speed/Picture-in-Picture.
Filter remains in the timeline header and fits its width. Both menus now use
explicit shared React state instead of native details dropdowns: opening one
closes the other, outside clicks dismiss, and Escape closes and restores focus.
Draw remains available when the timeline is collapsed. The D shortcut remains.

Verification: all 134 unit tests, production build and five review Chrome
workflows pass. Narrow desktop/mobile menu bounds and pointer hits, outside
clicks, Escape, owner/guest drawing and switching menus are covered. Screenshots
inspected. Release `bb63ebe85bed38762a4ab31bbd39b404b4f8821a` is deployed through
the [successful CI/Pages workflow](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/42998607596).
Browser-native menu customization is not implemented.

## Compact video review layout

Owner video pages use a 48px workspace header
and a tighter back/title/share row, with the player starting at 100px on desktop.
The extra seek-button row is hidden on owner and shared review pages; provider
playback controls and keyboard seeking/playback remain available. Draw lives in
**Video settings** (the gear beside Timeline), for owners and shared-link viewers.
When the timeline is collapsed, the gear stays beside its reopen button. The D
shortcut and explicit YouTube tab-sharing flow remain available. Owner-only game
attachment and clock settings remain absent for guests. The decorative owner-page
footer is hidden while reviewing.

Verification: 134 unit/component/handler tests, production build and all five
review Chrome workflows pass against simulated backend contracts. Desktop and
mobile screenshots inspected. Release `1067be470f4363486e743366286fd1c6b1bbbb85`
is pushed and deployed through the [successful Pages workflow](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/42994269169),
including the full browser and database permission suites. No backend or native changes.

## Review menu width correction

Settings and Filter dropdowns anchor to the full timeline header with an 8px
inset on both sides, rather than aligning their right edge to the toolbar icon.
This keeps their content inside the panel at its 300px minimum width. The header
uses tighter spacing, and long menu text wraps with bounded vertical scrolling.
Collapsed-timeline settings retain their separate dropdown. Settings and Filter
share a native exclusive details group, so opening either closes the other.
Desktop and mobile browser checks cover switching menus in both directions. The production build
and all five review Chrome workflows pass; regression assertions check menu bounds
and pointer hits at both edges on narrow desktop and mobile. Both screenshots
were inspected. Both fixes are published in `ef15429bbc7cec434758db9143dcaf9f2bb5e4d4`
through the [successful CI/Pages workflow](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/42996370184).
All 134 unit tests and the full CI browser/database suites pass. No backend or
native changes.

## Independent desktop and web workspaces

The source repositories were separated on 10 November 2026. The permanent web
checkout is `~/Documents/Dev/league-cloud-coach/`, connected to the existing
`https://github.com/Daniel-sims/league-cloud-coach.git` remote and its independent
history. The desktop checkout is `../league-helper/`, with its original local
history and no configured remote at the split. The clean temporary drawing-release
checkout was removed after verifying all its commits are preserved here.

This repository now owns web/backend/deployment source directly: `web/`,
`supabase/`, web docs and the Pages workflow. The native repository's duplicate
web folders, workflow, web handoff/plan and export helper were removed after
all 117 current web/backend/workflow/document files were verified byte-for-byte
against the published checkout. Ignored local web environment, dependencies
and linked Supabase state moved into this permanent web checkout and remain
ignored. No cloud project, database or hosting resource was recreated.

Root `README.md` and `AGENTS.md` are canonical and maintained directly; their
former `web/` duplicates were removed. There is no export/synchronization step.
Frontend source remains under `web/` to preserve existing build/CI paths. Native
companion upload code and research stay in the desktop repository; update both
repositories when their HTTP contract changes. Old release sections below
record the export workflow as historical context, not current instructions.

Verification from the permanent checkout: all 132 web unit/component/handler
tests and the production build pass. The native package builds independently
and all five CloudCoachClient tests pass with the web folders absent. Current
README/agent/integration document links resolve across the sibling layout.
Source checks confirm unchanged native implementation and unchanged transferred
web/backend application files, apart from updating missing README references.
Local `.env.local` and Supabase link state remain ignored. Running the linked
migration listing from this repository confirms local/remote parity without
applying changes. Release `5e6fde6cae45257e9de2315e85bf8007f98fc38b` is committed
and deployed through [successful CI/Pages workflow](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/42898031488),
including 132 tests, 22 browser workflows, runtime/build checks and eight
PostgreSQL 17 permission suites. The live app returns HTTP 200. The desktop
split is recorded locally as commit `8b87981`; no native GitHub repository was
created. No cloud migration or resource change was required.

## Timeline header and capture rows simplified

The timeline header no longer shows event/comment/capture counts, which pushed the
toolbar buttons around. Drawing captures now render as ordinary timeline rows (time
in the gutter, dot on the spine, "Drawing capture" label, thumbnail, note and author).
Flags, Fights without you and Opponent items are removed entirely: no filter options
and no timeline events (teamfights the player took no part in are not listed). This
diverges deliberately from native `ReviewTimeline.swift`, which still builds them.
Frontend only; no backend change.
All 132 unit tests, the production build and 22 Chrome workflows pass.

## Capture timeline row layout correction

Capture buttons now span all three timeline grid columns, with the text
allowed to fill the space beside the thumbnail. Previously the single button
occupied the 52px timestamp gutter (44px on mobile), causing the timestamp,
label and note to wrap one character per line. Added Chrome assertions check
full-row button width and readable title dimensions, including the 300px
minimum desktop panel and 390px mobile viewport. Production build and the two
affected owner/coach workflows pass; desktop and mobile screenshots were
inspected. Release `a8334efbdd06ddf97ecb125fd3507f1677c44c9a` is deployed through
[successful Pages workflow](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/42886000647),
including all 132 tests, 22 browser workflows and eight PostgreSQL 17 suites.
The public stylesheet was checked for the full-grid capture placement. No
database or native changes were needed.

## Drawing captures (deployed)

Owner and watch pages now have **Draw** (D): pause/freeze a video frame, annotate
with pen/highlighter/arrow/eraser, colour/width, undo/redo/clear, then **Capture
to timeline** with an optional note and coach display name. Captures appear
with lazy-loaded thumbnails, open as full stills and jump to the exact video
timestamp. Cancel and successful capture leave playback paused. Failed saves
keep the drawing and note for retry. Owners moderate all captures; coaches
delete only their own browser-key-authored captures.

Stream extracts its decoded frame with anonymous CORS. YouTube requires an
explicit browser tab-share picker for one screenshot; sharing ends immediately
after capture or failure. The full player must be visible. Screens/windows are
rejected; the chosen tab cannot be verified, so the editor explicitly asks the
user to check the frozen frame. YouTube tab capture needs a supported desktop
browser; mobile YouTube capture is unavailable. Real provider CORS and the
manual YouTube picker remain live acceptance checks.

Migration `202611100005_drawing_captures.sql` adds a private RLS table and narrow
metadata/image/save/delete RPCs. JPEG binary rows are capped at 256 KiB each and
50 per recording (quota checks serialize concurrent saves); the frontend limits
the long edge to 1280 px. Image bytes are omitted from ordinary review loads.
The existing owner/watch validity and author-hash checks protect every image
read/write; no public URLs or storage bucket are introduced. Captures are
flattened stills, editable before saving. Recording removal cascades their
metadata/images and leaves video originals alone.

Deployment: migration `202611100005_drawing_captures.sql` is applied to the
existing hosted project; the migration list confirms local/remote parity.
Frontend release `4dd89bdda814dc7b8813658a07f0d9cdf2277bea` is deployed through
[successful Pages workflow](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/42884663848).
CI passed all 132 tests, 22 Chrome workflows, runtime/build checks and eight
PostgreSQL 17 permission suites. The public site returns HTTP 200 and its
`index-CJG2q-LH.js` bundle contains the drawing editor and capture RPC integration.
Live negative checks confirmed capture list/image/save/delete endpoints and
direct-table reads reject anonymous/invalid-capability requests with 401/42501;
no personal data or test capture was created. No backend function/native rebuild is needed. The
native workspace has a clean starting `main` branch with no configured remote;
no native source was changed or published. Generated test video is stored as
base64 text so the export's movie-file exclusion does not drop it.

Verification: 132 unit/component/handler tests, production build and all 22
Chrome workflows pass, including real canvas rendering over a generated video,
paused-state preservation, undo/redo/clear/eraser, JPEG pixel verification,
failed-save recovery, exact timestamp seeking, reload persistence, desktop and
390px mobile layouts and coach moderation UI. Desktop/mobile screenshots were
inspected. All eight permission suites pass on a disposable PostgreSQL 16
instance; CI runs PostgreSQL 17 and now includes the capture suite. Capture SQL
checks include cross-owner denial, private grants, guest authorship, JPEG/type/
size validation, quotas, moderation, revocation, expired Stream sessions and
disabled membership. Browser backend/auth/provider media are simulated; these
checks do not prove a real YouTube picker or hosted Cloudflare capture. The
web-only export includes the new migration, tests, synthetic fixture, canonical
agent guide and rebased README. Hosted migration and frontend publication are
complete. Manual acceptance of the real YouTube tab picker and authenticated
capture on a personal Cloudflare recording remains outstanding.

## Timeline uses available window height

The desktop review panel is no longer sized by the video's grid row. It has an independent viewport-based height from its top edge to 24 px above the bottom of the window, with a small minimum for short windows. Width dragging and the original video aspect ratio are preserved; narrowing the video no longer shortens the timeline. On stacked mobile layouts, the timeline uses 75% of the dynamic viewport height and retains its internal scroll area. The page footer may sit below the fold instead of taking space from the review panel.

Verification: production build and both affected owner/coach and tall-timeline browser workflows pass. Checks cover a dark 2048×1126 layout (timeline exceeds video/control height by over 100 px), shorter desktop windows, sidebar collapse, width resizing, hiding/restoring the panel and the 390 px stacked layout without horizontal overflow. Desktop and mobile screenshots were inspected. No backend or native change is included. Frontend release `dafafa40f1190b613b21b127b729a85212bce6d9` is deployed through [successful Pages workflow](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/42879776947), which passed all 128 tests, 20 browser workflows, runtime/build checks and seven PostgreSQL 17 suites.

## Exact comment and event seeking

Comments now seek directly to their saved video timestamp, preserving millisecond precision. All timeline rows and embedded fight moments seek exactly, except ultimate casts and deaths, which retain a five-second lead-in. Embedded kills/assists and absence links are exact; embedded deaths retain the lead-in. The same rule applies when a click first prompts the owner to sync the clock, and row tooltips match the policy. Shared coach playback uses the same behavior. No stored timestamps, timeline judgments or backend contracts change.

Verification: 128 unit/component/handler tests and production build pass. Component coverage exercises a fractional comment timestamp, a solo kill, teamfight row, embedded kill/assist/death, standalone death, ultimate cast and objective, plus exact seeking after clock sync. The affected owner/coach and ultimate browser workflows verify exact comments/fights and retained ultimate lead-in; the full browser suite is also checked by release CI. Frontend release `9fc79b121953b0cc985b334016d7edc70ab4c5bc` is deployed through [successful Pages workflow](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/42839901822), including all 128 tests, 19 browser workflows, runtime/build checks and seven PostgreSQL 17 suites. The public bundle no longer contains the old three-second comment-seek tooltip. No backend or native change is needed.

## Browser library cache

The library now initializes from a project/account-scoped cache of allowlisted titles, dates, provider IDs and share-state metadata, then refreshes in the background without replacing saved rows with a loading screen. Cold loads fetch metadata before Cloudflare upload reconciliation, so provider latency does not block the list. Cache snapshots last up to seven days and contain at most 1,000 rows. Mutations invalidate stale in-flight list responses; removing a row prunes its preview. Explicit permission denial clears cached data. Normal Supabase session and enabled-membership checks still precede rendering.

Stream preview bytes are cached in IndexedDB, keyed by account/recording/provider-video identity, with an in-memory blob URL for immediate return visits. Up to 96 raster images of at most 256 KiB each are retained for seven days. Signed image URLs and credentials are not persisted by the cache. A fresh browser page can read the saved image without another thumbnail lease or any video playback. If storage/CORS is unavailable, the direct image flow remains available. Sign-out/account switching clears metadata, image bytes and object URLs, and in-flight work cannot restore the signed-out cache. YouTube keeps its stable public thumbnail/browser HTTP-cache behavior.

Verification: 127 unit/component/handler tests, production build and all 19 Chrome workflows passed. The new real-browser storage test holds the list RPC after a full reload, verifies saved title/blob thumbnail rendering before releasing the server response, checks the updated server title is applied, confirms zero playback requests and no repeated thumbnail authorization, then confirms metadata and IndexedDB are empty after sign-out. Focused decoding/zero-playback assertions passed afterward. Browser auth/media are simulated; storage uses real Chrome localStorage/IndexedDB. No backend, schema or native change is required. Frontend release `dca53caeea3b7a724527f22462934675bf1f9fde` is deployed through [successful Pages workflow](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/42837368708), including all 127 tests, 19 browser workflows, Edge Function/runtime/build checks and seven PostgreSQL 17 permission suites.

## Library labels and first-frame thumbnails

Library rows no longer repeat GAME RECORDING or In your library; Shared remains when a share exists. Stream recordings load private first-frame thumbnails at `time=0s` through the new owner-only `thumbnail` Stream action. It verifies the JWT, enabled membership and library ownership, rechecks provider readiness/privacy, then returns a five-minute signed image URL without download permission. The client loads previews near the viewport, renews a failed image once and retains the play placeholder if unavailable. YouTube entries retain YouTube's supplied thumbnail; arbitrary first-frame extraction is not provided by its embed API. Mobile row actions now sit below the title/meta instead of squeezing the title into a narrow column.

The updated Stream function is deployed. Frontend release `1caf40fc8e544f6e6265eaf09ee9df45b0b4b363` is deployed through [successful Pages workflow](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/42831553702), which passed all 121 web tests, 18 Chrome workflows, three Edge Function checks, build/runtime checks and seven PostgreSQL 17 suites. A live unsigned thumbnail request returned 401. Verification: 121 unit/component/handler tests, production build, Stream Deno check and all 18 Chrome workflows passed; the affected mobile/thumbnail workflows passed again after layout polish. Desktop and mobile screenshots were inspected. Provider/ownership/guest denial and signed `0s` thumbnail contracts are covered; browser media and authentication are simulated. No database migration or native app change is required for this release.

## League Helper Push to web

League Helper is retained as the capture/upload companion. Its completed-recording action menu and player toolbar now expose **Push to web…** (Command-Shift-U in the player). A browser approval page links a Keychain-held upload-only capability to the existing enabled owner; the web sidebar's **Connected apps** lists/revokes connections. Capabilities expire after 90 days, and only their SHA-256 hashes are stored. Native code/configuration remains in the original workspace and is excluded from the standalone export.

Push prepares the Riot timeline locally (cached or fetched using the native Riot client), runs only the R-slot ultimate detector, reduces the timeline to the web schema without puuids/Riot IDs/summoner names, and uploads the original video directly to Cloudflare in 8 MiB TUS chunks. It publishes the attached match, anchor and versioned ultimate video timestamps after provider readiness/privacy/creator checks. Open in web appears only after review publication succeeds. Local comments, Gate results, ratings and AI findings are excluded. Originals remain local. The original Twisted Fate/HUD-layout detection limitations remain.

The native app owns the push task across sheet closure. Pause and retry use protected job files scoped by web owner and local recording ID, check file size/modification date and resume from Cloudflare's HEAD offset. Processing/published retries reuse the existing video, including after a failed metadata save. Processing is polled for ten minutes per attempt; retry later if needed. A reserved upload retains its title (rename on the web). Expired/removed provider uploads need manual recovery, and deliberately removed library entries are not silently restored. The companion currently handles one push at a time rather than a multi-game queue.

The `companion` Edge Function implements capability authorization on each request (`verify_jwt = false` at the gateway), a 2 MB request limit and a strict review allowlist. Migration `202611100004_companion.sql` adds private device approvals, service-only authorization/lookup/publication RPCs and preserves imported markers when refreshing the same Riot timeline. A different attached match or detached review clears them. The imported markers appear for owners and watch-link viewers, seek with normal pre-roll, and follow web clock resync while retaining their video positions. Neutral monster team ID 300 is accepted, as confirmed by the full native timeline fixture.

Deployment: the migration is applied and the companion function is deployed to the existing project. Frontend release `423a435232fc3bf03795950a7475320f23a33601` is deployed through [successful Pages workflow](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/42825820845), including all 119 web tests, 17 Chrome workflows, three Edge Function checks, build/runtime checks and seven PostgreSQL 17 security suites. Live negative checks returned 401 for missing/invalid companion capabilities, anonymous authorization/list/approval RPC calls; no personal recording or owner approval was created during these checks. Verification: native app build succeeded in a separate temporary derived-data directory; all 918 Swift tests (including five native client/export contract tests) passed. The full native fixture exported 32 frames, 40 kills and 463 item events in 67 KB and passed the actual TypeScript backend validator. All 119 web/unit/handler tests, production build, companion Deno check, all 17 Chrome workflows and all seven SQL suites on disposable PostgreSQL 16 passed. Browser coverage includes explicit companion approval and signed-out coach seeking from an ultimate marker; screenshots were inspected. CI uses PostgreSQL 17. After the recording completed, the old app was quit gracefully and the signed build in the original workspace’s ignored `build/push-to-web/LeagueHelper.app` was launched successfully. Read-only checks confirmed the latest recording is completed and intact, but not match-linked; the local match cache is behind. The saved native Riot key is rejected by Riot with HTTP 403, so a current key and match sync are needed for that game. Desktop UI automation is denied by macOS Accessibility permissions; native account linking requires manual Connect to web/browser approval. A real personal recording push and native UI interaction remain acceptance checks.

## Native background upload follow-up

Native source now dismisses Push to web immediately after starting the app-owned task. The sidebar and Recordings toolbar retain an upload status button; Recorder → Web Upload (Command-Option-U) opens a separate nonmodal progress window with pause/resume, error details and Open in web. The request retains its title and anchor when reopened. A user-initiated process activity keeps the transfer progressing while review windows are closed or another app is active, and is released when the task exits. The app must remain running. A signed build passed `xcodebuild` and is staged separately in the native workspace's ignored `build/push-to-web-background/LeagueHelper.app`; the existing running app was not restarted/replaced because an upload may be in progress. No web/backend changes are required. Manual native interaction remains unverified with macOS Accessibility control unavailable.

## Review page polish

Video and watch pages put back, title, date and Share/“Shared with you” on one line. Game attachment and clock sync moved into a timeline settings cog (owner only, gold dot while setup is incomplete); coaches see a one-line note while the clock is unsynced. Seek controls are centred −30/−15/−1/+1/+15/+30 s buttons; arrow-key seeking is unchanged but no longer advertised anywhere in the UI. The timeline width is drag/keyboard resizable (double-click resets; `league-cloud-coach-timeline-width`) and can be hidden to an edge rail (`league-cloud-coach-timeline`). Lane-matchup cards mirror the two laners (you left, opponent right) with GOLD/CS/XP labels and the coloured difference on a centre axis and the leading value emphasised, plus KDA and level. A play/pause button sits between −1s and +1s for both YouTube and Stream players. Whole timeline rows (not only titles) seek; clicks on inner buttons or that end a text selection are ignored. For the owner, clicking any event before the clock is synced opens the inline Sync clock form at the top of the timeline (not a modal, so the frame's timer stays readable; the video position is read live and on save) and then jumps to that event; coaches' unsynced events stay inert. Comments and all timeline events seek exactly, except ultimate casts and deaths, which retain a 5 s lead-in. This includes exact kills/assists and early deaths inside fight cards. The `riot` reducer now stores per-frame `xp` and `level`; timelines attached earlier lack them (the XP row is hidden) until refreshed through the cog → Change game → Refresh timeline. The updated function is deployed.

## Wider review layout and collapsible sidebar

The top bar has a sidebar toggle (remembered per browser as `league-cloud-coach-sidebar`; not shown on phones, where navigation is a top bar). Owner video pages and watch pages now use the full content width. The video takes the largest 16:9 size that keeps the player and its seek controls on screen below the page heading (measured in `VideoReview`), the timeline takes the remaining width and independently fills the available window height, and below a 900px container width the timeline stacks under the video. Verified with 109 unit tests, build and all 16 Chrome checks, including a 1903×958 collapsed-sidebar check of aspect ratio, fit and panel alignment.

## Review timeline and shared comments

Owner video pages and watch pages now place a review timeline beside the player (stacked below it under 1280px). It ports the native `ReviewTimelineBuilder`: solo kills/deaths, teamfight cards with location, outcome, dive callouts and the player's moments or event-backed absence, rewatch flags, recalls with purchases and build after, per-minute lane matchups, objectives and (hidden by default) opponent purchases. Filters persist per browser; the list follows the playhead until the reader scrolls. One deliberate difference: Riot stamps minute frames a few milliseconds late (60023…), and the native "exact multiple of 60 s" check drops every lane-matchup row on real payloads; the web accepts frames within 5 s of a minute. The native bug is not fixed here.

**Attach game** lets the owner pick a game already synced in Home. The `riot` function's new `review-timeline` action verifies the JWT, membership, recording ownership and the saved match, fetches `/lol/match/v5/matches/{id}/timeline` once, reduces it (about 70 KB for a 32-minute game against roughly 920 KB raw; no puuids, Riot IDs or summoner names) and stores it through service-only `save_recording_timeline`. **Sync clock** stores one game-clock/video-position anchor in the existing `recordings` anchor columns; only ultimate/death events seek five seconds early; other events seek exactly, and events are disabled until synced or outside the video. Coaches need no Riot token.

Comments are pinned to the video position, shown in game time once synced, and come in Comment, Question and (owner only) Mindset kinds. The owner writes through membership-checked RPCs; anyone holding a valid watch link writes through `add/update/delete_shared_comment` with a name and a per-browser author key (localStorage; only its SHA-256 hash is stored). Guests change only their own comments; the owner edits their own and may delete any. Reads/writes follow the same validity rule as share resolution, so revocation and Stream expiry end guest review access. Polling every 20 s and on focus picks up the other party's comments. Limits: 2,000 characters per comment, 1,000 comments per recording.

Migration `202611100003_review_timeline.sql` is applied to the hosted project and the updated `riot` function is deployed (gateway JWT verification off, as before; the handler verifies). Live anonymous checks: unknown watch links return null from `get_shared_review`; `get_recording_review`, `save_recording_timeline` and direct `recording_comments` reads are denied (401/42501); the `review-timeline` action without a session returns 401. Frontend release `dea872f`/fix `review-security` PASS line is deployed through [successful Pages workflow](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/42812718258), which passed unit, browser, runtime, build and all six PostgreSQL 17 suites; the live bundle contains the review UI. Verification: 109 unit/component/handler tests, production build, `deno check` of the `riot` function, all 16 Chrome workflows (including a new owner attach → sync → seek → comment → signed-out coach reply flow at desktop and phone widths, light and dark; screenshots inspected) and all six SQL suites on disposable PostgreSQL 16, including the new `review-security.sql` (cross-owner, anonymous, author-key, moderation and revoked-link denial). The reducer and builder were also run on a real cached timeline from the native store. A real Riot timeline fetch through the deployed function and real-owner acceptance remain unverified.

## Match-history days and selector spacing

Home match history now groups visible games beneath full calendar-date headings with per-group game counts, using each game's start time and the viewer's local timezone. Groups preserve the selected newest/oldest order and follow filters and pagination; empty dates are omitted. Day grouping handles midnight and daylight-saving transitions without UTC-date truncation. Existing match rows and scoreboards keep their information and interactions.

All single-choice selectors use a consistently inset chevron, 12px from the right edge with 36px text padding, in light and dark modes. They remain native select elements for keyboard/popup behavior.

Verification: 95 unit/component/handler tests and production build passed locally. The Chrome check verifies date groups, sorting/filtering, both themes, arrow inset/text padding and mobile fit; screenshots were inspected. Frontend release `5ff512d467bedc452c5bb950e36b3a3961aae229` is deployed through [successful Pages workflow](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/42807129412), which passed all 95 tests, 15 browser checks, runtime/build checks and the five database security suites. No backend or schema change was included in this UI release.

## Appearance and bottom Settings

Settings is anchored at the bottom of the desktop sidebar, above the workspace footer; mobile retains accessible Settings after the main navigation. Settings has an Appearance section with a keyboard-accessible Dark mode switch. It applies immediately, defaults to light, and saves only the theme preference in browser local storage (`league-cloud-coach-theme`). Theme persists across reload and sign-out; no server preference or token-storage change is involved. Dark styling covers the workspace, Home statistics/history, library, forms/dialogs, notices, buttons and inputs while preserving video/images.

Local verification: all 92 unit/component/handler tests and production build passed. The new Chrome check verifies sidebar position, immediate theme changes, browser persistence after reload, keyboard toggling, desktop/mobile fit and dialog colors; screenshots were inspected. Frontend release `5433e47b670c43bc5181ab4bbf6387012d0571ed` is deployed through [successful Pages workflow](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/42805071817), which passed all 92 tests, 14 browser checks, both runtime checks, production build and all five database security suites.

## Video seeking and new-token propagation

Video seek controls now support Left/Right for 1 second, Shift+Left/Right for 10 seconds and Ctrl+Left/Right for 30 seconds, with Ctrl precedence. Uploaded-video key events are captured before native arrow defaults; seeks clamp to duration and do not change pause/play state or multiply by playback rate. Buttons expose the same modifiers and a compact shortcut legend. YouTube uses its IFrame seek API from page controls; focus the seek buttons beneath its iframe, since keyboard events inside a cross-origin YouTube embed stay with YouTube. No shortcuts are captured outside the player or in editable controls; Alt/Meta combinations are preserved.

Settings now saves a well-formed Riot token even if verification fails or the new token has not propagated. It shows an amber saved-with-warning notice explaining that newly generated tokens may take a few minutes to work, rather than rejecting the replacement or claiming it was verified. Sync authentication errors carry the same guidance. Encryption, membership/owner checks and invalid-format/storage errors are unchanged. No token-storage location change is included.

Frontend release `58f6d90` is deployed through [successful Pages workflow](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/42804203642), and the updated Riot function is deployed. Verification: 92 unit/component/handler tests, production build, Deno runtime check and all 13 Chrome workflows passed; CI also passed both runtime checks and all five PostgreSQL security suites. New tests cover both player adapters, modifier/direction rules, boundaries, playback-rate independence, saved-but-unverified warnings and browser-level keyboard behavior on a synthetic seekable media timeline.

## Riot token Settings and sign-out confirmation

The owner can now open **Settings → Riot connection** to save/replace/remove their own API token. The input is masked, clears after successful save, and never reads a stored token back. The authenticated backend saves a candidate even when Riot verification is pending, returning a propagation warning, encrypts it using AES-GCM with a fresh nonce, and stores only ciphertext in service-only `riot_credentials`. Owner identity comes from the verified JWT. `RIOT_TOKEN_ENCRYPTION_KEY` is configured in the existing backend; preserve it across redeploys. An optional legacy `RIOT_API_KEY` remains a fallback when no personal token exists. Saving refreshes Home. The header now says **Sign out** and opens a confirmation with Cancel; no sign-out request is made until confirmed, and failures stay retryable in the dialog.

Migration `202611100002_riot_tokens.sql` is applied and the updated `riot` function is deployed. Frontend release `3740e13a292d3b473232e5fb4cde244ae068134e` passed [Pages workflow](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/42801018931): 88 unit/component/handler tests, 11 browser checks, both runtime checks, production build and all five PostgreSQL 17 security suites. Local unit/build/runtime/encryption and disposable PostgreSQL checks passed; local Chrome also encountered broad navigation timeouts, so browser acceptance relies on the successful CI run. Token validation, ciphertext round-trips/nonces/tamper rejection, no readback, and saving an unverified replacement with a warning have automated coverage. A real owner's Riot token has not been supplied or tested; enter it through Settings, never chat.

## League Home and Riot sync

Home (`/#/home`) is now the default root/sign-in destination, with Video library preserved separately. It supports saved Riot profiles across EUW/EUNE/NA/KR, current level/ranks/LP, native recent-game windows, Solo/Duo scope, champion/role stats, result strips/streaks, season/split champion records, champion/opponent/lane/queue/patch/result filters, sorting, and expandable scoreboards with roster/KDA/damage/wards/CS/items. Spells/runes and champion/profile icons use public static assets. Owner/browser preferences remember the selected profile, window size and queue preference. No sample matches are presented as personal data.

Native statistic parity: remakes excluded from statistical signals but retained as window slots; time-weighted farm/gold; primary-role dashboard ratios; per-game mean team shares excluding zero denominators; all-role champion farm; full matchup record independent of result filter; lane-aware opponent matching; patch-based season and seeded season-16 split boundaries (16.1,16.9,16.15). Tests cover these rules. Custom Mac split settings, journal/check-in/review data, rank observations/per-game LP changes and recording links are not migrated; no complete native-app parity is claimed for those local-only features. Historical Riot availability and synced coverage constrain totals.

Migration `202611100001_league_home.sql` is applied to the existing hosted project. It adds RLS-protected profile/match storage and narrow owner read RPCs, service-only sync leases/completion and shared Riot request scheduling. The deployed `riot` Edge Function validates the owner JWT and enabled membership before accessing Riot, derives owner identity server-side, whitelists platform hosts, stores API-derived fields and caches immutable matches. Five-game pages preserve completed matches on failure; an owner-scoped persistent history cursor supports later visits. Stored data loads first, followed by background refresh. The existing video backend/data are unchanged.

**Activation:** Owners now enter their own token through Settings, as described above. No key has been copied from native app settings. Real Riot lookup/sync and acceptance with the owner's account remain unverified until a valid token is entered. Missing-key/expiry errors preserve saved history.

Verification: 82 frontend/unit/handler tests, production build and the Riot function's Deno type check passed. All four database suites passed on a disposable local PostgreSQL 16 instance (CI uses 17), including cross-owner/non-owner/disabled-owner denial, anonymous grants, sync exclusion and cursor monotonicity. Live anonymous checks returned 401 for profile-list RPC, direct profile/match tables and the Riot endpoint. Desktop/mobile Chrome contract tests cover account addition, focus/Escape, filters/record semantics, expanded scoreboards, viewport fit and library navigation. Screenshots were inspected. These are simulated backend tests, not real Riot or Google authentication acceptance. Frontend release `71e5100b310c65f704159896e4dc47ec75cb053d` is deployed through the canonical web-only export and [successful Pages workflow](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/42794082266). CI passed all 82 tests, ten browser checks, both function runtime checks, the production build and all four PostgreSQL 17 permission suites. The initial release run failed only on Mac-specific screenshot output paths; the successor uses portable Playwright artifact paths.

## Reviewer playback loading

The watch page no longer displays the No account needed badge, and the share dialog omits that repeated assurance. The session countdown shows only time remaining, without explaining refresh/deadline implementation rules. Stream playback uses the existing centered player overlay with an animated spinner and Loading video text. Loading persists through access authorization until the video can play, returns during buffering, and clears on playback readiness or an error. Authorized media preloads without autoplay; guest session claiming still requires Start session. Regression coverage checks readiness, buffering, and error transitions. This follow-up is prepared for the standalone web release; check the Pages workflow for its deployment status. The earlier interface cleanup is deployed in web commit `d5369dd` ([successful Pages run](https://github.com/Daniel-sims/league-cloud-coach/actions/runs/42780580668)).

Verification: 63 frontend tests and production build passed. All eight browser regression checks passed, with the sharing check rerun after replacing its removed-badge assertion with a check that guests see no sign-in gate. Real recording playback and visual acceptance remain separate.

## Interface cleanup

The library now keeps one How it works entry, removes the duplicate Start sharing promotion and permanent library marketing tip, and uses Upload your first video for the cloud empty state. Add existing video remains a separate import action; the development preview retains its link-only empty state. Help explains upload-or-import → create link → send to coach, including automatic library insertion after processing. Account access and production sign-in failures no longer expose Supabase setup or repository paths. Sharing copy describes access delays without playback-token terminology. Owner Stream playback loads the player directly without an extra Load video button; guest playback still requires explicit Start session before claiming the timed session, and video playback remains manual.

The interface cleanup is prepared for the standalone web release using the export helper. Check the Pages workflow for its deployment status. Verification: 62 frontend tests, all eight simulated-backend browser workflow checks, production build, and diff whitespace checks passed. Coverage includes automatic owner-player loading, explicit guest session start, and the cloud empty-state upload action. Live visual acceptance remains unavailable without an in-app browser connection.

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

1. A multi-game upload queue or separate streamlined companion if needed; the current single-recording Push to web is implemented in League Helper.
2. Automatic YouTube uploads after explicit channel authorization. Google identity login alone does not grant `youtube.upload`; recheck API/OAuth requirements when implementing it.
3. Extend the implemented versioned timeline/anchor/ultimate export to local comments and richer review data.
4. Beyond the review timeline above: match-level notes, nested replies to individual comments, native ultimate/death-review cards, and importing comments from the Mac app.
5. Broader user onboarding only when intentionally opening the product beyond its initial owner.

No ordering or implementation beyond the current release should be inferred as already authorized by the roadmap.

## Native integration and source ownership

League Cloud Coach is developed directly in its independent repository at
`~/Documents/Dev/league-cloud-coach/`. The desktop app is the sibling
`../league-helper/`. Neither repository is nested inside the other. Each has
its own root README, agent guide and Git history. Web changes are committed
here and published through the existing GitHub Pages workflow; no export helper
or copy operation is part of development. Do not use an old temporary release
checkout as the canonical source.

`web/` and `supabase/` belong here. The root guides and this web project state
are maintained here directly. The native repository owns `LeagueHelper/`,
`LeagueHelperKit/`, native research and `docs/cloud-coach-companion.md` for its
upload client. Companion HTTP APIs connect the apps; they do not need shared
source folders to build.

Native capture writes HEVC/AAC MOV originals under `~/Movies/League Helper/`.
The silent, low-frame-rate AI proxy is unsuitable for coaching playback.
Preserve game/video clock anchors. Read the sibling desktop repository's
`CLAUDE.md` and capture/review research before native changes. Native history,
source, local databases, recordings and private job files must stay out of this
public web repository. Existing history here is already web-only and is kept.

## Updating this handoff

After meaningful work, update the date, implemented behaviour, verification, remaining acceptance work, and deployment pointers as needed. Keep credentials and personal account data out. Keep architectural rationale in `docs/league-cloud-coach-web-plan.md` and repeatable operational steps in the root `README.md`. Check current Git/CI/service state instead of treating historical test counts or a previous deployment as a new verification.
