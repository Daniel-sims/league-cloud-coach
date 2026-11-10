-- Run only against the disposable test database, after all migrations.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
insert into public.owner_memberships(user_id) select id from auth.users;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select public.add_recording('Reviewed game', 'dQw4w9WgXcQ', null) as recording \gset
select set_config('test.recording', :'recording', true);
select public.create_recording_share(:'recording') as token \gset
select set_config('test.token', :'token', true);
select set_config('test.coach', repeat('c', 64), true);
select set_config('test.other', repeat('d', 64), true);

do $$ begin
  if has_table_privilege('anon', 'public.recording_comments', 'select') or has_table_privilege('authenticated', 'public.recording_comments', 'insert')
    or has_table_privilege('anon', 'public.recording_timelines', 'select') or has_table_privilege('authenticated', 'public.recording_timelines', 'select') then
    raise exception 'Direct review table access';
  end if;
  if has_function_privilege('authenticated', 'public.save_recording_timeline(uuid,uuid,text,jsonb)', 'execute')
    or has_function_privilege('anon', 'public.save_recording_timeline(uuid,uuid,text,jsonb)', 'execute') then
    raise exception 'Client can write timelines';
  end if;
  if has_function_privilege('anon', 'public.get_recording_review(uuid)', 'execute')
    or has_function_privilege('anon', 'public.set_recording_anchor(uuid,double precision,double precision)', 'execute')
    or has_function_privilege('anon', 'public.add_recording_comment(uuid,integer,text,text)', 'execute')
    or has_function_privilege('anon', 'public.delete_recording_comment(uuid)', 'execute') then
    raise exception 'Anonymous owner RPC';
  end if;
end $$;

-- Owner: anchor, comment, and review read.
do $$ declare v jsonb; begin
  perform public.set_recording_anchor(current_setting('test.recording')::uuid, 60, 95.5);
  perform public.add_recording_comment(current_setting('test.recording')::uuid, 100000, 'question', '  Should I have backed? ');
  v := public.get_recording_review(current_setting('test.recording')::uuid);
  if (v->'anchor'->>'videoOffsetSeconds')::float <> 95.5 or v->'review' <> 'null'::jsonb then raise exception 'Owner review wrong: %', v; end if;
  if v->'comments'->0->>'body' <> 'Should I have backed?' or not (v->'comments'->0->>'mine')::boolean then raise exception 'Owner comment wrong'; end if;
  begin perform public.set_recording_anchor(current_setting('test.recording')::uuid, 60, null); raise exception 'Half anchor saved';
  exception when invalid_parameter_value then null; end;
  begin perform public.add_recording_comment(current_setting('test.recording')::uuid, 1, 'shout', 'x'); raise exception 'Bad kind saved';
  exception when check_violation then null; end;
  begin perform public.add_recording_comment(current_setting('test.recording')::uuid, 1, 'comment', '   '); raise exception 'Blank comment saved';
  exception when check_violation then null; end;
end $$;

-- Service backend stores the timeline; only for the verified owner's recording.
reset role;
set local role service_role;
do $$ begin
  perform public.save_recording_timeline('11111111-1111-4111-8111-111111111111', current_setting('test.recording')::uuid, 'EUW1_7', '{"version":1}');
  begin perform public.save_recording_timeline('22222222-2222-4222-8222-222222222222', current_setting('test.recording')::uuid, 'EUW1_7', '{}');
    raise exception 'Cross-owner timeline write';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('test.coach_hash', encode(extensions.digest(current_setting('test.coach'), 'sha256'), 'hex'), true);
do $$ begin
  if (select riot_match_id from public.recordings where id = current_setting('test.recording')::uuid) <> 'EUW1_7' then raise exception 'Match link missing'; end if;
end $$;

-- Anonymous coach with the watch link.
set local role anon;
do $$ declare v jsonb; v_comment uuid; v_owner_comment uuid; begin
  if public.get_shared_review(repeat('0', 64)) is not null then raise exception 'Unknown link resolved'; end if;
  v := public.get_shared_review(current_setting('test.token'), current_setting('test.coach'));
  if v->>'matchId' <> 'EUW1_7' or (v->'review'->>'version')::int <> 1 or (v->'anchor'->>'gameTimeSeconds')::float <> 60 then raise exception 'Shared review wrong: %', v; end if;
  if (v->'comments'->0->>'mine')::boolean or v->'comments'->0->>'role' <> 'owner' then raise exception 'Owner comment presented as coach'; end if;
  if v::text like '%11111111-1111-4111-8111-111111111111%' or v::text like '%' || current_setting('test.coach_hash') || '%' then raise exception 'Identity leaked'; end if;
  v_owner_comment := (v->'comments'->0->>'id')::uuid;
  v_comment := public.add_shared_comment(current_setting('test.token'), current_setting('test.coach'), ' Coach ', 120000, 'comment', 'Ward first');
  v := public.get_shared_review(current_setting('test.token'), current_setting('test.coach'));
  if not (v->'comments'->1->>'mine')::boolean or v->'comments'->1->>'author' <> 'Coach' then raise exception 'Coach comment not mine'; end if;
  if (public.get_shared_review(current_setting('test.token'), current_setting('test.other'))->'comments'->1->>'mine')::boolean then raise exception 'Other browser owns comment'; end if;
  perform public.update_shared_comment(current_setting('test.token'), current_setting('test.coach'), v_comment, 'question', 'Ward first?');
  begin perform public.update_shared_comment(current_setting('test.token'), current_setting('test.other'), v_comment, 'comment', 'Hijack');
    raise exception 'Other browser edited'; exception when insufficient_privilege then null; end;
  begin perform public.update_shared_comment(current_setting('test.token'), current_setting('test.coach'), v_owner_comment, 'comment', 'Hijack');
    raise exception 'Coach edited owner comment'; exception when insufficient_privilege then null; end;
  begin perform public.delete_shared_comment(current_setting('test.token'), current_setting('test.coach'), v_owner_comment);
    raise exception 'Coach deleted owner comment'; exception when insufficient_privilege then null; end;
  begin perform public.add_shared_comment(repeat('0', 64), current_setting('test.coach'), 'Coach', 1, 'comment', 'x');
    raise exception 'Unknown link commented'; exception when insufficient_privilege then null; end;
  begin perform public.add_shared_comment(current_setting('test.token'), 'short', 'Coach', 1, 'comment', 'x');
    raise exception 'Weak author key accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.add_shared_comment(current_setting('test.token'), current_setting('test.coach'), null, 1, 'comment', 'x');
    raise exception 'Nameless coach accepted'; exception when check_violation then null; end;
  begin perform public.get_recording_review(current_setting('test.recording')::uuid); raise exception 'Anon owner read';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.recording_comments; raise exception 'Anon table read';
  exception when insufficient_privilege then null; end;
end $$;

-- Another owner can neither read, comment on, nor re-anchor this recording.
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
do $$ begin
  begin perform public.get_recording_review(current_setting('test.recording')::uuid); raise exception 'Cross-owner review read';
  exception when insufficient_privilege then null; end;
  begin perform public.set_recording_anchor(current_setting('test.recording')::uuid, 1, 1); raise exception 'Cross-owner anchor';
  exception when insufficient_privilege then null; end;
  begin perform public.add_recording_comment(current_setting('test.recording')::uuid, 1, 'comment', 'x'); raise exception 'Cross-owner comment';
  exception when insufficient_privilege then null; end;
  begin perform public.delete_recording_comment((public.get_shared_review(current_setting('test.token'))->'comments'->1->>'id')::uuid);
    raise exception 'Cross-owner delete'; exception when insufficient_privilege then null; end;
  begin perform public.detach_recording_timeline(current_setting('test.recording')::uuid); raise exception 'Cross-owner detach';
  exception when insufficient_privilege then null; end;
end $$;

-- The owner moderates: removes the coach comment, cannot rewrite it.
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
do $$ declare v_coach uuid; begin
  v_coach := (public.get_recording_review(current_setting('test.recording')::uuid)->'comments'->1->>'id')::uuid;
  begin perform public.update_recording_comment(v_coach, 'comment', 'Rewritten'); raise exception 'Owner rewrote coach';
  exception when insufficient_privilege then null; end;
  perform public.delete_recording_comment(v_coach);
  if jsonb_array_length(public.get_recording_review(current_setting('test.recording')::uuid)->'comments') <> 1 then raise exception 'Moderation failed'; end if;
  perform public.set_recording_anchor(current_setting('test.recording')::uuid, null, null);
  perform public.detach_recording_timeline(current_setting('test.recording')::uuid);
  if public.get_recording_review(current_setting('test.recording')::uuid)->'anchor' <> 'null'::jsonb
    or public.get_recording_review(current_setting('test.recording')::uuid)->'matchId' <> 'null'::jsonb then raise exception 'Clear failed'; end if;
  perform public.revoke_recording_share(current_setting('test.recording')::uuid);
end $$;

-- Revocation ends guest review access, reads and writes alike.
set local role anon;
do $$ begin
  if public.get_shared_review(current_setting('test.token')) is not null then raise exception 'Revoked link reviewed'; end if;
  begin perform public.add_shared_comment(current_setting('test.token'), current_setting('test.coach'), 'Coach', 1, 'comment', 'x');
    raise exception 'Revoked link commented'; exception when insufficient_privilege then null; end;
end $$;
rollback;
cho 'PASS: review timelines, anchors, owner and coach comments, author keys, cross-owner and revoked-link denial'
