import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";

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
  for (const file of readdirSync("supabase/migrations").filter((file) => file.endsWith(".sql")).sort())
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
    "insert into public.leagues(id, name, season, commissioner_id, last_synced_at, sync_status) values ($1,'League',2026,$2,now(),'complete')",
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

describe("web push data", () => {
  it("stores only the caller's devices and hides raw endpoints", async () => {
    const first = await as(alice, () =>
      db.query<{ save_push_subscription: string }>(
        "select public.save_push_subscription($1,$2,$3,$4)",
        ["https://push.example/a", "p256dh-value-aaaaaaaa", "auth-secret-value", "Alice phone"],
      ),
    );
    await as(alice, () =>
      db.query("select public.save_push_subscription($1,$2,$3,$4)", [
        "https://push.example/b",
        "p256dh-value-bbbbbbbb",
        "auth-secret-value",
        "Alice laptop",
      ]),
    );
    const devices = await as(alice, () =>
      db.query<{ my_push_devices: { id: string }[] }>("select public.my_push_devices()"),
    );
    expect(devices.rows[0]!.my_push_devices).toHaveLength(2);
    expect(JSON.stringify(devices.rows[0]!.my_push_devices)).not.toContain("push.example");
    await as(bob, async () => {
      await expect(db.query("select endpoint from public.push_subscriptions")).rejects.toThrow(
        /permission denied/,
      );
      expect((await db.query("select public.my_push_devices()")).rows[0]).toEqual({
        my_push_devices: [],
      });
    });
    await as(alice, () =>
      db.query("select public.revoke_push_subscription($1)", [first.rows[0]!.save_push_subscription]),
    );
    const status = await as(commissioner, () =>
      db.query<{ league_push_status: { label: string; push_enabled: boolean }[] }>(
        "select public.league_push_status($1)",
        [league],
      ),
    );
    expect(status.rows[0]!.league_push_status).toEqual(
      expect.arrayContaining([
        { label: "Alice FC", push_enabled: true },
        { label: "Bravo", push_enabled: false },
      ]),
    );
    expect(JSON.stringify(status.rows[0]!.league_push_status)).not.toContain("https://");
  });

  it("dedupes vote notifications and drops expired subscriptions", async () => {
    await as(alice, () =>
      db.query("select public.save_push_subscription($1,$2,$3,$4)", [
        "https://push.example/a",
        "p256dh-value-aaaaaaaa",
        "auth-secret-value",
        "phone",
      ]),
    );
    const vote = await as(commissioner, () =>
      db.query<{ publish_trade_vote: string }>("select public.publish_trade_vote($1::jsonb)", [
        JSON.stringify({
          league_id: league,
          privacy_mode: "anonymous",
          participants_may_vote: false,
          closes_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
          required_veto_votes: 1,
          sides: [
            { team_id: teams[0], assets: [{ type: "player", label: "Gibbs" }] },
            { team_id: teams[1], assets: [{ type: "player", label: "Nabers" }] },
          ],
          eligible_team_ids: [teams[2]],
        }),
      ]),
    );
    const rows = await db.query<{ user_id: string; type: string }>(
      "select user_id, type from public.notification_outbox",
    );
    expect(rows.rows).toEqual([{ user_id: alice, type: "vote_open" }]);
    await db.query(
      "insert into public.trade_vote_events(vote_id, league_id, event) values ($1,$2,'vote_opened')",
      [vote.rows[0]!.publish_trade_vote, league],
    );
    expect((await db.query("select id from public.notification_outbox")).rows).toHaveLength(1);
    const claimed = await service(() =>
      db.query<{ claim_notifications: { id: string; subscriptions: { id: string }[] }[] }>(
        "select public.claim_notifications(5)",
      ),
    );
    const subscriptionId = claimed.rows[0]!.claim_notifications[0]!.subscriptions[0]!.id;
    await service(() =>
      db.query("select public.complete_notification($1,'failed',$2)", [
        claimed.rows[0]!.claim_notifications[0]!.id,
        [subscriptionId],
      ]),
    );
    const revoked = await db.query<{ revoked_at: string | null }>(
      "select revoked_at from public.push_subscriptions where id=$1",
      [subscriptionId],
    );
    expect(revoked.rows[0]!.revoked_at).not.toBeNull();
    const reminders = await service(() =>
      db.query<{ enqueue_trade_reminders: number }>("select public.enqueue_trade_reminders()"),
    );
    expect(reminders.rows[0]!.enqueue_trade_reminders).toBe(1);
    expect(
      (
        await service(() =>
          db.query<{ enqueue_trade_reminders: number }>("select public.enqueue_trade_reminders()"),
        )
      ).rows[0]!
        .enqueue_trade_reminders,
    ).toBe(0);
  });
});
