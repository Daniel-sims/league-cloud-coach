-- Reduced review timelines kept with each synced game, so a season pull can
-- curate them once and attaching a game to a recording needs no Riot request.
-- Same payload and privacy rules as recording_timelines: no puuids or Riot IDs.
-- Tables stay service-role only; clients still read matches through RPCs that
-- return only the match column.
alter table public.league_matches
  add column review jsonb check (review is null or jsonb_typeof(review) = 'object'),
  add column review_checked boolean not null default false;
