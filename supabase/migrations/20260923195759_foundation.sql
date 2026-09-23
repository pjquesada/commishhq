-- Phase 1: deny-by-default identity and league foundation. No importing or claiming API yet.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  season smallint not null check (season between 2000 and 2200),
  commissioner_id uuid not null references public.profiles(id),
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.league_connections (
  league_id uuid primary key references public.leagues(id) on delete cascade,
  provider text not null check (provider in ('sleeper', 'yahoo', 'espn')),
  external_id text not null check (length(external_id) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (provider, external_id)
);
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  external_id text not null,
  name text not null check (length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, external_id),
  unique (league_id, id)
);
create table public.league_members (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  team_id uuid,
  created_at timestamptz not null default now(),
  primary key (league_id, user_id),
  unique (league_id, team_id),
  foreign key (league_id, team_id) references public.teams(league_id, id)
);
create index league_members_user_idx on public.league_members(user_id);
create index leagues_commissioner_idx on public.leagues(commissioner_id);

-- Controlled internal RLS lookup, necessary to avoid recursive membership policies.
-- Never exposed through the public PostgREST schema; no caller-supplied user identity.
create function private.can_read_league(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    exists (select 1 from public.league_members where league_id = target and user_id = auth.uid())
    or exists (select 1 from public.leagues where id = target and commissioner_id = auth.uid())
  );
$$;
revoke all on function private.can_read_league(uuid) from public, anon;
grant execute on function private.can_read_league(uuid) to authenticated;

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
revoke all on function private.touch_updated_at() from public, anon, authenticated;
create trigger profiles_updated before update on public.profiles for each row execute function private.touch_updated_at();
create trigger leagues_updated before update on public.leagues for each row execute function private.touch_updated_at();
create trigger teams_updated before update on public.teams for each row execute function private.touch_updated_at();

-- Auth trigger is the only automatic profile writer; ignores editable user metadata.
create function private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin insert into public.profiles(id) values (new.id); return new; end;
$$;
revoke all on function private.create_profile() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.create_profile();

alter table public.profiles enable row level security;
alter table public.leagues enable row level security;
alter table public.league_connections enable row level security;
alter table public.teams enable row level security;
alter table public.league_members enable row level security;
revoke all on public.profiles, public.leagues, public.league_connections, public.teams, public.league_members from anon, authenticated;
grant select on public.profiles, public.leagues, public.league_connections, public.teams, public.league_members to authenticated;
grant update(display_name) on public.profiles to authenticated;
create policy own_profile_read on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy own_profile_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy league_read on public.leagues for select to authenticated using (private.can_read_league(id));
create policy connection_read on public.league_connections for select to authenticated using (private.can_read_league(league_id));
create policy team_read on public.teams for select to authenticated using (private.can_read_league(league_id));
create policy membership_read on public.league_members for select to authenticated using (private.can_read_league(league_id));
-- No browser INSERT/UPDATE/DELETE grants for league ownership or team membership.
-- Phase 2 will introduce carefully authorized import and claim operations.
