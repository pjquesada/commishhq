import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let db: PGlite;

const commissioner = "00000000-0000-4000-8000-000000000011";
const managerA = "00000000-0000-4000-8000-000000000012";
const managerB = "00000000-0000-4000-8000-000000000013";
const outsider = "00000000-0000-4000-8000-000000000014";
const league = "10000000-0000-4000-8000-000000000011";
const teamOne = "20000000-0000-4000-8000-000000000011";
const teamTwo = "20000000-0000-4000-8000-000000000012";

async function asUser<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;`);

  for (const file of readdirSync("supabase/migrations")
    .filter((entry) => entry.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  }

  await db.query("insert into auth.users values ($1),($2),($3),($4)", [
    commissioner,
    managerA,
    managerB,
    outsider,
  ]);
  await db.query(
    "insert into public.leagues(id,name,season,commissioner_id,total_teams,sync_status) values ($1,'Phase 2',2026,$2,2,'complete')",
    [league, commissioner],
  );
  await db.query(
    "insert into public.teams(id,league_id,external_id,name) values ($1,$2,'1','One'),($3,$2,'2','Two')",
    [teamOne, league, teamTwo],
  );
});

beforeEach(async () => {
  await db.query("delete from public.team_claims where league_id=$1", [league]);
  await db.query(
    "delete from public.league_members where league_id=$1 and user_id <> $2",
    [league, commissioner],
  );
});

afterAll(async () => {
  await db?.close();
});

describe("Phase 2 team claim security", () => {
  it("does not grant direct browser writes to claim or membership tables", async () => {
    await asUser(managerA, async () => {
      await expect(
        db.query(
          "insert into public.team_claims(league_id,team_id,user_id) values ($1,$2,$3)",
          [league, teamOne, managerA],
        ),
      ).rejects.toThrow(/permission denied/);

      await expect(
        db.query(
          "insert into public.league_members(league_id,user_id,team_id) values ($1,$2,$3)",
          [league, managerA, teamOne],
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("lets a requester and commissioner read a pending claim without exposing it to outsiders", async () => {
    await db.query(
      "insert into public.team_claims(league_id,team_id,user_id) values ($1,$2,$3)",
      [league, teamOne, managerA],
    );

    await asUser(managerA, async () => {
      expect(
        (await db.query("select team_id from public.team_claims")).rows,
      ).toEqual([{ team_id: teamOne }]);
    });

    await asUser(commissioner, async () => {
      expect(
        (await db.query("select team_id from public.team_claims")).rows,
      ).toEqual([{ team_id: teamOne }]);
    });

    await asUser(outsider, async () => {
      expect((await db.query("select * from public.team_claims")).rows).toEqual(
        [],
      );
    });
  });

  it("enforces only one active claim per manager per league", async () => {
    await db.query(
      "insert into public.team_claims(league_id,team_id,user_id) values ($1,$2,$3)",
      [league, teamOne, managerA],
    );
    await expect(
      db.query(
        "insert into public.team_claims(league_id,team_id,user_id) values ($1,$2,$3)",
        [league, teamTwo, managerA],
      ),
    ).rejects.toThrow(/unique/);
  });

  it("does not expose the atomic review RPC to normal authenticated users", async () => {
    const result = await db.query<{ id: string }>(
      "insert into public.team_claims(league_id,team_id,user_id) values ($1,$2,$3) returning id",
      [league, teamOne, managerA],
    );
    const claimId = result.rows[0]?.id;

    await asUser(commissioner, async () => {
      await expect(
        db.query(
          "select public.review_team_claim($1,$2,'approved')",
          [claimId, commissioner],
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("atomically approves a claim and creates the authoritative membership", async () => {
    const result = await db.query<{ id: string }>(
      "insert into public.team_claims(league_id,team_id,user_id) values ($1,$2,$3) returning id",
      [league, teamOne, managerA],
    );
    const claimId = result.rows[0]?.id;

    await asService(() =>
      db.query("select public.review_team_claim($1,$2,'approved')", [
        claimId,
        commissioner,
      ]),
    );

    expect(
      (
        await db.query(
          "select team_id from public.league_members where league_id=$1 and user_id=$2",
          [league, managerA],
        )
      ).rows,
    ).toEqual([{ team_id: teamOne }]);
    expect(
      (
        await db.query("select status from public.team_claims where id=$1", [
          claimId,
        ])
      ).rows,
    ).toEqual([{ status: "approved" }]);
  });

  it("rejects a forged reviewer identity even through the server-only RPC", async () => {
    const result = await db.query<{ id: string }>(
      "insert into public.team_claims(league_id,team_id,user_id) values ($1,$2,$3) returning id",
      [league, teamOne, managerA],
    );
    const claimId = result.rows[0]?.id;

    await expect(
      asService(() =>
        db.query("select public.review_team_claim($1,$2,'approved')", [
          claimId,
          outsider,
        ]),
      ),
    ).rejects.toThrow(/not authorized/);
  });

  it("cannot approve two managers for the same team", async () => {
    const first = await db.query<{ id: string }>(
      "insert into public.team_claims(league_id,team_id,user_id) values ($1,$2,$3) returning id",
      [league, teamTwo, managerA],
    );
    const second = await db.query<{ id: string }>(
      "insert into public.team_claims(league_id,team_id,user_id) values ($1,$2,$3) returning id",
      [league, teamTwo, managerB],
    );

    await asService(() =>
      db.query("select public.review_team_claim($1,$2,'approved')", [
        first.rows[0]?.id,
        commissioner,
      ]),
    );

    await expect(
      asService(() =>
        db.query("select public.review_team_claim($1,$2,'approved')", [
          second.rows[0]?.id,
          commissioner,
        ]),
      ),
    ).rejects.toThrow(/no longer pending/);

    expect(
      (
        await db.query(
          "select user_id from public.league_members where league_id=$1 and team_id=$2",
          [league, teamTwo],
        )
      ).rows,
    ).toEqual([{ user_id: managerA }]);
  });
});
