import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
let db: PGlite;
const alice = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
const outsider = "00000000-0000-4000-8000-000000000003";
const leagueA = "10000000-0000-4000-8000-000000000001";
const leagueB = "10000000-0000-4000-8000-000000000002";
const teamA = "20000000-0000-4000-8000-000000000001";
const teamA2 = "20000000-0000-4000-8000-000000000002";
const teamB = "20000000-0000-4000-8000-000000000003";
async function asUser<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
    user,
  ]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
beforeAll(async () => {
  db = new PGlite();
  // Only Supabase's auth schema/roles are simulated. All application SQL runs unchanged in Postgres.
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;`);
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id) values ($1),($2),($3)", [
    alice,
    bob,
    outsider,
  ]);
  await db.query(
    "insert into public.leagues(id,name,season,commissioner_id) values ($1,'A',2026,$2),($3,'B',2026,$4)",
    [leagueA, alice, leagueB, bob],
  );
  await db.query(
    "insert into public.teams(id,league_id,external_id,name) values ($1,$2,'1','A1'),($3,$2,'2','A2'),($4,$5,'1','B1')",
    [teamA, leagueA, teamA2, teamB, leagueB],
  );
  await db.query(
    "insert into public.league_members(league_id,user_id,team_id) values ($1,$2,$3),($4,$5,$6)",
    [leagueA, alice, teamA, leagueB, bob, teamB],
  );
});
afterAll(async () => {
  await db?.close();
});
describe("database authorization", () => {
  it("creates private profiles through the auth trigger", async () => {
    const result = await asUser(alice, () =>
      db.query("select id from public.profiles"),
    );
    expect(result.rows).toEqual([{ id: alice }]);
  });
  it("isolates leagues, teams, and memberships", async () => {
    await asUser(alice, async () => {
      expect((await db.query("select id from public.leagues")).rows).toEqual([
        { id: leagueA },
      ]);
      expect((await db.query("select id from public.teams")).rows).toHaveLength(
        2,
      );
      expect(
        (await db.query("select user_id from public.league_members")).rows,
      ).toEqual([{ user_id: alice }]);
    });
  });
  it("hides all league data from nonmembers", async () => {
    await asUser(outsider, async () => {
      expect((await db.query("select * from public.leagues")).rows).toEqual([]);
      expect((await db.query("select * from public.teams")).rows).toEqual([]);
    });
  });
  it("blocks unauthenticated access", async () => {
    await db.exec("set role anon");
    try {
      await expect(db.query("select * from public.leagues")).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await db.exec("reset role");
    }
  });
  it("prevents self-assigned membership and commissioner escalation", async () => {
    await asUser(outsider, async () => {
      await expect(
        db.query(
          "insert into public.league_members(league_id,user_id) values ($1,$2)",
          [leagueA, outsider],
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query("update public.leagues set commissioner_id=$1 where id=$2", [
          outsider,
          leagueA,
        ]),
      ).rejects.toThrow(/permission denied/);
    });
  });
  it("allows only own display name edits and blocks identity reassignment", async () => {
    await asUser(alice, async () => {
      await db.query(
        "update public.profiles set display_name='Alice' where id=$1",
        [alice],
      );
      expect(
        (
          await db.query(
            "update public.profiles set display_name='Tampered' where id=$1 returning id",
            [bob],
          )
        ).rows,
      ).toEqual([]);
      await expect(
        db.query("update public.profiles set id=$1 where id=$2", [
          outsider,
          alice,
        ]),
      ).rejects.toThrow(/permission denied/);
    });
  });
  it("rejects a fabricated team from another league even for privileged writers", async () => {
    await expect(
      db.query(
        "insert into public.league_members(league_id,user_id,team_id) values ($1,$2,$3)",
        [leagueA, outsider, teamB],
      ),
    ).rejects.toThrow(/foreign key/);
  });
  it("enforces one team per manager and one manager per team", async () => {
    await expect(
      db.query(
        "insert into public.league_members(league_id,user_id,team_id) values ($1,$2,$3)",
        [leagueA, alice, teamA2],
      ),
    ).rejects.toThrow(/unique/);
    await expect(
      db.query(
        "insert into public.league_members(league_id,user_id,team_id) values ($1,$2,$3)",
        [leagueA, outsider, teamA],
      ),
    ).rejects.toThrow(/unique/);
  });
  it("denies commissioner membership tampering too", async () => {
    await asUser(alice, async () => {
      await expect(
        db.query(
          "update public.league_members set team_id=$1 where league_id=$2",
          [teamA2, leagueA],
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
