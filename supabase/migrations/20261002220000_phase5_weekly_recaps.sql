-- Phase 5: weekly recaps, vocabulary cooldown, and matchup bench facts.
-- Recap rows are unique per league/season/week. Notifications use the existing outbox.

alter table public.matchups
  add column starter_points numeric(10,2),
  add column bench_points numeric(10,2),
  add column bench_beat_starter boolean not null default false,
  add column bench_would_flip boolean not null default false;

alter table public.league_preferences
  add column trash_talk text not null default 'normal' check (trash_talk in ('light','normal','savage')),
  add column profanity text not null default 'clean' check (profanity in ('clean','some','uncensored')),
  add column adult_humor boolean not null default false,
  add column meme_level text not null default 'medium' check (meme_level in ('low','medium','brainrot')),
  add column recap_length text not null default 'normal' check (recap_length in ('quick','normal','full'));

create table public.weekly_recaps (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  season smallint not null,
  week smallint not null check (week between 1 and 22),
  status text not null check (status in ('published','edited')),
  engine_version text not null check (length(engine_version) between 1 and 20),
  settings_snapshot jsonb not null,
  facts_snapshot jsonb not null,
  body text not null check (length(body) between 1 and 12000),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  published_at timestamptz not null default now(),
  edited_at timestamptz,
  unique (league_id, season, week)
);

create table public.weekly_recap_team_sections (
  recap_id uuid not null references public.weekly_recaps(id) on delete cascade,
  team_id uuid not null,
  league_id uuid not null,
  facts jsonb not null,
  short_notification text not null check (length(short_notification) between 1 and 280),
  section_body text not null check (length(section_body) between 1 and 2000),
  primary key (recap_id, team_id),
  foreign key (league_id, team_id) references public.teams(league_id, id)
);

create table public.vocabulary_usage (
  league_id uuid not null references public.leagues(id) on delete cascade,
  vocabulary_id text not null check (length(vocabulary_id) between 1 and 80),
  family text not null check (length(family) between 1 and 40),
  season smallint not null,
  week smallint not null check (week between 1 and 22),
  used_at timestamptz not null default now(),
  use_count integer not null default 1 check (use_count > 0),
  primary key (league_id, vocabulary_id, season, week)
);

alter table public.weekly_recaps enable row level security;
alter table public.weekly_recap_team_sections enable row level security;
alter table public.vocabulary_usage enable row level security;
revoke all on public.weekly_recaps, public.weekly_recap_team_sections, public.vocabulary_usage
  from public, anon, authenticated, service_role;
grant select on public.weekly_recaps, public.weekly_recap_team_sections, public.vocabulary_usage to authenticated;
create policy weekly_recaps_read on public.weekly_recaps for select to authenticated
  using (private.can_read_league(league_id));
create policy weekly_recap_sections_read on public.weekly_recap_team_sections for select to authenticated
  using (private.can_read_league(league_id));
create policy vocabulary_usage_read on public.vocabulary_usage for select to authenticated
  using (private.can_read_league(league_id));

create or replace function private.update_league_preferences(target uuid, prefs jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare
  existing public.league_preferences;
  hours integer;
  participants boolean;
  talk text;
  swear text;
  humor boolean;
  memes text;
  length_setting text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform 1 from public.leagues where id = target and commissioner_id = auth.uid() for update;
  if not found then raise exception 'Commissioner required' using errcode = '42501'; end if;
  select * into existing from public.league_preferences where league_id = target;
  participants := coalesce((prefs->>'participants_may_vote')::boolean, existing.participants_may_vote, false);
  hours := coalesce((prefs->>'default_vote_hours')::integer, existing.default_vote_hours, 48);
  talk := coalesce(prefs->>'trash_talk', existing.trash_talk, 'normal');
  swear := coalesce(prefs->>'profanity', existing.profanity, 'clean');
  humor := coalesce((prefs->>'adult_humor')::boolean, existing.adult_humor, false);
  memes := coalesce(prefs->>'meme_level', existing.meme_level, 'medium');
  length_setting := coalesce(prefs->>'recap_length', existing.recap_length, 'normal');
  if hours < 1 or hours > 168 then raise exception 'Invalid trade'; end if;
  if talk not in ('light','normal','savage') or swear not in ('clean','some','uncensored')
    or memes not in ('low','medium','brainrot') or length_setting not in ('quick','normal','full') then
    raise exception 'Invalid recap settings';
  end if;
  insert into public.league_preferences(
    league_id, participants_may_vote, default_vote_hours, trash_talk, profanity, adult_humor, meme_level, recap_length
  ) values (target, participants, hours, talk, swear, humor, memes, length_setting)
  on conflict (league_id) do update set
    participants_may_vote = excluded.participants_may_vote,
    default_vote_hours = excluded.default_vote_hours,
    trash_talk = excluded.trash_talk,
    profanity = excluded.profanity,
    adult_humor = excluded.adult_humor,
    meme_level = excluded.meme_level,
    recap_length = excluded.recap_length;
end;
$$;

create function private.write_matchup_scores(target uuid, match jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare entry jsonb; opponent jsonb; team uuid; other_team uuid; wk integer;
begin
  wk := (match->>'week')::integer;
  if wk is null or wk < 1 or wk > 22 then raise exception 'Invalid snapshot'; end if;
  for entry in select value from jsonb_array_elements(match->'scores') loop
    select id into team from public.teams where league_id = target and external_id = entry->>'teamId' and active;
    if team is null then raise exception 'Invalid snapshot'; end if;
    select value into opponent from jsonb_array_elements(match->'scores') where value->>'teamId' <> entry->>'teamId' limit 1;
    select id into other_team from public.teams where league_id = target and external_id = opponent->>'teamId' and active;
    insert into public.matchups(
      league_id, week, team_id, opponent_id, provider_matchup_id, team_score, opponent_score, status,
      starter_points, bench_points, bench_beat_starter, bench_would_flip
    ) values (
      target, wk, team, other_team, match->>'id',
      (entry->>'points')::numeric, (opponent->>'points')::numeric, match->>'status',
      nullif(entry->>'starterPoints','')::numeric, nullif(entry->>'benchPoints','')::numeric,
      coalesce((entry->>'benchBeatStarter')::boolean, false),
      coalesce((entry->>'benchWouldFlip')::boolean, false)
    );
  end loop;
end;
$$;

create or replace function private.finish_sleeper_sync(actor uuid, run uuid, snapshot jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare target uuid; item jsonb; manager jsonb; match jsonb; team uuid; wk integer; history_week integer;
begin
  select league_id into target from public.sync_runs where id = run and actor_id = actor;
  perform 1 from public.leagues where id = target and commissioner_id = actor for update;
  if not found then raise exception 'Commissioner required' using errcode = '42501'; end if;
  perform 1 from public.sync_runs where id = run and status = 'syncing' and started_at > now() - interval '2 minutes' for update;
  if not found then raise exception 'Sync expired'; end if;
  if jsonb_typeof(snapshot->'teams') <> 'array' or jsonb_array_length(snapshot->'teams') = 0 then raise exception 'Invalid snapshot'; end if;
  if not exists(select 1 from public.league_connections where league_id = target and provider = 'sleeper' and external_id = snapshot->'league'->>'externalId') then raise exception 'Wrong league snapshot'; end if;
  wk := (snapshot->'league'->>'currentWeek')::integer;
  update public.teams set active = false where league_id = target;
  delete from public.team_provider_managers where league_id = target;
  update public.provider_managers set team_id = null where league_id = target;
  for manager in select value from jsonb_array_elements(snapshot->'managers') loop
    insert into public.provider_managers(league_id, external_id, display_name)
    values (target, manager->>'externalId', manager->>'displayName')
    on conflict (league_id, external_id) do update set display_name = excluded.display_name;
  end loop;
  for item in select value from jsonb_array_elements(snapshot->'teams') loop
    insert into public.teams(league_id, external_id, name, wins, losses, ties, points_for, points_against, active)
    values (
      target, item->>'externalId', item->>'name',
      (item->>'wins')::integer, (item->>'losses')::integer, (item->>'ties')::integer,
      (item->>'pointsFor')::numeric, (item->>'pointsAgainst')::numeric, true
    )
    on conflict (league_id, external_id) do update set
      name = excluded.name, wins = excluded.wins, losses = excluded.losses, ties = excluded.ties,
      points_for = excluded.points_for, points_against = excluded.points_against, active = true
    returning id into team;
    for manager in select value from jsonb_array_elements(item->'managers') loop
      insert into public.team_provider_managers(league_id, team_id, manager_external_id)
      values (target, team, manager->>'externalId');
      update public.provider_managers set team_id = team where league_id = target and external_id = manager->>'externalId';
    end loop;
  end loop;
  if wk is not null then
    delete from public.matchups where league_id = target and week = wk;
    for match in select value from jsonb_array_elements(coalesce(snapshot->'matchups', '[]'::jsonb)) loop
      if (match->>'week')::integer <> wk then raise exception 'Wrong matchup week'; end if;
      perform private.write_matchup_scores(target, match);
    end loop;
  end if;
  if jsonb_typeof(snapshot->'history') = 'array' then
    for history_week in
      select distinct (value->>'week')::integer from jsonb_array_elements(snapshot->'history')
    loop
      if history_week is distinct from wk then
        delete from public.matchups where league_id = target and week = history_week;
      end if;
    end loop;
    for match in select value from jsonb_array_elements(snapshot->'history') loop
      if (match->>'week')::integer is distinct from wk then
        perform private.write_matchup_scores(target, match);
      end if;
    end loop;
  end if;
  update public.leagues set
    name = snapshot->'league'->>'name',
    season = (snapshot->'league'->>'season')::integer,
    status = coalesce(snapshot->'league'->>'status', status),
    total_teams = jsonb_array_length(snapshot->'teams'),
    current_week = wk,
    sync_status = 'complete',
    last_synced_at = now()
  where id = target;
  update public.sync_runs set status = 'complete', finished_at = now() where id = run;
end;
$$;

create function private.upsert_matchup_week(target uuid, wk integer, matchups jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare match jsonb;
begin
  perform 1 from public.leagues where id = target for update;
  if not found then raise exception 'League unavailable'; end if;
  if wk < 1 or wk > 22 or jsonb_typeof(matchups) <> 'array' then raise exception 'Invalid snapshot'; end if;
  delete from public.matchups where league_id = target and week = wk;
  for match in select value from jsonb_array_elements(matchups) loop
    if (match->>'week')::integer <> wk then raise exception 'Wrong matchup week'; end if;
    perform private.write_matchup_scores(target, match);
  end loop;
end;
$$;

create function private.recap_source(target uuid, wk integer) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'season', l.season,
    'timezone', l.timezone,
    'current_week', l.current_week,
    'settings', jsonb_build_object(
      'trash_talk', coalesce(p.trash_talk, 'normal'),
      'profanity', coalesce(p.profanity, 'clean'),
      'adult_humor', coalesce(p.adult_humor, false),
      'meme_level', coalesce(p.meme_level, 'medium'),
      'recap_length', coalesce(p.recap_length, 'normal')
    ),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'external_id', t.external_id))
      from public.teams t where t.league_id = target and t.active
    ), '[]'::jsonb),
    'matchups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'week', m.week, 'team_id', m.team_id, 'opponent_id', m.opponent_id,
        'team_score', m.team_score, 'opponent_score', m.opponent_score, 'status', m.status,
        'bench_points', m.bench_points, 'starter_points', m.starter_points,
        'bench_beat_starter', m.bench_beat_starter, 'bench_would_flip', m.bench_would_flip
      ))
      from public.matchups m where m.league_id = target
    ), '[]'::jsonb),
    'usage', coalesce((
      select jsonb_agg(jsonb_build_object('vocabulary_id', u.vocabulary_id, 'family', u.family, 'week', u.week))
      from public.vocabulary_usage u where u.league_id = target
    ), '[]'::jsonb)
  )
  from public.leagues l
  left join public.league_preferences p on p.league_id = l.id
  where l.id = target and wk between 1 and 22;
$$;

create function private.due_recap_candidates(batch integer) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(candidate)), '[]'::jsonb) from (
    select l.id as league_id, l.season, l.timezone, l.current_week, (l.current_week - 1) as week,
      c.provider, c.external_id
    from public.leagues l
    join public.league_connections c on c.league_id = l.id
    where l.current_week > 1
      and not exists (
        select 1 from public.weekly_recaps r
        where r.league_id = l.id and r.season = l.season and r.week = l.current_week - 1
      )
    order by l.last_synced_at nulls first
    limit greatest(1, least(batch, 8))
  ) candidate;
$$;

create function private.publish_weekly_recap(target uuid, season_year integer, wk integer, payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare saved uuid; section jsonb; phrase jsonb;
begin
  if wk < 1 or wk > 22 or length(coalesce(payload->>'body', '')) not between 1 and 12000 then
    raise exception 'Invalid recap';
  end if;
  if coalesce(payload->>'source_hash', '') !~ '^[0-9a-f]{64}$' then raise exception 'Invalid recap'; end if;
  insert into public.weekly_recaps(
    league_id, season, week, status, engine_version, settings_snapshot, facts_snapshot, body, source_hash
  ) values (
    target, season_year, wk, 'published', coalesce(payload->>'engine_version', '1'),
    coalesce(payload->'settings', '{}'::jsonb), coalesce(payload->'facts', '{}'::jsonb),
    payload->>'body', payload->>'source_hash'
  )
  on conflict (league_id, season, week) do nothing
  returning id into saved;
  if saved is null then
    select id into saved from public.weekly_recaps
    where league_id = target and season = season_year and week = wk;
    return saved;
  end if;
  for section in select value from jsonb_array_elements(coalesce(payload->'sections', '[]'::jsonb)) loop
    perform 1 from public.teams where league_id = target and id = (section->>'team_id')::uuid;
    if not found then raise exception 'Invalid recap'; end if;
    insert into public.weekly_recap_team_sections(
      recap_id, team_id, league_id, facts, short_notification, section_body
    ) values (
      saved, (section->>'team_id')::uuid, target, coalesce(section->'facts', '{}'::jsonb),
      left(section->>'short_notification', 280), left(section->>'section_body', 2000)
    );
  end loop;
  for phrase in select value from jsonb_array_elements(coalesce(payload->'vocabulary', '[]'::jsonb)) loop
    insert into public.vocabulary_usage(league_id, vocabulary_id, family, season, week)
    values (target, phrase->>'id', phrase->>'family', season_year, wk)
    on conflict (league_id, vocabulary_id, season, week) do update set use_count = public.vocabulary_usage.use_count + 1;
  end loop;
  insert into public.notification_outbox(user_id, league_id, type, dedupe_key, payload)
  select m.user_id, target, 'weekly_recap',
    'weekly_recap:' || saved::text || ':' || m.user_id::text,
    jsonb_build_object(
      'title', 'Week ' || wk::text,
      'body', left(coalesce((
        select s.short_notification from public.weekly_recap_team_sections s
        where s.recap_id = saved and s.team_id = m.team_id
      ), 'Week ' || wk::text || ' recap is ready.'), 280),
      'url', '/leagues/' || target::text || '/recaps/' || wk::text
    )
  from public.league_members m
  where m.league_id = target and m.team_id is not null
  on conflict (dedupe_key) do nothing;
  return saved;
end;
$$;

create function private.replace_weekly_recap(target uuid, new_body text, sections jsonb, resend boolean) returns void
language plpgsql security definer set search_path='' as $$
declare recap public.weekly_recaps; section jsonb; stamp text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into recap from public.weekly_recaps where id = target for update;
  if not found then raise exception 'Recap not found'; end if;
  perform 1 from public.leagues where id = recap.league_id and commissioner_id = auth.uid();
  if not found then raise exception 'Commissioner required' using errcode = '42501'; end if;
  perform private.consume_rate('recap:' || auth.uid()::text, 8, 3600);
  if length(coalesce(new_body, '')) not between 1 and 12000 then raise exception 'Invalid recap'; end if;
  update public.weekly_recaps set body = new_body, status = 'edited', edited_at = clock_timestamp() where id = target;
  if jsonb_typeof(sections) = 'array' then
    for section in select value from jsonb_array_elements(sections) loop
      update public.weekly_recap_team_sections
      set section_body = left(section->>'section_body', 2000),
          short_notification = left(coalesce(section->>'short_notification', short_notification), 280)
      where recap_id = target and team_id = (section->>'team_id')::uuid;
    end loop;
  end if;
  if coalesce(resend, false) then
    stamp := substr(md5(new_body), 1, 12);
    insert into public.notification_outbox(user_id, league_id, type, dedupe_key, payload)
    select m.user_id, recap.league_id, 'weekly_recap',
      'weekly_recap_resend:' || recap.id::text || ':' || m.user_id::text || ':' || stamp,
      jsonb_build_object(
        'title', 'Week ' || recap.week::text,
        'body', left(coalesce((
          select s.short_notification from public.weekly_recap_team_sections s
          where s.recap_id = recap.id and s.team_id = m.team_id
        ), 'The week ' || recap.week::text || ' recap was updated.'), 280),
        'url', '/leagues/' || recap.league_id::text || '/recaps/' || recap.week::text
      )
    from public.league_members m
    where m.league_id = recap.league_id and m.team_id is not null
    on conflict (dedupe_key) do nothing;
  end if;
end;
$$;

create function private.set_league_timezone(target uuid, zone text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform 1 from public.leagues where id = target and commissioner_id = auth.uid() for update;
  if not found then raise exception 'Commissioner required' using errcode = '42501'; end if;
  if zone !~ '^[A-Za-z0-9_+\-/]{1,64}$' then raise exception 'Invalid recap settings'; end if;
  update public.leagues set timezone = zone where id = target;
end;
$$;

create function public.due_recap_candidates(batch integer) returns jsonb
language sql security invoker set search_path='' as $$ select private.due_recap_candidates(batch); $$;
create function public.recap_source(target uuid, wk integer) returns jsonb
language sql security invoker set search_path='' as $$ select private.recap_source(target, wk); $$;
create function public.publish_weekly_recap(target uuid, season_year integer, wk integer, payload jsonb) returns uuid
language sql security invoker set search_path='' as $$ select private.publish_weekly_recap(target, season_year, wk, payload); $$;
create function public.upsert_matchup_week(target uuid, wk integer, matchups jsonb) returns void
language sql security invoker set search_path='' as $$ select private.upsert_matchup_week(target, wk, matchups); $$;
create function public.replace_weekly_recap(target uuid, new_body text, sections jsonb, resend boolean) returns void
language sql security invoker set search_path='' as $$ select private.replace_weekly_recap(target, new_body, sections, resend); $$;
create function public.set_league_timezone(target uuid, zone text) returns void
language sql security invoker set search_path='' as $$ select private.set_league_timezone(target, zone); $$;

revoke all on function
  private.write_matchup_scores(uuid, jsonb),
  private.upsert_matchup_week(uuid, integer, jsonb),
  private.recap_source(uuid, integer),
  private.due_recap_candidates(integer),
  private.publish_weekly_recap(uuid, integer, integer, jsonb),
  private.replace_weekly_recap(uuid, text, jsonb, boolean),
  public.due_recap_candidates(integer),
  public.recap_source(uuid, integer),
  public.publish_weekly_recap(uuid, integer, integer, jsonb),
  public.upsert_matchup_week(uuid, integer, jsonb),
  public.replace_weekly_recap(uuid, text, jsonb, boolean),
  private.set_league_timezone(uuid, text),
  public.set_league_timezone(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function
  private.replace_weekly_recap(uuid, text, jsonb, boolean),
  public.replace_weekly_recap(uuid, text, jsonb, boolean),
  private.set_league_timezone(uuid, text),
  public.set_league_timezone(uuid, text)
to authenticated;

grant execute on function
  private.upsert_matchup_week(uuid, integer, jsonb),
  private.recap_source(uuid, integer),
  private.due_recap_candidates(integer),
  private.publish_weekly_recap(uuid, integer, integer, jsonb),
  public.due_recap_candidates(integer),
  public.recap_source(uuid, integer),
  public.publish_weekly_recap(uuid, integer, integer, jsonb),
  public.upsert_matchup_week(uuid, integer, jsonb)
to service_role;
