-- Phase 4: user-owned Web Push subscriptions and a deduplicated notification outbox.
-- Clients never receive another person's endpoint or keys.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint_hash text not null check (length(endpoint_hash) = 32),
  endpoint text not null check (endpoint ~ '^https://' and length(endpoint) between 12 and 2000),
  p256dh text not null check (length(p256dh) between 20 and 200),
  auth_secret text not null check (length(auth_secret) between 10 and 100),
  user_agent_summary text check (user_agent_summary is null or length(user_agent_summary) <= 120),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  revoked_at timestamptz,
  unique (user_id, endpoint_hash)
);
create index push_subscriptions_user_idx on public.push_subscriptions(user_id) where revoked_at is null;

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  league_id uuid references public.leagues(id) on delete cascade,
  type text not null check (type in ('vote_open','vote_reminder','vote_result','weekly_recap')),
  dedupe_key text not null unique check (length(dedupe_key) between 8 and 200),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  available_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 80)
);
create index notification_outbox_due_idx on public.notification_outbox(available_at) where status = 'pending';

alter table public.push_subscriptions enable row level security;
alter table public.notification_outbox enable row level security;
revoke all on public.push_subscriptions, public.notification_outbox from public, anon, authenticated, service_role;

create function private.enqueue_vote_notice() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  vote public.trade_votes;
  league_name text;
  tz text;
  summary text;
  kind text;
  title text;
  body text;
begin
  if new.event not in ('vote_opened','results_published') then return new; end if;
  select * into vote from public.trade_votes where id = new.vote_id;
  select name, timezone into league_name, tz from public.leagues where id = new.league_id;
  select left(string_agg(
    t.name || ' receives ' || coalesce((
      select string_agg(a.label, ' + ' order by a.sort_order) from public.trade_assets a where a.side_id = s.id
    ), ''), E'\n' order by s.side_index), 220)
    into summary
  from public.trade_sides s
  join public.teams t on t.id = s.team_id
  where s.vote_id = new.vote_id;
  if new.event = 'vote_opened' then
    kind := 'vote_open';
    title := 'New Trade Vote';
    body := coalesce(summary, 'A trade vote is open') || E'\nCloses ' || to_char(vote.closes_at at time zone tz, 'Dy HH12:MI AM');
  else
    kind := 'vote_result';
    title := 'Trade vote result';
    body := initcap(vote.outcome) || E'\n' || coalesce(summary, league_name);
  end if;
  insert into public.notification_outbox(user_id, league_id, type, dedupe_key, payload)
  select m.user_id, new.league_id, kind,
    kind || ':' || new.vote_id::text || ':' || m.user_id::text,
    jsonb_build_object(
      'title', title,
      'body', left(body, 280),
      'url', '/leagues/' || new.league_id::text || '/trades/' || new.vote_id::text
    )
  from public.trade_vote_eligibility e
  join public.league_members m on m.league_id = new.league_id and m.team_id = e.team_id
  where e.vote_id = new.vote_id
  on conflict (dedupe_key) do nothing;
  return new;
end;
$$;
create trigger enqueue_vote_notice after insert on public.trade_vote_events
for each row execute function private.enqueue_vote_notice();

create function private.enqueue_trade_reminders() returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  insert into public.notification_outbox(user_id, league_id, type, dedupe_key, payload)
  select m.user_id, v.league_id, 'vote_reminder',
    'vote_reminder:' || v.id::text || ':' || m.user_id::text,
    jsonb_build_object(
      'title', 'Trade vote closing soon',
      'body', 'Voting closes ' || to_char(v.closes_at at time zone l.timezone, 'Dy HH12:MI AM'),
      'url', '/leagues/' || v.league_id::text || '/trades/' || v.id::text
    )
  from public.trade_votes v
  join public.leagues l on l.id = v.league_id
  join public.trade_vote_eligibility e on e.vote_id = v.id
  join public.league_members m on m.league_id = v.league_id and m.team_id = e.team_id
  where v.status = 'open' and v.closes_at > clock_timestamp() and v.closes_at <= clock_timestamp() + interval '6 hours'
  on conflict (dedupe_key) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

create function private.save_push_subscription(endpoint text, key_p256dh text, key_auth text, agent text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid(); saved uuid; summary text;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if endpoint !~ '^https://' or length(endpoint) > 2000 or length(key_p256dh) not between 20 and 200 or length(key_auth) not between 10 and 100 then
    raise exception 'Invalid subscription';
  end if;
  perform private.consume_rate('push:' || uid::text, 10, 3600);
  summary := nullif(left(regexp_replace(coalesce(agent, ''), '[^[:print:]]', '', 'g'), 120), '');
  insert into public.push_subscriptions(user_id, endpoint_hash, endpoint, p256dh, auth_secret, user_agent_summary)
  values (uid, md5(endpoint), endpoint, key_p256dh, key_auth, summary)
  on conflict (user_id, endpoint_hash) do update
    set p256dh = excluded.p256dh,
        auth_secret = excluded.auth_secret,
        user_agent_summary = excluded.user_agent_summary,
        revoked_at = null
  returning id into saved;
  return saved;
end;
$$;

create function private.revoke_push_subscription(target uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  update public.push_subscriptions set revoked_at = clock_timestamp()
  where id = target and user_id = auth.uid() and revoked_at is null;
  if not found then raise exception 'Subscription not found'; end if;
end;
$$;

create function private.my_push_devices() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id,
      'user_agent_summary', user_agent_summary,
      'created_at', created_at,
      'active', revoked_at is null
    ) order by created_at desc)
    from public.push_subscriptions where user_id = auth.uid()
  ), '[]'::jsonb);
end;
$$;

create function private.league_push_status(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.is_commissioner(target) then
    raise exception 'Commissioner required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'label', t.name,
      'push_enabled', exists (
        select 1 from public.league_members m
        join public.push_subscriptions p on p.user_id = m.user_id and p.revoked_at is null
        where m.league_id = t.league_id and m.team_id = t.id
      )
    ) order by t.name)
    from public.teams t where t.league_id = target and t.active
  ), '[]'::jsonb);
end;
$$;

create function private.claim_notifications(batch integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item uuid; ids uuid[] := '{}';
begin
  if batch < 1 or batch > 10 then raise exception 'Invalid subscription'; end if;
  for item in
    select id from public.notification_outbox
    where status = 'pending' and available_at <= clock_timestamp() and attempts < 5
    order by available_at
    limit batch
    for update skip locked
  loop
    ids := ids || item;
  end loop;
  update public.notification_outbox set status = 'sending', attempts = attempts + 1 where id = any(ids);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id,
      'user_id', o.user_id,
      'league_id', o.league_id,
      'payload', o.payload,
      'subscriptions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id, 'endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth_secret', p.auth_secret
        ))
        from public.push_subscriptions p
        where p.user_id = o.user_id and p.revoked_at is null
      ), '[]'::jsonb)
    ))
    from public.notification_outbox o where o.id = any(ids)
  ), '[]'::jsonb);
end;
$$;

create function private.complete_notification(target uuid, outcome text, drop_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare tries integer;
begin
  if outcome not in ('sent','failed','skipped') then raise exception 'Invalid subscription'; end if;
  select attempts into tries from public.notification_outbox where id = target for update;
  if not found then return; end if;
  if outcome = 'sent' then
    update public.notification_outbox set status = 'sent', sent_at = clock_timestamp(), last_error = null where id = target;
    update public.push_subscriptions set last_success_at = clock_timestamp()
    where user_id = (select user_id from public.notification_outbox where id = target) and revoked_at is null;
  elsif outcome = 'skipped' then
    update public.notification_outbox set status = 'skipped', last_error = 'no_subscription' where id = target;
  elsif tries >= 5 then
    update public.notification_outbox set status = 'failed', last_error = 'delivery_failed' where id = target;
  else
    update public.notification_outbox
      set status = 'pending', available_at = clock_timestamp() + interval '15 minutes', last_error = 'delivery_failed'
      where id = target;
  end if;
  if drop_ids is not null then
    update public.push_subscriptions set revoked_at = clock_timestamp() where id = any(drop_ids);
  end if;
end;
$$;

create function public.save_push_subscription(endpoint text, key_p256dh text, key_auth text, agent text) returns uuid
language sql security invoker set search_path='' as $$ select private.save_push_subscription(endpoint, key_p256dh, key_auth, agent); $$;
create function public.revoke_push_subscription(target uuid) returns void
language sql security invoker set search_path='' as $$ select private.revoke_push_subscription(target); $$;
create function public.my_push_devices() returns jsonb
language sql security invoker set search_path='' as $$ select private.my_push_devices(); $$;
create function public.league_push_status(target uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.league_push_status(target); $$;
create function public.enqueue_trade_reminders() returns integer
language sql security invoker set search_path='' as $$ select private.enqueue_trade_reminders(); $$;
create function public.claim_notifications(batch integer) returns jsonb
language sql security invoker set search_path='' as $$ select private.claim_notifications(batch); $$;
create function public.complete_notification(target uuid, outcome text, drop_ids uuid[]) returns void
language sql security invoker set search_path='' as $$ select private.complete_notification(target, outcome, drop_ids); $$;

revoke all on function
  private.enqueue_vote_notice(),
  private.enqueue_trade_reminders(),
  private.save_push_subscription(text, text, text, text),
  private.revoke_push_subscription(uuid),
  private.my_push_devices(),
  private.league_push_status(uuid),
  private.claim_notifications(integer),
  private.complete_notification(uuid, text, uuid[]),
  public.save_push_subscription(text, text, text, text),
  public.revoke_push_subscription(uuid),
  public.my_push_devices(),
  public.league_push_status(uuid),
  public.enqueue_trade_reminders(),
  public.claim_notifications(integer),
  public.complete_notification(uuid, text, uuid[])
from public, anon, authenticated, service_role;

grant execute on function
  private.save_push_subscription(text, text, text, text),
  private.revoke_push_subscription(uuid),
  private.my_push_devices(),
  private.league_push_status(uuid),
  public.save_push_subscription(text, text, text, text),
  public.revoke_push_subscription(uuid),
  public.my_push_devices(),
  public.league_push_status(uuid)
to authenticated;

grant execute on function
  private.enqueue_trade_reminders(),
  private.claim_notifications(integer),
  private.complete_notification(uuid, text, uuid[]),
  public.enqueue_trade_reminders(),
  public.claim_notifications(integer),
  public.complete_notification(uuid, text, uuid[])
to service_role;
