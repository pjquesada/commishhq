import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const authBootstrap = `create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key, email text); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$; grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid() to authenticated, service_role;`;
const alice = "00000000-0000-4000-8000-000000000002";
const bob = "00000000-0000-4000-8000-000000000003";
const hash = "ab".repeat(32);
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
  await db.query("insert into auth.users(id, email) values ($1,'a@test.com'),($2,'b@test.com')", [alice, bob]);
});
afterAll(async () => {
  await db.close();
});

describe("Yahoo credential storage", () => {
  it("hides ciphertext, consumes OAuth state once, and blocks another user from revoking it", async () => {
    await service(() =>
      db.query("select public.store_oauth_state($1,'yahoo',$2)", [alice, hash]),
    );
    const first = await service(() =>
      db.query<{ consume_oauth_state: boolean }>("select public.consume_oauth_state($1,'yahoo',$2)", [
        alice,
        hash,
      ]),
    );
    const second = await service(() =>
      db.query<{ consume_oauth_state: boolean }>("select public.consume_oauth_state($1,'yahoo',$2)", [
        alice,
        hash,
      ]),
    );
    expect(first.rows[0]!.consume_oauth_state).toBe(true);
    expect(second.rows[0]!.consume_oauth_state).toBe(false);
    await service(() =>
      db.query("select public.store_provider_credential($1,'yahoo',$2,$3,1)", [
        alice,
        "ciphertext-value",
        "iv-value-123456",
      ]),
    );
    await expect(as(alice, () => db.query("select ciphertext from public.provider_credentials"))).rejects.toThrow();
    const readable = await service(() =>
      db.query<{ read_provider_credential: { ciphertext: string } }>(
        "select public.read_provider_credential($1,'yahoo')",
        [alice],
      ),
    );
    expect(readable.rows[0]!.read_provider_credential.ciphertext).toBe("ciphertext-value");
    await expect(
      as(bob, () => db.query("select public.revoke_provider_credential($1,'yahoo')", [alice])),
    ).rejects.toThrow(/Authentication required/);
    await as(alice, () => db.query("select public.revoke_provider_credential($1,'yahoo')", [alice]));
    const gone = await service(() =>
      db.query<{ read_provider_credential: { ciphertext: string } | null }>(
        "select public.read_provider_credential($1,'yahoo')",
        [alice],
      ),
    );
    expect(gone.rows[0]!.read_provider_credential).toBeNull();
  });

  it("imports a Yahoo league through the shared snapshot writer and keeps the provider", async () => {
    const lease = await service(() =>
      db.query<{ begin_yahoo_sync: { league_id: string; run_id: string } }>(
        "select public.begin_yahoo_sync($1,'461.l.12345','Office',2026)",
        [alice],
      ),
    );
    const run = lease.rows[0]!.begin_yahoo_sync.run_id;
    await service(() =>
      db.query("select public.finish_yahoo_sync($1,$2,$3::jsonb)", [
        alice,
        run,
        JSON.stringify({
          league: { externalId: "461.l.12345", name: "Office", season: 2026, currentWeek: 7 },
          managers: [],
          teams: [
            {
              externalId: "461.l.12345.t.1",
              name: "Alpha",
              wins: 4,
              losses: 2,
              ties: 0,
              pointsFor: 140.5,
              pointsAgainst: 110,
              managers: [],
            },
          ],
          matchups: [
            {
              id: "bye",
              week: 7,
              status: "final",
              scores: [{ teamId: "461.l.12345.t.1", points: 140.5 }],
            },
          ],
        }),
      ]),
    );
    const connection = await db.query<{ provider: string }>(
      "select provider from public.league_connections where external_id = '461.l.12345'",
    );
    expect(connection.rows[0]!.provider).toBe("yahoo");
    const teams = await db.query("select name from public.teams");
    expect(teams.rows).toEqual([{ name: "Alpha" }]);
  });
});
