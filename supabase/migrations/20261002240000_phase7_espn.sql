-- Phase 7: ESPN imports reuse the shared snapshot writer. Credentials stay in provider_credentials.

create function private.begin_espn_sync(actor uuid, external_league text, league_name text, league_season integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target uuid; owner uuid; run_id uuid;
begin
  if not exists(select 1 from public.profiles where id = actor) then raise exception 'Invalid actor'; end if;
  if external_league !~ '^[0-9]{1,12}$' then raise exception 'Invalid league ID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('espn:' || external_league, 0));
  select league_id into target from public.league_connections where provider = 'espn' and external_id = external_league;
  if target is null then
    if (select count(*) from public.sync_runs where actor_id = actor and started_at > now() - interval '1 hour') >= 20 then
      raise exception 'Import limit reached';
    end if;
    insert into public.leagues(name, season, commissioner_id) values (league_name, league_season, actor) returning id into target;
    insert into public.league_connections(league_id, provider, external_id) values (target, 'espn', external_league);
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
  values (target, actor, 'espn', external_league, 'syncing') returning id into run_id;
  update public.leagues set sync_status = 'syncing' where id = target;
  return jsonb_build_object('league_id', target, 'run_id', run_id);
end;
$$;

create function private.finish_espn_sync(actor uuid, run uuid, snapshot jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare target uuid; external text;
begin
  select league_id into target from public.sync_runs where id = run and actor_id = actor and provider = 'espn';
  if target is null then raise exception 'Sync expired'; end if;
  external := snapshot->'league'->>'externalId';
  update public.league_connections set provider = 'sleeper'
  where league_id = target and provider = 'espn' and external_id = external;
  if not found then raise exception 'Wrong league snapshot'; end if;
  perform private.finish_sleeper_sync(actor, run, snapshot);
  update public.league_connections set provider = 'espn'
  where league_id = target and provider = 'sleeper' and external_id = external;
end;
$$;

create function public.begin_espn_sync(actor uuid, external_league text, league_name text, league_season integer) returns jsonb
language sql security invoker set search_path='' as $$ select private.begin_espn_sync(actor, external_league, league_name, league_season); $$;
create function public.finish_espn_sync(actor uuid, run uuid, snapshot jsonb) returns void
language sql security invoker set search_path='' as $$ select private.finish_espn_sync(actor, run, snapshot); $$;

revoke all on function
  private.begin_espn_sync(uuid, text, text, integer),
  private.finish_espn_sync(uuid, uuid, jsonb),
  public.begin_espn_sync(uuid, text, text, integer),
  public.finish_espn_sync(uuid, uuid, jsonb)
from public, anon, authenticated, service_role;

grant execute on function
  private.begin_espn_sync(uuid, text, text, integer),
  private.finish_espn_sync(uuid, uuid, jsonb),
  public.begin_espn_sync(uuid, text, text, integer),
  public.finish_espn_sync(uuid, uuid, jsonb)
to service_role;
