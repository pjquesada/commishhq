-- Phase 3: secure trade voting. Eligibility and anonymous choices are separate.
-- Anonymous ballots intentionally have no team_id. Live tallies are not stored on open votes.

create table public.league_preferences (
  league_id uuid primary key references public.leagues(id) on delete cascade,
  participants_may_vote boolean not null default false,
  default_vote_hours smallint not null default 48 check (default_vote_hours between 1 and 168)
);

create table public.trade_votes (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  commissioner_id uuid not null references public.profiles(id),
  status text not null check (status in ('draft','open','closed','cancelled')),
  privacy_mode text not null check (privacy_mode in ('anonymous','commissioner_may_reveal_after_close')),
  participants_may_vote boolean not null,
  required_veto_votes smallint not null check (required_veto_votes between 1 and 100),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  opened_at timestamptz,
  closed_at timestamptz,
  outcome text not null default 'pending' check (outcome in ('pending','approved','vetoed','cancelled')),
  approve_count integer,
  veto_count integer,
  identities_published boolean not null default false,
  created_at timestamptz not null default now(),
  check (closes_at > opens_at),
  check (
    (status in ('draft','open') and outcome = 'pending' and approve_count is null and veto_count is null and identities_published = false)
    or (status = 'closed' and outcome in ('approved','vetoed') and approve_count is not null and veto_count is not null and closed_at is not null)
    or (status = 'cancelled' and outcome = 'cancelled' and approve_count is null and veto_count is null)
  ),
  check (identities_published = false or (status = 'closed' and privacy_mode = 'commissioner_may_reveal_after_close'))
);
create index trade_votes_league_idx on public.trade_votes(league_id, status, closes_at);

create table public.trade_sides (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null references public.trade_votes(id) on delete cascade,
  league_id uuid not null,
  team_id uuid not null,
  side_index smallint not null check (side_index between 0 and 7),
  unique (vote_id, team_id),
  unique (vote_id, side_index),
  foreign key (league_id, team_id) references public.teams(league_id, id)
);
create index trade_sides_league_idx on public.trade_sides(league_id);

create table public.trade_assets (
  id uuid primary key default gen_random_uuid(),
  side_id uuid not null references public.trade_sides(id) on delete cascade,
  vote_id uuid not null references public.trade_votes(id) on delete cascade,
  asset_type text not null check (asset_type in ('player','draft_pick','faab','custom')),
  label text not null check (length(label) between 1 and 120),
  sort_order smallint not null check (sort_order between 0 and 20),
  unique (side_id, sort_order)
);
create index trade_assets_vote_idx on public.trade_assets(vote_id);

create table public.trade_vote_eligibility (
  vote_id uuid not null references public.trade_votes(id) on delete cascade,
  league_id uuid not null,
  team_id uuid not null,
  has_voted boolean not null default false,
  voted_at timestamptz,
  primary key (vote_id, team_id),
  foreign key (league_id, team_id) references public.teams(league_id, id),
  check ((has_voted and voted_at is not null) or (not has_voted and voted_at is null))
);

-- No team_id column: an anonymous choice cannot be joined back to a team.
create table public.anonymous_trade_ballots (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null references public.trade_votes(id) on delete cascade,
  choice text not null check (choice in ('approve','veto')),
  receipt_hash text not null check (length(receipt_hash) = 32),
  created_at timestamptz not null default now()
);
create index anonymous_ballots_vote_idx on public.anonymous_trade_ballots(vote_id);

create table public.revealable_trade_ballots (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null references public.trade_votes(id) on delete cascade,
  team_id uuid not null,
  league_id uuid not null,
  choice text not null check (choice in ('approve','veto')),
  receipt_hash text not null check (length(receipt_hash) = 32),
  created_at timestamptz not null default now(),
  unique (vote_id, team_id),
  foreign key (league_id, team_id) references public.teams(league_id, id)
);
create index revealable_ballots_vote_idx on public.revealable_trade_ballots(vote_id);

create table public.trade_vote_events (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null references public.trade_votes(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  event text not null check (event in (
    'vote_created','vote_opened','ballot_cast','vote_closed','vote_cancelled','results_published','identities_published'
  )),
  created_at timestamptz not null default now()
);
create index trade_vote_events_vote_idx on public.trade_vote_events(vote_id, created_at);

create table private.rate_buckets (
  bucket text primary key,
  window_start timestamptz not null,
  hits integer not null check (hits >= 0)
);
revoke all on private.rate_buckets from public, anon, authenticated, service_role;

create function private.consume_rate(bucket text, max_hits integer, window_seconds integer) returns void
language plpgsql security definer set search_path='' as $$
declare current_hits integer; started timestamptz;
begin
  select hits, window_start into current_hits, started from private.rate_buckets where private.rate_buckets.bucket = consume_rate.bucket for update;
  if not found then
    begin
      insert into private.rate_buckets(bucket, window_start, hits) values (consume_rate.bucket, clock_timestamp(), 1);
      return;
    exception when unique_violation then
      select hits, window_start into current_hits, started from private.rate_buckets where private.rate_buckets.bucket = consume_rate.bucket for update;
    end;
  end if;
  if started <= clock_timestamp() - make_interval(secs => window_seconds) then
    update private.rate_buckets set window_start = clock_timestamp(), hits = 1 where private.rate_buckets.bucket = consume_rate.bucket;
    return;
  end if;
  if current_hits >= max_hits then raise exception 'Too many attempts'; end if;
  update private.rate_buckets set hits = hits + 1 where private.rate_buckets.bucket = consume_rate.bucket;
end;
$$;

create function private.freeze_trade_vote() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Vote history cannot be changed'; end if;
  if old.status <> 'draft' and (
    new.privacy_mode is distinct from old.privacy_mode
    or new.required_veto_votes is distinct from old.required_veto_votes
    or new.participants_may_vote is distinct from old.participants_may_vote
    or new.closes_at is distinct from old.closes_at
    or new.opens_at is distinct from old.opens_at
    or new.league_id is distinct from old.league_id
    or new.commissioner_id is distinct from old.commissioner_id
  ) then
    raise exception 'Vote rules are frozen';
  end if;
  if old.privacy_mode = 'anonymous' and new.privacy_mode <> 'anonymous' and old.status <> 'draft' then
    raise exception 'Privacy cannot change';
  end if;
  return new;
end;
$$;
create trigger freeze_trade_vote before update or delete on public.trade_votes
for each row execute function private.freeze_trade_vote();

create function private.guard_eligibility() returns trigger
language plpgsql set search_path='' as $$
declare st text;
begin
  if tg_op = 'DELETE' then raise exception 'Eligibility cannot be removed'; end if;
  select status into st from public.trade_votes where id = new.vote_id;
  if tg_op = 'INSERT' and st <> 'draft' then raise exception 'Eligibility is frozen'; end if;
  if tg_op = 'UPDATE' and (old.has_voted and (not new.has_voted or new.team_id is distinct from old.team_id or new.vote_id is distinct from old.vote_id)) then
    raise exception 'Ballot cannot be edited';
  end if;
  return new;
end;
$$;
create trigger guard_eligibility before insert or update or delete on public.trade_vote_eligibility
for each row execute function private.guard_eligibility();

create function private.reject_ballot_mutation() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op <> 'INSERT' then raise exception 'Ballots cannot be edited'; end if;
  return coalesce(new, old);
end;
$$;
create trigger anonymous_ballots_immutable before update or delete on public.anonymous_trade_ballots
for each row execute function private.reject_ballot_mutation();
create trigger revealable_ballots_immutable before update or delete on public.revealable_trade_ballots
for each row execute function private.reject_ballot_mutation();

create function private.reject_audit_mutation() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception 'Audit history cannot be changed';
end;
$$;
create trigger trade_events_immutable before update or delete on public.trade_vote_events
for each row execute function private.reject_audit_mutation();

create function private.finalize_trade_vote_internal(target_vote uuid) returns void
language plpgsql security definer set search_path='' as $$
declare
  v public.trade_votes;
  approves integer;
  vetoes integer;
  result text;
begin
  select * into v from public.trade_votes where id = target_vote for update;
  if not found or v.status <> 'open' or v.closes_at > clock_timestamp() then return; end if;
  if v.privacy_mode = 'anonymous' then
    select count(*) filter (where choice = 'approve'), count(*) filter (where choice = 'veto')
      into approves, vetoes from public.anonymous_trade_ballots where vote_id = target_vote;
  else
    select count(*) filter (where choice = 'approve'), count(*) filter (where choice = 'veto')
      into approves, vetoes from public.revealable_trade_ballots where vote_id = target_vote;
  end if;
  result := case when vetoes >= v.required_veto_votes then 'vetoed' else 'approved' end;
  update public.trade_votes
    set status = 'closed', outcome = result, approve_count = approves, veto_count = vetoes, closed_at = clock_timestamp()
    where id = target_vote;
  insert into public.trade_vote_events(vote_id, league_id, event) values
    (target_vote, v.league_id, 'vote_closed'),
    (target_vote, v.league_id, 'results_published');
end;
$$;

create function private.publish_trade_vote(payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  target uuid;
  vote_id uuid;
  side jsonb;
  asset jsonb;
  eligible uuid;
  eligible_count integer := 0;
  veto integer;
  closes timestamptz;
  privacy text;
  participants boolean;
  side_id uuid;
  side_index integer := 0;
  asset_index integer;
  trading uuid[] := '{}';
  seen_eligible uuid[] := '{}';
begin
  if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  target := (payload->>'league_id')::uuid;
  perform 1 from public.leagues where id = target and commissioner_id = uid for update;
  if not found then raise exception 'Commissioner required' using errcode = '42501'; end if;
  privacy := payload->>'privacy_mode';
  if privacy not in ('anonymous','commissioner_may_reveal_after_close') then raise exception 'Invalid trade'; end if;
  participants := coalesce((payload->>'participants_may_vote')::boolean, false);
  closes := (payload->>'closes_at')::timestamptz;
  if closes is null or closes <= clock_timestamp() or closes > clock_timestamp() + interval '14 days' then
    raise exception 'Invalid trade';
  end if;
  if jsonb_typeof(payload->'sides') <> 'array' or jsonb_array_length(payload->'sides') < 2 or jsonb_array_length(payload->'sides') > 8 then
    raise exception 'Invalid trade';
  end if;
  if jsonb_typeof(payload->'eligible_team_ids') <> 'array' then raise exception 'Invalid trade'; end if;
  insert into public.trade_votes(
    league_id, commissioner_id, status, privacy_mode, participants_may_vote, required_veto_votes, opens_at, closes_at
  ) values (
    target, uid, 'draft', privacy, participants, 1, clock_timestamp(), closes
  ) returning id into vote_id;
  for side in select value from jsonb_array_elements(payload->'sides') loop
    if not exists (
      select 1 from public.teams where id = (side->>'team_id')::uuid and league_id = target and active
    ) or (side->>'team_id')::uuid = any(trading) then
      raise exception 'Invalid trade';
    end if;
    if jsonb_typeof(side->'assets') <> 'array' or jsonb_array_length(side->'assets') < 1 or jsonb_array_length(side->'assets') > 12 then
      raise exception 'Invalid trade';
    end if;
    trading := trading || (side->>'team_id')::uuid;
    insert into public.trade_sides(vote_id, league_id, team_id, side_index)
    values (vote_id, target, (side->>'team_id')::uuid, side_index) returning id into side_id;
    asset_index := 0;
    for asset in select value from jsonb_array_elements(side->'assets') loop
      if coalesce(asset->>'type','') not in ('player','draft_pick','faab','custom')
        or length(btrim(coalesce(asset->>'label',''))) not between 1 and 120 then
        raise exception 'Invalid trade';
      end if;
      insert into public.trade_assets(side_id, vote_id, asset_type, label, sort_order)
      values (side_id, vote_id, asset->>'type', btrim(asset->>'label'), asset_index);
      asset_index := asset_index + 1;
    end loop;
    side_index := side_index + 1;
  end loop;
  for eligible in select (value #>> '{}')::uuid from jsonb_array_elements(payload->'eligible_team_ids') loop
    if eligible = any(seen_eligible) then raise exception 'Invalid trade'; end if;
    if not exists (select 1 from public.teams where id = eligible and league_id = target and active) then
      raise exception 'Invalid trade';
    end if;
    if not participants and eligible = any(trading) then raise exception 'Invalid trade'; end if;
    seen_eligible := seen_eligible || eligible;
    insert into public.trade_vote_eligibility(vote_id, league_id, team_id) values (vote_id, target, eligible);
    eligible_count := eligible_count + 1;
  end loop;
  if eligible_count < 1 then raise exception 'Invalid trade'; end if;
  if payload->>'required_veto_votes' is null or payload->>'required_veto_votes' = '' then
    veto := ceil(eligible_count::numeric / 2)::integer;
  else
    veto := (payload->>'required_veto_votes')::integer;
  end if;
  if veto < 1 or veto > eligible_count then raise exception 'Invalid trade'; end if;
  update public.trade_votes
    set required_veto_votes = veto, status = 'open', opened_at = clock_timestamp()
    where id = vote_id;
  insert into public.trade_vote_events(vote_id, league_id, event) values
    (vote_id, target, 'vote_created'),
    (vote_id, target, 'vote_opened');
  return vote_id;
end;
$$;

create function private.cast_trade_ballot(target_vote uuid, ballot_choice text) returns text
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  v public.trade_votes;
  member_team uuid;
  receipt text;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if ballot_choice not in ('approve','veto') then raise exception 'Invalid trade'; end if;
  perform private.consume_rate('ballot:' || uid::text, 8, 60);
  select * into v from public.trade_votes where id = target_vote for update;
  if not found then raise exception 'Vote not found'; end if;
  if not private.can_read_league(v.league_id) then raise exception 'Vote not found'; end if;
  if v.status = 'cancelled' or v.status = 'closed' or v.closes_at <= clock_timestamp() or v.status <> 'open' then
    raise exception 'Voting is closed';
  end if;
  select team_id into member_team from public.league_members
    where league_id = v.league_id and user_id = uid and team_id is not null;
  if member_team is null then raise exception 'Not eligible'; end if;
  update public.trade_vote_eligibility
    set has_voted = true, voted_at = clock_timestamp()
    where vote_id = target_vote and team_id = member_team and has_voted = false;
  if not found then
    if exists (
      select 1 from public.trade_vote_eligibility
      where vote_id = target_vote and team_id = member_team and has_voted
    ) then raise exception 'Already voted'; end if;
    raise exception 'Not eligible';
  end if;
  receipt := upper(substr(md5(gen_random_uuid()::text), 1, 4) || '-' || substr(md5(gen_random_uuid()::text), 1, 4));
  if v.privacy_mode = 'anonymous' then
    insert into public.anonymous_trade_ballots(vote_id, choice, receipt_hash)
    values (target_vote, ballot_choice, md5(receipt || target_vote::text));
  else
    insert into public.revealable_trade_ballots(vote_id, league_id, team_id, choice, receipt_hash)
    values (target_vote, v.league_id, member_team, ballot_choice, md5(receipt || target_vote::text));
  end if;
  insert into public.trade_vote_events(vote_id, league_id, event) values (target_vote, v.league_id, 'ballot_cast');
  return receipt;
end;
$$;

create function private.trade_vote_progress(target_vote uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v public.trade_votes;
  member_team uuid;
  cast_count integer;
  eligible_count integer;
  voted boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v from public.trade_votes where id = target_vote;
  if not found or not private.can_read_league(v.league_id) then raise exception 'Vote not found'; end if;
  perform private.finalize_trade_vote_internal(target_vote);
  select * into v from public.trade_votes where id = target_vote;
  select count(*) filter (where has_voted), count(*) into cast_count, eligible_count
    from public.trade_vote_eligibility where vote_id = target_vote;
  select team_id into member_team from public.league_members
    where league_id = v.league_id and user_id = auth.uid() and team_id is not null;
  select has_voted into voted from public.trade_vote_eligibility
    where vote_id = target_vote and team_id = member_team;
  return jsonb_build_object(
    'votes_cast', cast_count,
    'eligible_count', eligible_count,
    'status', v.status,
    'outcome', case when v.status in ('closed','cancelled') then v.outcome else null end,
    'viewer_eligible', voted is not null,
    'viewer_has_voted', coalesce(voted, false)
  );
end;
$$;

create function private.trade_vote_results(target_vote uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v public.trade_votes;
  identities jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v from public.trade_votes where id = target_vote;
  if not found or not private.can_read_league(v.league_id) then raise exception 'Vote not found'; end if;
  perform private.finalize_trade_vote_internal(target_vote);
  select * into v from public.trade_votes where id = target_vote;
  if v.status = 'open' or v.status = 'draft' then raise exception 'Results are hidden'; end if;
  if v.status <> 'closed' then
    return jsonb_build_object('status', v.status, 'outcome', v.outcome, 'approve_count', null, 'veto_count', null, 'identities', null);
  end if;
  identities := null;
  if v.privacy_mode = 'commissioner_may_reveal_after_close' and v.identities_published then
    select coalesce(jsonb_agg(jsonb_build_object('team_id', team_id, 'choice', choice) order by team_id), '[]'::jsonb)
      into identities from public.revealable_trade_ballots where vote_id = target_vote;
  end if;
  return jsonb_build_object(
    'status', v.status,
    'outcome', v.outcome,
    'approve_count', v.approve_count,
    'veto_count', v.veto_count,
    'required_veto_votes', v.required_veto_votes,
    'identities', identities
  );
end;
$$;

create function private.cancel_trade_vote(target_vote uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v public.trade_votes;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v from public.trade_votes where id = target_vote for update;
  if not found then raise exception 'Vote not found'; end if;
  if not private.is_commissioner(v.league_id) then raise exception 'Commissioner required' using errcode = '42501'; end if;
  if v.status not in ('draft','open') then raise exception 'Voting is closed'; end if;
  update public.trade_votes set status = 'cancelled', outcome = 'cancelled', closed_at = clock_timestamp() where id = target_vote;
  insert into public.trade_vote_events(vote_id, league_id, event) values (target_vote, v.league_id, 'vote_cancelled');
end;
$$;

create function private.publish_vote_identities(target_vote uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v public.trade_votes;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v from public.trade_votes where id = target_vote for update;
  if not found then raise exception 'Vote not found'; end if;
  perform private.finalize_trade_vote_internal(target_vote);
  select * into v from public.trade_votes where id = target_vote for update;
  if not private.is_commissioner(v.league_id) then raise exception 'Commissioner required' using errcode = '42501'; end if;
  if v.privacy_mode <> 'commissioner_may_reveal_after_close' or v.status <> 'closed' then
    raise exception 'Identities cannot be published';
  end if;
  if v.identities_published then return; end if;
  update public.trade_votes set identities_published = true where id = target_vote;
  insert into public.trade_vote_events(vote_id, league_id, event) values (target_vote, v.league_id, 'identities_published');
end;
$$;

create function private.finalize_visible_due_votes() returns void
language plpgsql security definer set search_path='' as $$
declare vote_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  for vote_id in
    select v.id from public.trade_votes v
    where v.status = 'open' and v.closes_at <= clock_timestamp() and private.can_read_league(v.league_id)
  loop
    perform private.finalize_trade_vote_internal(vote_id);
  end loop;
end;
$$;

create function private.finalize_due_votes(batch integer) returns integer
language plpgsql security definer set search_path='' as $$
declare vote_id uuid; n integer := 0;
begin
  if batch < 1 or batch > 20 then raise exception 'Invalid trade'; end if;
  for vote_id in
    select v.id from public.trade_votes v
    where v.status = 'open' and v.closes_at <= clock_timestamp()
    order by v.closes_at
    limit batch
    for update skip locked
  loop
    perform private.finalize_trade_vote_internal(vote_id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

create function private.update_league_preferences(target uuid, prefs jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare hours integer; participants boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform 1 from public.leagues where id = target and commissioner_id = auth.uid() for update;
  if not found then raise exception 'Commissioner required' using errcode = '42501'; end if;
  participants := coalesce((prefs->>'participants_may_vote')::boolean, false);
  hours := coalesce((prefs->>'default_vote_hours')::integer, 48);
  if hours < 1 or hours > 168 then raise exception 'Invalid trade'; end if;
  insert into public.league_preferences(league_id, participants_may_vote, default_vote_hours)
  values (target, participants, hours)
  on conflict (league_id) do update
    set participants_may_vote = excluded.participants_may_vote,
        default_vote_hours = excluded.default_vote_hours;
end;
$$;

create function public.publish_trade_vote(payload jsonb) returns uuid language sql security invoker set search_path='' as $$ select private.publish_trade_vote(payload); $$;
create function public.cast_trade_ballot(target_vote uuid, ballot_choice text) returns text language sql security invoker set search_path='' as $$ select private.cast_trade_ballot(target_vote, ballot_choice); $$;
create function public.trade_vote_progress(target_vote uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.trade_vote_progress(target_vote); $$;
create function public.trade_vote_results(target_vote uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.trade_vote_results(target_vote); $$;
create function public.cancel_trade_vote(target_vote uuid) returns void language sql security invoker set search_path='' as $$ select private.cancel_trade_vote(target_vote); $$;
create function public.publish_vote_identities(target_vote uuid) returns void language sql security invoker set search_path='' as $$ select private.publish_vote_identities(target_vote); $$;
create function public.finalize_visible_due_votes() returns void language sql security invoker set search_path='' as $$ select private.finalize_visible_due_votes(); $$;
create function public.finalize_due_votes(batch integer) returns integer language sql security invoker set search_path='' as $$ select private.finalize_due_votes(batch); $$;
create function public.update_league_preferences(target uuid, prefs jsonb) returns void language sql security invoker set search_path='' as $$ select private.update_league_preferences(target, prefs); $$;

revoke all on function
  private.consume_rate(text, integer, integer),
  private.freeze_trade_vote(),
  private.guard_eligibility(),
  private.reject_ballot_mutation(),
  private.reject_audit_mutation(),
  private.finalize_trade_vote_internal(uuid),
  private.publish_trade_vote(jsonb),
  private.cast_trade_ballot(uuid, text),
  private.trade_vote_progress(uuid),
  private.trade_vote_results(uuid),
  private.cancel_trade_vote(uuid),
  private.publish_vote_identities(uuid),
  private.finalize_visible_due_votes(),
  private.finalize_due_votes(integer),
  private.update_league_preferences(uuid, jsonb),
  public.publish_trade_vote(jsonb),
  public.cast_trade_ballot(uuid, text),
  public.trade_vote_progress(uuid),
  public.trade_vote_results(uuid),
  public.cancel_trade_vote(uuid),
  public.publish_vote_identities(uuid),
  public.finalize_visible_due_votes(),
  public.finalize_due_votes(integer),
  public.update_league_preferences(uuid, jsonb)
from public, anon, authenticated, service_role;

grant execute on function
  private.publish_trade_vote(jsonb),
  private.cast_trade_ballot(uuid, text),
  private.trade_vote_progress(uuid),
  private.trade_vote_results(uuid),
  private.cancel_trade_vote(uuid),
  private.publish_vote_identities(uuid),
  private.finalize_visible_due_votes(),
  private.update_league_preferences(uuid, jsonb),
  public.publish_trade_vote(jsonb),
  public.cast_trade_ballot(uuid, text),
  public.trade_vote_progress(uuid),
  public.trade_vote_results(uuid),
  public.cancel_trade_vote(uuid),
  public.publish_vote_identities(uuid),
  public.finalize_visible_due_votes(),
  public.update_league_preferences(uuid, jsonb)
to authenticated;

grant execute on function private.finalize_due_votes(integer), public.finalize_due_votes(integer) to service_role;

alter table public.league_preferences enable row level security;
alter table public.trade_votes enable row level security;
alter table public.trade_sides enable row level security;
alter table public.trade_assets enable row level security;
alter table public.trade_vote_eligibility enable row level security;
alter table public.anonymous_trade_ballots enable row level security;
alter table public.revealable_trade_ballots enable row level security;
alter table public.trade_vote_events enable row level security;

revoke all on
  public.league_preferences,
  public.trade_votes,
  public.trade_sides,
  public.trade_assets,
  public.trade_vote_eligibility,
  public.anonymous_trade_ballots,
  public.revealable_trade_ballots,
  public.trade_vote_events
from public, anon, authenticated, service_role;

grant select on
  public.league_preferences,
  public.trade_votes,
  public.trade_sides,
  public.trade_assets,
  public.trade_vote_events
to authenticated;

-- Eligibility and both ballot tables have no client privileges. Progress and results RPCs are the only reads.
create policy preferences_read on public.league_preferences for select to authenticated using (private.can_read_league(league_id));
create policy trade_votes_read on public.trade_votes for select to authenticated using (private.can_read_league(league_id));
create policy trade_sides_read on public.trade_sides for select to authenticated using (private.can_read_league(league_id));
create policy trade_assets_read on public.trade_assets for select to authenticated using (
  exists (
    select 1 from public.trade_votes v
    where v.id = vote_id and private.can_read_league(v.league_id)
  )
);
create policy trade_events_read on public.trade_vote_events for select to authenticated using (private.can_read_league(league_id));
