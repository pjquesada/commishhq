-- Phase 2. Phase 1 remains immutable. All authoritative writes use narrowly granted functions.
alter table public.leagues
  add column current_week smallint check (current_week between 1 and 22),
  add column sync_status text not null default 'pending' check (sync_status in ('pending','syncing','complete','failed')),
  add column last_synced_at timestamptz;
alter table public.teams
  add column wins integer not null default 0 check (wins >= 0),
  add column losses integer not null default 0 check (losses >= 0),
  add column ties integer not null default 0 check (ties >= 0),
  add column points_for numeric(14,2) not null default 0,
  add column points_against numeric(14,2) not null default 0,
  add column active boolean not null default true;

create table public.provider_managers (
  league_id uuid not null references public.leagues(id) on delete cascade,
  external_id text not null check (length(external_id) between 1 and 200),
  display_name text not null check (length(display_name) between 1 and 200),
  primary key (league_id, external_id),
  updated_at timestamptz not null default now()
);
create table public.team_provider_managers (
  league_id uuid not null,
  team_id uuid not null,
  manager_external_id text not null,
  primary key (league_id, team_id, manager_external_id),
  foreign key (league_id, team_id) references public.teams(league_id,id) on delete cascade,
  foreign key (league_id, manager_external_id) references public.provider_managers(league_id,external_id) on delete cascade
);
create index team_provider_managers_manager_idx on public.team_provider_managers(league_id,manager_external_id);
create table public.matchups (
  league_id uuid not null references public.leagues(id) on delete cascade,
  week smallint not null check (week between 1 and 22),
  team_id uuid not null,
  opponent_id uuid,
  provider_matchup_id text not null,
  team_score numeric(14,2),
  opponent_score numeric(14,2),
  status text not null check (status in ('scheduled','live','final')),
  updated_at timestamptz not null default now(),
  primary key (league_id, week, team_id),
  foreign key (league_id,team_id) references public.teams(league_id,id),
  foreign key (league_id,opponent_id) references public.teams(league_id,id),
  check (opponent_id is null or opponent_id <> team_id)
);
create index matchups_team_idx on public.matchups(league_id,team_id);
create index matchups_opponent_idx on public.matchups(league_id,opponent_id);
create table public.team_claims (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  team_id uuid not null,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  requester_label text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_id uuid references public.profiles(id),
  foreign key (league_id,team_id) references public.teams(league_id,id),
  check ((status = 'pending' and reviewed_at is null and reviewer_id is null) or
         (status in ('approved','rejected') and reviewed_at is not null and reviewer_id is not null) or
         (status = 'cancelled' and reviewed_at is not null))
);
create unique index one_active_claim_per_user on public.team_claims(league_id,requester_id) where status in ('pending','approved');
create unique index one_approved_claim_per_team on public.team_claims(league_id,team_id) where status = 'approved';
create index claims_requester_idx on public.team_claims(requester_id);
create index claims_review_idx on public.team_claims(reviewer_id);
create index claims_team_idx on public.team_claims(league_id,team_id);
create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  status text not null check (status in ('syncing','complete','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_code text check (error_code in ('provider','persistence','expired'))
);
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
  insert into public.sync_runs(league_id,actor_id,status) values(target,actor,'syncing') returning id into run_id;
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
  delete from public.provider_managers where league_id=target;
  for manager in select value from jsonb_array_elements(snapshot->'managers') loop
    insert into public.provider_managers(league_id,external_id,display_name) values(target,manager->>'externalId',manager->>'displayName');
  end loop;
  for item in select value from jsonb_array_elements(snapshot->'teams') loop
    insert into public.teams(league_id,external_id,name,wins,losses,ties,points_for,points_against,active)
    values(target,item->>'externalId',item->>'name',(item->>'wins')::integer,(item->>'losses')::integer,(item->>'ties')::integer,(item->>'pointsFor')::numeric,(item->>'pointsAgainst')::numeric,true)
    on conflict(league_id,external_id) do update set name=excluded.name,wins=excluded.wins,losses=excluded.losses,ties=excluded.ties,points_for=excluded.points_for,points_against=excluded.points_against,active=true returning id into team;
    for manager in select value from jsonb_array_elements(item->'managers') loop
      insert into public.team_provider_managers(league_id,team_id,manager_external_id) values(target,team,manager->>'externalId');
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
  update public.leagues set name=snapshot->'league'->>'name',season=(snapshot->'league'->>'season')::integer,current_week=wk,sync_status='complete',last_synced_at=now() where id=target;
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
