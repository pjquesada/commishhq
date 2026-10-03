-- Phase 6: encrypted Yahoo credentials and OAuth state. Clients cannot read ciphertext.

create table public.provider_credentials (
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('yahoo', 'espn')),
  ciphertext text not null check (length(ciphertext) between 16 and 8000),
  iv text not null check (length(iv) between 8 and 64),
  key_version smallint not null default 1 check (key_version between 1 and 5),
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

create table public.oauth_states (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('yahoo', 'espn')),
  expires_at timestamptz not null
);

alter table public.provider_credentials enable row level security;
alter table public.oauth_states enable row level security;
revoke all on public.provider_credentials, public.oauth_states from public, anon, authenticated, service_role;

create function private.store_oauth_state(actor uuid, provider text, state_hash text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists (select 1 from public.profiles where id = actor) then raise exception 'Invalid actor'; end if;
  if provider <> 'yahoo' or state_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid oauth state'; end if;
  perform private.consume_rate('oauth:' || actor::text, 10, 3600);
  delete from public.oauth_states
  where user_id = actor and public.oauth_states.provider = store_oauth_state.provider;
  insert into public.oauth_states(state_hash, user_id, provider, expires_at)
  values (
    store_oauth_state.state_hash,
    store_oauth_state.actor,
    store_oauth_state.provider,
    clock_timestamp() + interval '10 minutes'
  );
end;
$$;

create function private.consume_oauth_state(actor uuid, provider text, state_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
declare found uuid;
begin
  delete from public.oauth_states
  where public.oauth_states.state_hash = consume_oauth_state.state_hash
    and user_id = actor
    and public.oauth_states.provider = consume_oauth_state.provider
    and expires_at > clock_timestamp()
  returning user_id into found;
  return found is not null;
end;
$$;

create function private.store_provider_credential(
  actor uuid, target_provider text, token_ciphertext text, token_iv text, version integer
) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists (select 1 from public.profiles where id = actor) then raise exception 'Invalid actor'; end if;
  if target_provider not in ('yahoo', 'espn') or length(token_ciphertext) not between 16 and 8000 or length(token_iv) not between 8 and 64 then
    raise exception 'Invalid credential';
  end if;
  insert into public.provider_credentials(user_id, provider, ciphertext, iv, key_version, revoked_at)
  values (actor, target_provider, token_ciphertext, token_iv, version, null)
  on conflict (user_id, provider) do update set
    ciphertext = excluded.ciphertext,
    iv = excluded.iv,
    key_version = excluded.key_version,
    revoked_at = null,
    updated_at = clock_timestamp();
end;
$$;

create function private.read_provider_credential(actor uuid, provider text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare row public.provider_credentials;
begin
  select * into row from public.provider_credentials
  where user_id = actor and public.provider_credentials.provider = read_provider_credential.provider and revoked_at is null;
  if not found then return null; end if;
  return jsonb_build_object('ciphertext', row.ciphertext, 'iv', row.iv, 'key_version', row.key_version);
end;
$$;

create function private.revoke_provider_credential(actor uuid, provider text) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.provider_credentials set revoked_at = clock_timestamp(), ciphertext = repeat('x', 16), iv = repeat('y', 16)
  where user_id = actor and public.provider_credentials.provider = revoke_provider_credential.provider;
end;
$$;

create function private.begin_yahoo_sync(actor uuid, external_league text, league_name text, league_season integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target uuid; owner uuid; run_id uuid;
begin
  if not exists(select 1 from public.profiles where id = actor) then raise exception 'Invalid actor'; end if;
  if external_league !~ '^[0-9]{2,6}\.l\.[0-9]{1,12}$' then raise exception 'Invalid league ID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('yahoo:' || external_league, 0));
  select league_id into target from public.league_connections where provider = 'yahoo' and external_id = external_league;
  if target is null then
    if (select count(*) from public.sync_runs where actor_id = actor and started_at > now() - interval '1 hour') >= 20 then
      raise exception 'Import limit reached';
    end if;
    insert into public.leagues(name, season, commissioner_id) values (league_name, league_season, actor) returning id into target;
    insert into public.league_connections(league_id, provider, external_id) values (target, 'yahoo', external_league);
  end if;
  select commissioner_id into owner from public.leagues where id = target for update;
  if owner <> actor then raise exception 'Commissioner required' using errcode = '42501'; end if;
  if exists(select 1 from public.sync_runs where league_id = target and started_at > now() - interval '30 seconds') then
    raise exception 'Please wait before syncing again';
  end if;
  update public.sync_runs set status = 'failed', finished_at = now(), error_code = 'expired'
  where league_id = target and status = 'syncing' and started_at < now() - interval '2 minutes';
  if exists(select 1 from public.sync_runs where league_id = target and status = 'syncing') then
    raise exception 'Sync already running';
  end if;
  insert into public.sync_runs(league_id, actor_id, provider, external_id, status)
  values (target, actor, 'yahoo', external_league, 'syncing') returning id into run_id;
  update public.leagues set sync_status = 'syncing' where id = target;
  return jsonb_build_object('league_id', target, 'run_id', run_id);
end;
$$;

-- Reuses the Sleeper snapshot writer. The connection is yahoo again before commit.
create function private.finish_yahoo_sync(actor uuid, run uuid, snapshot jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare target uuid; external text;
begin
  select league_id into target from public.sync_runs where id = run and actor_id = actor and provider = 'yahoo';
  if target is null then raise exception 'Sync expired'; end if;
  external := snapshot->'league'->>'externalId';
  update public.league_connections set provider = 'sleeper'
  where league_id = target and provider = 'yahoo' and external_id = external;
  if not found then raise exception 'Wrong league snapshot'; end if;
  perform private.finish_sleeper_sync(actor, run, snapshot);
  update public.league_connections set provider = 'yahoo'
  where league_id = target and provider = 'sleeper' and external_id = external;
end;
$$;

create function public.store_oauth_state(actor uuid, provider text, state_hash text) returns void
language sql security invoker set search_path='' as $$ select private.store_oauth_state(actor, provider, state_hash); $$;
create function public.consume_oauth_state(actor uuid, provider text, state_hash text) returns boolean
language sql security invoker set search_path='' as $$ select private.consume_oauth_state(actor, provider, state_hash); $$;
create function public.store_provider_credential(actor uuid, provider text, token_ciphertext text, token_iv text, version integer) returns void
language sql security invoker set search_path='' as $$ select private.store_provider_credential(actor, provider, token_ciphertext, token_iv, version); $$;
create function public.read_provider_credential(actor uuid, provider text) returns jsonb
language sql security invoker set search_path='' as $$ select private.read_provider_credential(actor, provider); $$;
create function public.revoke_provider_credential(actor uuid, provider text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is distinct from actor then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform private.revoke_provider_credential(actor, provider);
end;
$$;
create function public.service_revoke_provider_credential(actor uuid, provider text) returns void
language sql security invoker set search_path='' as $$ select private.revoke_provider_credential(actor, provider); $$;
create function public.begin_yahoo_sync(actor uuid, external_league text, league_name text, league_season integer) returns jsonb
language sql security invoker set search_path='' as $$ select private.begin_yahoo_sync(actor, external_league, league_name, league_season); $$;
create function public.finish_yahoo_sync(actor uuid, run uuid, snapshot jsonb) returns void
language sql security invoker set search_path='' as $$ select private.finish_yahoo_sync(actor, run, snapshot); $$;

revoke all on function
  private.store_oauth_state(uuid, text, text),
  private.consume_oauth_state(uuid, text, text),
  private.store_provider_credential(uuid, text, text, text, integer),
  private.read_provider_credential(uuid, text),
  private.revoke_provider_credential(uuid, text),
  private.begin_yahoo_sync(uuid, text, text, integer),
  private.finish_yahoo_sync(uuid, uuid, jsonb),
  public.store_oauth_state(uuid, text, text),
  public.consume_oauth_state(uuid, text, text),
  public.store_provider_credential(uuid, text, text, text, integer),
  public.read_provider_credential(uuid, text),
  public.revoke_provider_credential(uuid, text),
  public.service_revoke_provider_credential(uuid, text),
  public.begin_yahoo_sync(uuid, text, text, integer),
  public.finish_yahoo_sync(uuid, uuid, jsonb)
from public, anon, authenticated, service_role;

grant execute on function public.revoke_provider_credential(uuid, text) to authenticated;
grant execute on function
  private.revoke_provider_credential(uuid, text),
  public.service_revoke_provider_credential(uuid, text)
to service_role;

grant execute on function
  private.store_oauth_state(uuid, text, text),
  private.consume_oauth_state(uuid, text, text),
  private.store_provider_credential(uuid, text, text, text, integer),
  private.read_provider_credential(uuid, text),
  private.begin_yahoo_sync(uuid, text, text, integer),
  private.finish_yahoo_sync(uuid, uuid, jsonb),
  public.store_oauth_state(uuid, text, text),
  public.consume_oauth_state(uuid, text, text),
  public.store_provider_credential(uuid, text, text, text, integer),
  public.read_provider_credential(uuid, text),
  public.begin_yahoo_sync(uuid, text, text, integer),
  public.finish_yahoo_sync(uuid, uuid, jsonb)
to service_role;
