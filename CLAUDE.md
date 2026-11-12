# Claude instructions

Project guidance lives in `AGENTS.md` (loaded alongside this file). Additions below.

## Always deploy after changes

When the user asks for a change to this web app, finish the job by deploying it, without asking first:

1. Apply any new Supabase migration (`supabase db push`; preview with `--dry-run`, never reset the live project).
2. Deploy any changed edge function (`supabase functions deploy <name>`).
3. Commit and `git push origin main` so the GitHub Pages workflow publishes the frontend, then check the workflow run actually succeeded.

Order: migration, then function, then frontend. Run the relevant tests and build before deploying. Report anything that could not be deployed.
