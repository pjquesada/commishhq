-- Phase 2: Sleeper league sync, standings/matchups and commissioner-approved team claiming.

alter table public.leagues
  add column sport text not null default 'nfl' check (sport = 'nfl'),
  add column status text not null default 'pre_draft'
    check (status in ('pre_draft', 'drafting', 'in_season', 'complete')),
  add column total_teams smallint not null default 0 check (total_teams between 0 and 40),
  add column current_week smallint check (current_week between 0 and 22),
  add column sync_status text not null default 'pending'
    check (sync_status in ('pending', 'syncing', 'complete', 'failed')),
  add column last_synced_at timestamptz;

alter table public.teams
  add column owner_external_id text,
  add column avatar text,
  add column wins smallint not null default 0 check (wins >= 0),
  add column losses smallint not null default 0 check (losses >= 0),
  add column ties smallint not null default 0 check (ties >= 0),
  add column points_for numeric(10,2) not null default 0 check (points_for >= 0),
  add column points_against numeric(10,2) not null default 0 check (points_against >= 0);

create table public.provider_league_members (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  provider_user_id text not null check (length(provider_user_id) between 1 and 200),
  username text,
  display_name text not null check (length(display_name) between 1 and 120),
  avatar text,
  is_provider_commissioner boolean not null default false,
  team_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, provider_user_id),
  foreign key (league_id, team_id) references public.teams(league_id, id)
);

create table public.matchups (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  week smallint not null check (week between 1 and 22),
  provider_matchup_id text not null,
  team_id uuid not null,
  opponent_team_id uuid,
  points numeric(10,2),
  opponent_points numeric(10,2),
  status text not null check (status in ('scheduled', 'live', 'final')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, week, team_id),
  foreign key (league_id, team_id) references public.teams(league_id, id),
  foreign key (league_id, opponent_team_id) references public.teams(league_id, id)
);

create table public.team_claims (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  team_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  foreign key (league_id, team_id) references public.teams(league_id, id)
);

create unique index team_claims_one_active_user
  on public.team_claims(league_id, user_id)
  where status in ('pending', 'approved');

create unique index team_claims_one_approved_team
  on public.team_claims(league_id, team_id)
  where status = 'approved';

create index team_claims_league_status_idx
  on public.team_claims(league_id, status);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  provider text not null check (provider in ('sleeper', 'yahoo', 'espn')),
  external_id text not null,
  status text not null check (status in ('running', 'complete', 'failed')),
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index matchups_league_week_idx on public.matchups(league_id, week);
create index provider_members_league_idx on public.provider_league_members(league_id);
create index sync_runs_league_idx on public.sync_runs(league_id, started_at desc);

create trigger provider_league_members_updated
before update on public.provider_league_members
for each row execute function private.touch_updated_at();

create trigger matchups_updated
before update on public.matchups
for each row execute function private.touch_updated_at();

create function private.is_league_commissioner(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and exists (
      select 1 from public.leagues
      where id = target and commissioner_id = auth.uid()
    );
$$;
revoke all on function private.is_league_commissioner(uuid) from public, anon;
grant execute on function private.is_league_commissioner(uuid) to authenticated;

alter table public.provider_league_members enable row level security;
alter table public.matchups enable row level security;
alter table public.team_claims enable row level security;
alter table public.sync_runs enable row level security;

revoke all on public.provider_league_members, public.matchups, public.team_claims, public.sync_runs
from anon, authenticated;

grant select on public.provider_league_members, public.matchups, public.team_claims
to authenticated;

create policy provider_member_read on public.provider_league_members
for select to authenticated using (private.can_read_league(league_id));

create policy matchup_read on public.matchups
for select to authenticated using (private.can_read_league(league_id));

create policy claim_read on public.team_claims
for select to authenticated using (
  user_id = (select auth.uid())
  or private.is_league_commissioner(league_id)
);

-- Only the server-side secret-key client may execute this atomic review operation.
create function public.review_team_claim(
  target_claim uuid,
  reviewer uuid,
  decision text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim_row public.team_claims%rowtype;
  league_commissioner uuid;
begin
  if decision not in ('approved', 'rejected') then
    raise exception 'invalid review decision' using errcode = '22023';
  end if;

  select * into claim_row
  from public.team_claims
  where id = target_claim
  for update;

  if not found then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;

  select commissioner_id into league_commissioner
  from public.leagues
  where id = claim_row.league_id;

  if reviewer is null or league_commissioner is distinct from reviewer then
    raise exception 'not authorized to review claim' using errcode = '42501';
  end if;

  if claim_row.status <> 'pending' then
    raise exception 'claim is no longer pending' using errcode = '23514';
  end if;

  if decision = 'approved' then
    if exists (
      select 1 from public.league_members
      where league_id = claim_row.league_id
        and user_id = claim_row.user_id
        and team_id is not null
    ) then
      raise exception 'manager already has an approved team' using errcode = '23505';
    end if;

    if exists (
      select 1 from public.league_members
      where league_id = claim_row.league_id
        and team_id = claim_row.team_id
        and user_id <> claim_row.user_id
    ) then
      raise exception 'team already has an approved manager' using errcode = '23505';
    end if;

    insert into public.league_members(league_id, user_id, team_id)
    values (claim_row.league_id, claim_row.user_id, claim_row.team_id)
    on conflict (league_id, user_id)
    do update set team_id = excluded.team_id;

    update public.team_claims
    set status = 'approved', reviewed_at = now(), reviewed_by = reviewer
    where id = claim_row.id;

    update public.team_claims
    set status = 'rejected', reviewed_at = now(), reviewed_by = reviewer
    where league_id = claim_row.league_id
      and team_id = claim_row.team_id
      and id <> claim_row.id
      and status = 'pending';
  else
    update public.team_claims
    set status = 'rejected', reviewed_at = now(), reviewed_by = reviewer
    where id = claim_row.id;
  end if;
end;
$$;

revoke all on function public.review_team_claim(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.review_team_claim(uuid, uuid, text)
to service_role;
