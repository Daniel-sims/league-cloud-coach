# League Cloud Coach

A static web app for a personal League recording library and account-free watch links. Upload videos to YouTube as **Unlisted**, then add their links here. The app never receives video files or uploads to your channel.

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

Create a **Free** Supabase project. In its SQL Editor, run the complete contents of [the migration](../supabase/migrations/202611090001_cloud_coach.sql). Alternatively, link the Supabase CLI to the project and use `supabase db push` with that migration directory. No paid services, storage buckets, or Edge Functions are needed.

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
psql -v ON_ERROR_STOP=1 -f supabase/migrations/202611090001_cloud_coach.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/security.sql
```

Run those paths from the repository root. The tests check validation, private listings, unauthorized accounts, direct mutation denial, cross-owner operations, anonymous capability lookup, share rotation/revocation, disabled owners, and deletion. The fixture transaction rolls back. The CI workflow runs the same tests.

Before launch, manually verify real Google login, add a completed game, signed-out playback with audio, seeking, watch-page reload, link revocation, and library removal. YouTube error 100 means unavailable/private; 101/150 means embedding is blocked; 153 means the embed lacks client identification. The app sends an origin and retains a normal cross-origin referrer.

## Service limits

No paid subscriptions are required for this architecture. Supabase Free has quotas and may pause a project after one week of inactivity. YouTube controls upload limits, processing, ads/branding, and availability. Unlisted videos are accessible to anyone holding their YouTube link. Keep the local originals.

## Future work

The first release deliberately has no file upload endpoint, automatic channel uploads, timeline, or Mac companion. The player wrapper can support YouTube time/seek events when timeline exports arrive. A future companion can reuse native capture and save returned YouTube IDs into the same Supabase user library after receiving explicit YouTube upload authorization.
