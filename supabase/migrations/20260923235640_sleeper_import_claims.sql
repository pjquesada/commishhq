-- Upgrade the earlier Phase 2 migration without deleting imported leagues or approved claims.
-- Both earlier migration files remain immutable. The obsolete service-review API is retired.
drop function public.review_team_claim(uuid,uuid,text);
update public.leagues set current_week=null where current_week=0;
alter table public.leagues drop constraint leagues_current_week_check;
alter table public.leagues add constraint leagues_current_week_check check(current_week between 1 and 22);
alter table public.leagues drop constraint leagues_total_teams_check;
alter table public.leagues add constraint leagues_total_teams_check check(total_teams between 0 and 100);
alter table public.teams add column active boolean not null default true;
alter table public.teams drop constraint teams_points_for_check, drop constraint teams_points_against_check;
alter table public.teams alter column points_for type numeric(14,2), alter column points_against type numeric(14,2);
alter table public.provider_league_members rename to provider_managers;
alter table public.provider_managers rename column provider_user_id to external_id;
alter table public.provider_managers drop constraint provider_league_members_display_name_check;
alter table public.provider_managers add constraint provider_managers_name_check check(length(display_name) between 1 and 200);
create table public.team_provider_managers (
  league_id uuid not null,
  team_id uuid not null,
  manager_external_id text not null,
  primary key (league_id, team_id, manager_external_id),
  foreign key (league_id, team_id) references public.teams(league_id,id) on delete cascade,
  foreign key (league_id, manager_external_id) references public.provider_managers(league_id,external_id) on delete cascade
);
create index team_provider_managers_manager_idx on public.team_provider_managers(league_id,manager_external_id);
insert into public.team_provider_managers(league_id,team_id,manager_external_id)
select league_id,team_id,external_id from public.provider_managers where team_id is not null;
alter table public.matchups rename column opponent_team_id to opponent_id;
alter table public.matchups rename column points to team_score;
alter table public.matchups rename column opponent_points to opponent_score;
alter table public.matchups add constraint matchups_distinct_opponents check(opponent_id is null or opponent_id<>team_id);
create index matchups_team_idx on public.matchups(league_id,team_id);
create index matchups_opponent_idx on public.matchups(league_id,opponent_id);
alter table public.team_claims rename column user_id to requester_id;
alter table public.team_claims rename column reviewed_by to reviewer_id;
alter table public.team_claims add column requester_label text;
update public.team_claims c set requester_label=coalesce(nullif(u.email,''),c.requester_id::text) from auth.users u where u.id=c.requester_id;
alter table public.team_claims alter column requester_label set not null;
update public.team_claims set reviewed_at=coalesce(reviewed_at,created_at) where status='cancelled';
alter table public.team_claims add constraint claims_review_consistency check (
  (status='pending' and reviewed_at is null and reviewer_id is null) or
  (status in ('approved','rejected') and reviewed_at is not null and reviewer_id is not null) or
  (status='cancelled' and reviewed_at is not null));
alter index public.team_claims_one_active_user rename to one_active_claim_per_user;
alter index public.team_claims_one_approved_team rename to one_approved_claim_per_team;
create index claims_requester_idx on public.team_claims(requester_id);
create index claims_review_idx on public.team_claims(reviewer_id);
create index claims_team_idx on public.team_claims(league_id,team_id);
alter table public.sync_runs rename column completed_at to finished_at;
alter table public.sync_runs add column actor_id uuid references public.profiles(id);
update public.sync_runs r set actor_id=l.commissioner_id from public.leagues l where l.id=r.league_id;
alter table public.sync_runs alter column actor_id set not null;
-- Pre-upgrade jobs have no lease; retire them before enabling overlap protection.
update public.sync_runs set status='failed',finished_at=now(),error_code='expired' where status='running';
update public.leagues set sync_status='failed' where sync_status='syncing';
alter table public.sync_runs drop constraint sync_runs_status_check;
alter table public.sync_runs add constraint sync_runs_status_check check(status in ('syncing','complete','failed'));
create unique index one_sync_per_league on public.sync_runs(league_id) where status = 'syncing';
create index sync_runs_actor_idx on public.sync_runs(actor_id,started_at);

create function private.is_commissioner(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.leagues where id=target and commissioner_id=auth.uid());
$$;
revoke all on function private.is_commissioner(uuid) from public,anon;
grant execute on function private.is_commissioner(uuid) to authenticated;

alter table public.provider_managers enable row level security;
alter table public.team_provider_managers enable row level security;
alter table public.matchups enable row level security;
alter table public.team_claims enable row level security;
alter table public.sync_runs enable row level security;
revoke all on public.provider_managers,public.team_provider_managers,public.matchups,public.team_claims,public.sync_runs from anon,authenticated;
grant select on public.provider_managers,public.team_provider_managers,public.matchups,public.team_claims,public.sync_runs to authenticated;
create policy managers_read on public.provider_managers for select to authenticated using (private.can_read_league(league_id));
create policy team_managers_read on public.team_provider_managers for select to authenticated using (private.can_read_league(league_id));
create policy matchups_read on public.matchups for select to authenticated using (private.can_read_league(league_id));
create policy claims_read on public.team_claims for select to authenticated using (requester_id=(select auth.uid()) or private.is_commissioner(league_id));
create policy sync_runs_read on public.sync_runs for select to authenticated using (private.is_commissioner(league_id));
-- Equivalent old policies are replaced rather than accumulating permissive duplicates.
drop policy provider_member_read on public.provider_managers;
drop policy matchup_read on public.matchups;
drop policy claim_read on public.team_claims;

-- Invitation URL is navigation, not membership. This minimal projection deliberately excludes
-- provider IDs, standings, matchups, other claims and approved manager identities.
create function private.claim_options(target uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select jsonb_build_object('id',l.id,'name',l.name,'season',l.season,'teams',
    coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'available',not exists(select 1 from public.league_members m where m.league_id=l.id and m.team_id=t.id)) order by t.external_id)
    from public.teams t where t.league_id=l.id and t.active),'[]'::jsonb)) into result
  from public.leagues l where l.id=target and l.last_synced_at is not null;
  return result;
end;
$$;
create function private.request_team_claim(target uuid, requested_team uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare claim_id uuid; label text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  -- Shared lock order with approval/sync serializes ownership decisions within a league.
  perform 1 from public.leagues where id=target and last_synced_at is not null for update;
  if not found then raise exception 'League unavailable'; end if;
  if not exists(select 1 from public.teams where id=requested_team and league_id=target and active) then raise exception 'Invalid team'; end if;
  if exists(select 1 from public.league_members where league_id=target and (team_id=requested_team or (user_id=auth.uid() and team_id is not null))) then raise exception 'Team or manager already assigned'; end if;
  select coalesce(nullif(email,''),id::text) into label from auth.users where id=auth.uid();
  insert into public.team_claims(league_id,team_id,requester_id,requester_label) values(target,requested_team,auth.uid(),label) returning id into claim_id;
  return claim_id;
end;
$$;
create function private.review_team_claim(target_claim uuid, decision text) returns void
language plpgsql security definer set search_path = '' as $$
declare claim public.team_claims; target uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select league_id into target from public.team_claims where id=target_claim;
  perform 1 from public.leagues where id=target and commissioner_id=auth.uid() for update;
  if not found then raise exception 'Commissioner required' using errcode='42501'; end if;
  select * into claim from public.team_claims where id=target_claim for update;
  if claim.status <> 'pending' then raise exception 'Claim already reviewed'; end if;
  if decision not in ('approved','rejected') or decision is null then raise exception 'Invalid decision'; end if;
  if decision='approved' then
    if not exists(select 1 from public.teams where id=claim.team_id and league_id=target and active) then raise exception 'Team is no longer active'; end if;
    if exists(select 1 from public.league_members where league_id=target and user_id=claim.requester_id and team_id is not null) then raise exception 'Manager already assigned'; end if;
    insert into public.league_members(league_id,user_id,team_id) values(target,claim.requester_id,claim.team_id)
      on conflict (league_id,user_id) do update set team_id=excluded.team_id where public.league_members.team_id is null;
  end if;
  update public.team_claims set status=decision,reviewed_at=now(),reviewer_id=auth.uid() where id=target_claim;
end;
$$;
create function private.cancel_team_claim(target_claim uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  update public.team_claims set status='cancelled',reviewed_at=now() where id=target_claim and requester_id=auth.uid() and status='pending';
  if not found then raise exception 'Pending claim not found'; end if;
end;
$$;
-- PostgREST exposes only invoker wrappers; all identity is derived inside the guarded private functions.
create function public.claim_options(target uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.claim_options(target); $$;
create function public.request_team_claim(target uuid,requested_team uuid) returns uuid language sql security invoker set search_path='' as $$ select private.request_team_claim(target,requested_team); $$;
create function public.review_team_claim(target_claim uuid,decision text) returns void language sql security invoker set search_path='' as $$ select private.review_team_claim(target_claim,decision); $$;
create function public.cancel_team_claim(target_claim uuid) returns void language sql security invoker set search_path='' as $$ select private.cancel_team_claim(target_claim); $$;
revoke all on function private.claim_options(uuid),private.request_team_claim(uuid,uuid),private.review_team_claim(uuid,text),private.cancel_team_claim(uuid),public.claim_options(uuid),public.request_team_claim(uuid,uuid),public.review_team_claim(uuid,text),public.cancel_team_claim(uuid) from public,anon;
grant execute on function private.claim_options(uuid),private.request_team_claim(uuid,uuid),private.review_team_claim(uuid,text),private.cancel_team_claim(uuid),public.claim_options(uuid),public.request_team_claim(uuid,uuid),public.review_team_claim(uuid,text),public.cancel_team_claim(uuid) to authenticated;

-- Import functions can only be invoked by the separate server-only admin client.
-- They recheck persisted commissioner ownership; browser RPC calls are denied.
grant usage on schema private to service_role;
create function private.begin_sleeper_sync(actor uuid, external_league text, league_name text, league_season integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target uuid; owner uuid; run_id uuid;
begin
  if not exists(select 1 from public.profiles where id=actor) then raise exception 'Invalid actor'; end if;
  if external_league !~ '^\d{1,30}$' then raise exception 'Invalid league ID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('sleeper:' || external_league,0));
  select league_id into target from public.league_connections where provider='sleeper' and external_id=external_league;
  if target is null then
    if (select count(*) from public.sync_runs where actor_id=actor and started_at>now()-interval '1 hour') >= 20 then raise exception 'Import limit reached'; end if;
    insert into public.leagues(name,season,commissioner_id) values(league_name,league_season,actor) returning id into target;
    insert into public.league_connections(league_id,provider,external_id) values(target,'sleeper',external_league);
  end if;
  select commissioner_id into owner from public.leagues where id=target for update;
  if owner <> actor then raise exception 'Commissioner required' using errcode='42501'; end if;
  if exists(select 1 from public.sync_runs where league_id=target and started_at>now()-interval '30 seconds') then raise exception 'Please wait before syncing again'; end if;
  update public.sync_runs set status='failed',finished_at=now(),error_code='expired' where league_id=target and status='syncing' and started_at<now()-interval '2 minutes';
  if exists(select 1 from public.sync_runs where league_id=target and status='syncing') then raise exception 'Sync already running'; end if;
  insert into public.sync_runs(league_id,actor_id,provider,external_id,status) values(target,actor,'sleeper',external_league,'syncing') returning id into run_id;
  update public.leagues set sync_status='syncing' where id=target;
  return jsonb_build_object('league_id',target,'run_id',run_id);
end;
$$;
create function private.finish_sleeper_sync(actor uuid,run uuid,snapshot jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare target uuid; item jsonb; manager jsonb; match jsonb; entry jsonb; opponent jsonb; team uuid; other_team uuid; wk integer;
begin
  select league_id into target from public.sync_runs where id=run and actor_id=actor;
  perform 1 from public.leagues where id=target and commissioner_id=actor for update;
  if not found then raise exception 'Commissioner required' using errcode='42501'; end if;
  perform 1 from public.sync_runs where id=run and status='syncing' and started_at>now()-interval '2 minutes' for update;
  if not found then raise exception 'Sync expired'; end if;
  if jsonb_typeof(snapshot->'teams') <> 'array' or jsonb_array_length(snapshot->'teams') = 0 then raise exception 'Invalid snapshot'; end if;
  if not exists(select 1 from public.league_connections where league_id=target and provider='sleeper' and external_id=snapshot->'league'->>'externalId') then raise exception 'Wrong league snapshot'; end if;
  wk := (snapshot->'league'->>'currentWeek')::integer;
  update public.teams set active=false where league_id=target;
  delete from public.team_provider_managers where league_id=target;
  -- Preserve provider IDs and metadata from existing imports; ownership links are replaced below.
  update public.provider_managers set team_id=null where league_id=target;
  for manager in select value from jsonb_array_elements(snapshot->'managers') loop
    insert into public.provider_managers(league_id,external_id,display_name) values(target,manager->>'externalId',manager->>'displayName')
    on conflict(league_id,external_id) do update set display_name=excluded.display_name;
  end loop;
  for item in select value from jsonb_array_elements(snapshot->'teams') loop
    insert into public.teams(league_id,external_id,name,wins,losses,ties,points_for,points_against,active)
    values(target,item->>'externalId',item->>'name',(item->>'wins')::integer,(item->>'losses')::integer,(item->>'ties')::integer,(item->>'pointsFor')::numeric,(item->>'pointsAgainst')::numeric,true)
    on conflict(league_id,external_id) do update set name=excluded.name,wins=excluded.wins,losses=excluded.losses,ties=excluded.ties,points_for=excluded.points_for,points_against=excluded.points_against,active=true returning id into team;
    for manager in select value from jsonb_array_elements(item->'managers') loop
      insert into public.team_provider_managers(league_id,team_id,manager_external_id) values(target,team,manager->>'externalId');
      update public.provider_managers set team_id=team where league_id=target and external_id=manager->>'externalId';
    end loop;
  end loop;
  if wk is not null then
    delete from public.matchups where league_id=target and week=wk;
    for match in select value from jsonb_array_elements(snapshot->'matchups') loop
      if (match->>'week')::integer <> wk then raise exception 'Wrong matchup week'; end if;
      for entry in select value from jsonb_array_elements(match->'scores') loop
        select id into team from public.teams where league_id=target and external_id=entry->>'teamId' and active;
        select value into opponent from jsonb_array_elements(match->'scores') where value->>'teamId' <> entry->>'teamId' limit 1;
        select id into other_team from public.teams where league_id=target and external_id=opponent->>'teamId' and active;
        insert into public.matchups(league_id,week,team_id,opponent_id,provider_matchup_id,team_score,opponent_score,status)
        values(target,wk,team,other_team,match->>'id',(entry->>'points')::numeric,(opponent->>'points')::numeric,match->>'status');
      end loop;
    end loop;
  end if;
  update public.leagues set name=snapshot->'league'->>'name',season=(snapshot->'league'->>'season')::integer,
    status=coalesce(snapshot->'league'->>'status',status),total_teams=jsonb_array_length(snapshot->'teams'),
    current_week=wk,sync_status='complete',last_synced_at=now() where id=target;
  update public.sync_runs set status='complete',finished_at=now() where id=run;
end;
$$;
create function private.fail_sleeper_sync(actor uuid,run uuid,reason text) returns void
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  select league_id into target from public.sync_runs where id=run and actor_id=actor;
  perform 1 from public.leagues where id=target and commissioner_id=actor for update;
  if not found then raise exception 'Commissioner required' using errcode='42501'; end if;
  update public.sync_runs set status='failed',finished_at=now(),error_code=reason where id=run and status='syncing';
  if found then update public.leagues set sync_status='failed' where id=target; end if;
end;
$$;
create function public.begin_sleeper_sync(actor uuid,external_league text,league_name text,league_season integer) returns jsonb language sql security invoker set search_path='' as $$ select private.begin_sleeper_sync(actor,external_league,league_name,league_season); $$;
create function public.finish_sleeper_sync(actor uuid,run uuid,snapshot jsonb) returns void language sql security invoker set search_path='' as $$ select private.finish_sleeper_sync(actor,run,snapshot); $$;
create function public.fail_sleeper_sync(actor uuid,run uuid,reason text) returns void language sql security invoker set search_path='' as $$ select private.fail_sleeper_sync(actor,run,reason); $$;
revoke all on function private.begin_sleeper_sync(uuid,text,text,integer),private.finish_sleeper_sync(uuid,uuid,jsonb),private.fail_sleeper_sync(uuid,uuid,text),public.begin_sleeper_sync(uuid,text,text,integer),public.finish_sleeper_sync(uuid,uuid,jsonb),public.fail_sleeper_sync(uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.begin_sleeper_sync(uuid,text,text,integer),private.finish_sleeper_sync(uuid,uuid,jsonb),private.fail_sleeper_sync(uuid,uuid,text),public.begin_sleeper_sync(uuid,text,text,integer),public.finish_sleeper_sync(uuid,uuid,jsonb),public.fail_sleeper_sync(uuid,uuid,text) to service_role;
