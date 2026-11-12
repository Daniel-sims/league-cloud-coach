begin;
insert into auth.users(id) values ('31111111-1111-4111-8111-111111111111'),('32222222-2222-4222-8222-222222222222');
insert into public.owner_memberships(user_id,enabled) select id,true from auth.users;
set local role authenticated;
select set_config('request.jwt.claim.sub','31111111-1111-4111-8111-111111111111',true);
select public.add_recording('Guest links','dQw4w9WgXcQ',null) as recording \gset
select set_config('test.recording', :'recording',true);
select public.create_guest_link(:'recording','Coach Sam') as sam \gset
select public.create_guest_link(:'recording','Riley') as riley \gset
select set_config('test.sam', :'sam',true);
select set_config('test.riley', :'riley',true);
do $$ declare v jsonb; begin
  if (select count(*) from public.list_recording_guests(current_setting('test.recording')::uuid)) <> 2 then raise exception 'Guests not listed'; end if;
  begin perform public.create_guest_link(current_setting('test.recording')::uuid,'  '); raise exception 'Blank guest name'; exception when invalid_parameter_value then null; end;
  perform public.add_recording_moment(current_setting('test.recording')::uuid,95000,'Look at the trade');
end $$;
-- Another owner can manage nothing here.
select set_config('request.jwt.claim.sub','32222222-2222-4222-8222-222222222222',true);
do $$ declare g uuid; begin
  begin perform public.create_guest_link(current_setting('test.recording')::uuid,'Eve'); raise exception 'Cross-owner guest link'; exception when insufficient_privilege then null; end;
  begin perform public.list_recording_guests(current_setting('test.recording')::uuid); raise exception 'Cross-owner guest list'; exception when insufficient_privilege then null; end;
  begin perform public.add_recording_moment(current_setting('test.recording')::uuid,1,''); raise exception 'Cross-owner moment'; exception when insufficient_privilege then null; end;
end $$;
set local role anon;
-- Guests learn who they are, and the name is not chosen by the browser.
select guest_name as sam_name, guest_key as sam_key from public.resolve_recording_share(:'sam') \gset
select guest_key as riley_key from public.resolve_recording_share(:'riley') \gset
select set_config('test.samkey', :'sam_key',true);
select set_config('test.rileykey', :'riley_key',true);
do $$ begin
  if current_setting('test.samkey') = current_setting('test.rileykey') then raise exception 'Guests share a key'; end if;
  if has_table_privilege('anon','public.recording_guests','select') or has_table_privilege('anon','public.recording_moments','select') then raise exception 'Direct guest table access'; end if;
  if has_function_privilege('anon','public.create_guest_link(uuid,text)','execute') or has_function_privilege('anon','public.add_recording_moment(uuid,integer,text)','execute') then raise exception 'Guest owner access'; end if;
end $$;
select public.add_shared_comment(:'sam',:'sam_key','Someone Else',1000,'comment','From sam');
select public.save_shared_notes(:'riley',:'riley_key','Imposter','Riley notes',0,false);
do $$ declare v jsonb; begin
  v := public.get_shared_review(current_setting('test.sam'), current_setting('test.samkey'));
  if v->'comments'->0->>'author' <> 'Coach Sam' or (v->'comments'->0->>'mine')::boolean is not true then raise exception 'Guest name not owner-set'; end if;
  if v->'moments'->0->>'note' <> 'Look at the trade' then raise exception 'Guest cannot see key moments'; end if;
  v := public.get_shared_review(current_setting('test.riley'), current_setting('test.rileykey'));
  if (v->'comments'->0->>'mine')::boolean then raise exception 'Guest owns another guest comment'; end if;
  if public.get_shared_notes(current_setting('test.sam'), current_setting('test.samkey'))::text like '%Riley notes%' then raise exception 'Guest read another draft'; end if;
  -- Riley's link cannot edit Sam's comment even with Sam's key? (key is the identity) -- but wrong key cannot.
  begin perform public.delete_shared_comment(current_setting('test.riley'), current_setting('test.rileykey'), (select (jsonb_array_elements(v->'comments')->>'id')::uuid limit 1)); raise exception 'Deleted another guest comment'; exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','31111111-1111-4111-8111-111111111111',true);
do $$ declare v jsonb; begin
  v := public.get_recording_notes(current_setting('test.recording')::uuid);
  if v->'guestDrafts'->0->>'author' <> 'Riley' or v->'guestDrafts'->0->>'body' <> 'Riley notes' then raise exception 'Owner cannot follow guest notes'; end if;
  if public.get_recording_review(current_setting('test.recording')::uuid)::text like '%author_key%' then raise exception 'Key leaked to owner review'; end if;
end $$;
-- Replacing a link keeps identity and ends the old link.
select public.create_guest_link(:'recording','coach sam') as sam2 \gset
do $$ begin
  if (select count(*) from public.list_recording_guests(current_setting('test.recording')::uuid)) <> 2 then raise exception 'Replacement created a duplicate guest'; end if;
end $$;
set local role anon;
select set_config('test.sam2', :'sam2',true);
do $$ begin
  if exists(select 1 from public.resolve_recording_share(current_setting('test.sam'))) then raise exception 'Replaced link still works'; end if;
  if (select guest_key from public.resolve_recording_share(current_setting('test.sam2'))) = current_setting('test.samkey') then raise exception 'Replaced link kept the old key alive'; end if;
  -- The old key no longer reads as anyone's own work; the new one owns Sam's history.
  if (public.get_shared_review(current_setting('test.sam2'), current_setting('test.samkey'))->'comments'->0->>'mine')::boolean then raise exception 'Stale key still owns comments'; end if;
  if not (public.get_shared_review(current_setting('test.sam2'), (select guest_key from public.resolve_recording_share(current_setting('test.sam2'))))->'comments'->0->>'mine')::boolean then raise exception 'Replacement lost identity'; end if;
end $$;
-- Revoking one guest leaves the other.
set local role authenticated;
select set_config('request.jwt.claim.sub','31111111-1111-4111-8111-111111111111',true);
select id as riley_id from public.list_recording_guests(:'recording') where name = 'Riley' \gset
select public.revoke_guest_link(:'recording',:'riley_id');
set local role anon;
do $$ begin
  if exists(select 1 from public.resolve_recording_share(current_setting('test.riley'))) then raise exception 'Revoked guest link works'; end if;
  if not exists(select 1 from public.resolve_recording_share(current_setting('test.sam2'))) then raise exception 'Revoking one guest revoked another'; end if;
  -- Riley's old key is dead even through Sam's still-valid link.
  begin perform public.add_shared_comment(current_setting('test.sam2'), current_setting('test.rileykey'), 'x', 5, 'comment', 'forged');
  exception when others then null; end;
  if exists(select 1 from jsonb_array_elements(public.get_shared_review(current_setting('test.sam2'))->'comments') c where c->>'body' = 'forged' and c->>'author' = 'Riley') then raise exception 'Revoked key still writes as Riley'; end if;
end $$;
rollback;
\echo 'PASS: named guest links, owner-set names, key moments, per-guest isolation, owner-followed notes, rotation and revocation'
