import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const authBootstrap = `create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key, email text); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$; grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid() to authenticated, service_role;`;
const commissioner = "00000000-0000-4000-8000-000000000001";
const alice = "00000000-0000-4000-8000-000000000002";
const bob = "00000000-0000-4000-8000-000000000003";
const league = "10000000-0000-4000-8000-000000000001";
const teams = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "20000000-0000-4000-8000-000000000003",
];
const hash = "a".repeat(64);
let db: PGlite;

async function as<T>(user: string, fn: () => Promise<T>) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
async function service<T>(fn: () => Promise<T>) {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(authBootstrap);
  for (const file of readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql")).sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
});
beforeEach(async () => {
  await db.exec("reset role; truncate auth.users, public.profiles, public.leagues, private.rate_buckets cascade");
  for (const [id, email] of [
    [commissioner, "c@test.com"],
    [alice, "a@test.com"],
    [bob, "b@test.com"],
  ])
    await db.query("insert into auth.users(id, email) values ($1,$2)", [id, email]);
  await db.query(
    "insert into public.leagues(id, name, season, commissioner_id, current_week, timezone, last_synced_at, sync_status) values ($1,'League',2026,$2,8,'America/New_York',now(),'complete')",
    [league, commissioner],
  );
  await db.query(
    "insert into public.teams(id, league_id, external_id, name) values ($1,$2,'1','Alpha'),($3,$2,'2','Bravo'),($4,$2,'3','Alice FC')",
    [teams[0], league, teams[1], teams[2]],
  );
  await db.query(
    "insert into public.league_members(league_id, user_id, team_id) values ($1,$2,$3),($1,$4,$5)",
    [league, bob, teams[1], alice, teams[2]],
  );
});
afterAll(async () => {
  await db.close();
});

describe("weekly recap persistence", () => {
  const payload = {
    engine_version: "1",
    settings: { trash_talk: "normal" },
    facts: { week: 7 },
    body: "Week 7. Alice FC beat Bravo.",
    source_hash: hash,
    sections: [
      {
        team_id: teams[2],
        facts: { tags: ["BLOWOUT_WIN"] },
        short_notification: "You beat Bravo.",
        section_body: "Alice FC won.",
      },
      {
        team_id: teams[1],
        facts: { tags: ["BLOWOUT_LOSS"] },
        short_notification: "You lost to Alice FC.",
        section_body: "Bravo lost.",
      },
    ],
    vocabulary: [{ id: "plot-armor", family: "luck" }],
  };

  it("publishes one recap and does not notify twice when the job retries", async () => {
    const first = await service(() =>
      db.query<{ publish_weekly_recap: string }>("select public.publish_weekly_recap($1,2026,7,$2::jsonb)", [
        league,
        JSON.stringify(payload),
      ]),
    );
    const second = await service(() =>
      db.query<{ publish_weekly_recap: string }>("select public.publish_weekly_recap($1,2026,7,$2::jsonb)", [
        league,
        JSON.stringify(payload),
      ]),
    );
    expect(second.rows[0]!.publish_weekly_recap).toBe(first.rows[0]!.publish_weekly_recap);
    expect((await db.query("select id from public.weekly_recaps")).rows).toHaveLength(1);
    const notices = await db.query<{ user_id: string }>(
      "select user_id from public.notification_outbox where type = 'weekly_recap' order by user_id",
    );
    expect(notices.rows.map((row) => row.user_id).sort()).toEqual([alice, bob].sort());
    await expect(
      as(alice, () => db.query("select endpoint from public.push_subscriptions")),
    ).rejects.toThrow();
  });

  it("lets the commissioner edit without a resend, and blocks everyone else", async () => {
    const created = await service(() =>
      db.query<{ publish_weekly_recap: string }>("select public.publish_weekly_recap($1,2026,7,$2::jsonb)", [
        league,
        JSON.stringify(payload),
      ]),
    );
    const recap = created.rows[0]!.publish_weekly_recap;
    await expect(
      as(alice, () => db.query("select public.replace_weekly_recap($1,'nope',null,false)", [recap])),
    ).rejects.toThrow(/Commissioner required/);
    await as(commissioner, () =>
      db.query("select public.replace_weekly_recap($1,'Edited recap.',null,false)", [recap]),
    );
    expect((await db.query("select id from public.notification_outbox")).rows).toHaveLength(2);
    await as(commissioner, () =>
      db.query("select public.replace_weekly_recap($1,'Edited recap again.',null,true)", [recap]),
    );
    expect((await db.query("select id from public.notification_outbox")).rows).toHaveLength(4);
    await as(commissioner, () =>
      db.query("select public.replace_weekly_recap($1,'Edited recap again.',null,true)", [recap]),
    );
    expect((await db.query("select id from public.notification_outbox")).rows).toHaveLength(4);
  });
});
