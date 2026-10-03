import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const authBootstrap = `create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key, email text); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$; grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid() to authenticated, service_role;`;
const alice = "00000000-0000-4000-8000-000000000002";
let db: PGlite;

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
  await db.query("insert into auth.users(id, email) values ($1,'a@test.com')", [alice]);
});
afterAll(async () => {
  await db.close();
});

describe("ESPN import", () => {
  it("stores an ESPN connection and does not leave it labeled as Sleeper", async () => {
    const lease = await service(() =>
      db.query<{ begin_espn_sync: { run_id: string } }>(
        "select public.begin_espn_sync($1,'12345','Office',2026)",
        [alice],
      ),
    );
    await service(() =>
      db.query("select public.finish_espn_sync($1,$2,$3::jsonb)", [
        alice,
        lease.rows[0]!.begin_espn_sync.run_id,
        JSON.stringify({
          league: { externalId: "12345", name: "Office", season: 2026, currentWeek: 7 },
          managers: [],
          teams: [
            {
              externalId: "1",
              name: "Alpha",
              wins: 4,
              losses: 2,
              ties: 0,
              pointsFor: 140.5,
              pointsAgainst: 110,
              managers: [],
            },
          ],
          matchups: [],
        }),
      ]),
    );
    const connection = await db.query<{ provider: string }>(
      "select provider from public.league_connections where external_id = '12345'",
    );
    expect(connection.rows[0]!.provider).toBe("espn");
  });
});
