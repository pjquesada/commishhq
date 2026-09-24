import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
let db: PGlite;
const authBootstrap=`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key,email text); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`;
const commissioner = "00000000-0000-4000-8000-000000000001",
  alice = "00000000-0000-4000-8000-000000000002",
  bob = "00000000-0000-4000-8000-000000000003",
  outsider = "00000000-0000-4000-8000-000000000004";
const league = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002",
  team = "20000000-0000-4000-8000-000000000001",
  team2 = "20000000-0000-4000-8000-000000000002",
  foreignTeam = "20000000-0000-4000-8000-000000000003";
async function as<T>(user: string, fn: () => Promise<T>) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
async function admin<T>(fn: () => Promise<T>) {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
async function request(user = alice, selected = team) {
  return as(user, async () => {
    const result = await db.query<{ id: string }>(
      "select public.request_team_claim($1,$2) as id",
      [league, selected],
    );
    return result.rows[0]!.id;
  });
}
async function review(id: string, decision = "approved", user = commissioner) {
  return as(user, () =>
    db.query("select public.review_team_claim($1,$2)", [id, decision]),
  );
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(authBootstrap);
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
});
beforeEach(async () => {
  await db.exec(
    "reset role; truncate auth.users,public.profiles,public.leagues cascade",
  );
  for (const [id, email] of [
    [commissioner, "commissioner@test.com"],
    [alice, "alice@test.com"],
    [bob, "bob@test.com"],
    [outsider, "outsider@test.com"],
  ])
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      id,
      email,
    ]);
  await db.query(
    "insert into public.leagues(id,name,season,commissioner_id,last_synced_at,sync_status) values($1,'League',2026,$2,now(),'complete'),($3,'Other',2026,$4,now(),'complete')",
    [league, commissioner, other, outsider],
  );
  await db.query(
    "insert into public.teams(id,league_id,external_id,name) values($1,$2,'1','Team 1'),($3,$2,'2','Team 2'),($4,$5,'1','Foreign')",
    [team, league, team2, foreignTeam, other],
  );
});
afterAll(async () => {
  await db.close();
});
describe("claims and database authority", () => {
  it("enables RLS on every public application table", async () => {
    expect(
      (
        await db.query(
          "select relname from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='public' and relkind='r' and not relrowsecurity",
        )
      ).rows,
    ).toEqual([]);
  });
  it("denies direct authoritative writes and sync RPCs to browser roles", async () => {
    await as(alice, async () => {
      for (const sql of [
        "insert into public.league_members(league_id,user_id,team_id) values($1,$2,$3)",
        "update public.league_members set team_id=$3 where league_id=$1 and user_id=$2",
      ]) {
        await expect(db.query(sql, [league, alice, team])).rejects.toThrow(
          /permission denied/,
        );
      }
      await expect(
        db.query("update public.team_claims set status='approved'"),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query("select public.begin_sleeper_sync($1,'123','League',2026)", [
          alice,
        ]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query("update public.leagues set sync_status='complete'"),
      ).rejects.toThrow(/permission denied/);
    });
  });
  it("pending claims grant zero authoritative membership or league visibility", async () => {
    await request();
    expect(
      (await db.query("select * from public.league_members")).rows,
    ).toHaveLength(0);
    await as(alice, async () => {
      expect((await db.query("select * from public.leagues")).rows).toEqual([]);
      expect((await db.query("select * from public.teams")).rows).toEqual([]);
    });
  });
  it("requester and commissioner can read claims; outsiders cannot", async () => {
    await request();
    for (const [user, count] of [
      [alice, 1],
      [commissioner, 1],
      [bob, 0],
    ] as const) {
      await as(user, async () =>
        expect(
          (await db.query("select * from public.team_claims")).rows,
        ).toHaveLength(count),
      );
    }
  });
  it("claim projection is minimal and requires authentication", async () => {
    await as(alice, async () => {
      const result = await db.query<{ data: Record<string, unknown> }>(
        "select public.claim_options($1) data",
        [league],
      );
      expect(Object.keys(result.rows[0]!.data).sort()).toEqual([
        "id",
        "name",
        "season",
        "teams",
      ]);
    });
    await db.exec("set role anon");
    try {
      await expect(
        db.query("select public.claim_options($1)", [league]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
  });
  it("prevents duplicate active claims even for a different requested team", async () => {
    await request();
    await expect(request(alice, team2)).rejects.toThrow(
      /one_active_claim_per_user/,
    );
  });
  it("rejects forged cross-league team IDs at request and FK level", async () => {
    await expect(request(alice, foreignTeam)).rejects.toThrow(/Invalid team/);
    await expect(
      db.query(
        "insert into public.team_claims(league_id,team_id,requester_id,requester_label) values($1,$2,$3,'x')",
        [league, foreignTeam, alice],
      ),
    ).rejects.toThrow(/foreign key/);
  });
  it("only the current commissioner may approve or reject", async () => {
    const id = await request();
    await expect(review(id, "approved", alice)).rejects.toThrow(
      /Commissioner required/,
    );
    await expect(review(id, "rejected", outsider)).rejects.toThrow(
      /Commissioner required/,
    );
  });
  it("rejects forged reviewer identities rather than accepting an actor parameter", async () => {
    const id = await request();
    await as(alice, async () => {
      await expect(
        db.query("select public.review_team_claim($1,'approved',$2)", [
          id,
          commissioner,
        ]),
      ).rejects.toThrow(/does not exist/);
      await expect(
        db.query("update public.team_claims set reviewer_id=$1 where id=$2", [
          commissioner,
          id,
        ]),
      ).rejects.toThrow(/permission denied/);
    });
  });
  it("approval atomically installs membership with reviewer from auth.uid()", async () => {
    const id = await request();
    await review(id);
    expect(
      (
        await db.query(
          "select league_id,user_id,team_id from public.league_members",
        )
      ).rows,
    ).toEqual([{ league_id: league, user_id: alice, team_id: team }]);
    expect(
      (
        await db.query(
          "select status,reviewer_id from public.team_claims where id=$1",
          [id],
        )
      ).rows[0],
    ).toEqual({ status: "approved", reviewer_id: commissioner });
  });
  it("rejects duplicate approvals", async () => {
    const id = await request();
    await review(id);
    await expect(review(id)).rejects.toThrow(/already reviewed/);
  });
  it("two concurrently submitted approvals cannot both assign the same team", async () => {
    const a = await request(alice),
      b = await request(bob);
    await as(commissioner, async () => {
      const results = await Promise.allSettled([
        db.query("select public.review_team_claim($1,'approved')", [a]),
        db.query("select public.review_team_claim($1,'approved')", [b]),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });
    expect(
      (await db.query("select * from public.league_members")).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          "select * from public.team_claims where status='pending'",
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("one manager cannot acquire two teams, even if an old pending request remains", async () => {
    const id = await request(alice, team2);
    await db.query(
      "insert into public.league_members(league_id,user_id,team_id) values($1,$2,$3)",
      [league, alice, team],
    );
    await expect(review(id)).rejects.toThrow(/Manager already assigned/);
    expect(
      (
        await db.query("select status from public.team_claims where id=$1", [
          id,
        ])
      ).rows[0],
    ).toEqual({ status: "pending" });
  });
  it("rejection and cancellation confer no membership and allow a new request", async () => {
    let id = await request();
    await review(id, "rejected");
    id = await request();
    await as(alice, () =>
      db.query("select public.cancel_team_claim($1)", [id]),
    );
    await request(alice, team2);
    expect(
      (await db.query("select * from public.league_members")).rows,
    ).toHaveLength(0);
  });
  it("cannot cancel someone else’s request or approve an inactive team", async () => {
    const id = await request();
    await as(bob, async () => {
      await expect(
        db.query("select public.cancel_team_claim($1)", [id]),
      ).rejects.toThrow(/not found/);
    });
    await db.query("update public.teams set active=false where id=$1", [team]);
    await expect(review(id)).rejects.toThrow(/no longer active/);
  });
});
const snapshot = {
  league: {
    externalId: "555",
    name: "Imported league",
    season: 2026,
    currentWeek: 7,
  },
  managers: [{ externalId: "111", displayName: "Provider manager" }],
  teams: [
    {
      externalId: "1",
      name: "Imported team",
      wins: 3,
      losses: 2,
      ties: 1,
      pointsFor: 143.52,
      pointsAgainst: 100.01,
      managers: [{ externalId: "111", displayName: "Provider manager" }],
    },
  ],
  matchups: [
    {
      id: "bye-1",
      week: 7,
      status: "live",
      scores: [{ teamId: "1", points: null }],
    },
  ],
};
async function begin(actor = commissioner) {
  return admin(async () => {
    const result = await db.query<{
      lease: { league_id: string; run_id: string };
    }>(
      "select public.begin_sleeper_sync($1,'555','Imported league',2026) lease",
      [actor],
    );
    return result.rows[0]!.lease;
  });
}
describe("transactional synchronization", () => {
  it("preserves first importer ownership and rejects takeover", async () => {
    const lease = await begin();
    await expect(begin(alice)).rejects.toThrow(/Commissioner required/);
    expect(
      (
        await db.query(
          "select commissioner_id from public.leagues where id=$1",
          [lease.league_id],
        )
      ).rows[0],
    ).toEqual({ commissioner_id: commissioner });
  });
  it("imports normalized snapshot and resyncs without duplicates", async () => {
    const a = await begin();
    await admin(() =>
      db.query("select public.finish_sleeper_sync($1,$2,$3)", [
        commissioner,
        a.run_id,
        JSON.stringify(snapshot),
      ]),
    );
    const first = (
      await db.query<{ id: string }>(
        "select id from public.teams where league_id=$1",
        [a.league_id],
      )
    ).rows[0]!.id;
    await db.query(
      "update public.sync_runs set started_at=now()-interval '40 seconds' where id=$1",
      [a.run_id],
    );
    const b = await begin();
    await admin(() =>
      db.query("select public.finish_sleeper_sync($1,$2,$3)", [
        commissioner,
        b.run_id,
        JSON.stringify({
          ...snapshot,
          teams: [{ ...snapshot.teams[0], pointsFor: 200.99 }],
        }),
      ]),
    );
    expect(a.league_id).toBe(b.league_id);
    expect(
      (
        await db.query(
          "select id,points_for from public.teams where league_id=$1",
          [a.league_id],
        )
      ).rows,
    ).toEqual([{ id: first, points_for: "200.99" }]);
    expect(
      (
        await db.query("select * from public.matchups where league_id=$1", [
          a.league_id,
        ])
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          "select * from public.provider_managers where league_id=$1",
          [a.league_id],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("rolls back invalid snapshots and records failure without partial data", async () => {
    const a = await begin();
    await expect(
      admin(() =>
        db.query("select public.finish_sleeper_sync($1,$2,$3)", [
          commissioner,
          a.run_id,
          JSON.stringify({
            ...snapshot,
            teams: [{ ...snapshot.teams[0], wins: -1 }],
          }),
        ]),
      ),
    ).rejects.toThrow();
    expect(
      (
        await db.query("select * from public.teams where league_id=$1", [
          a.league_id,
        ])
      ).rows,
    ).toHaveLength(0);
    await admin(() =>
      db.query("select public.fail_sleeper_sync($1,$2,'persistence')", [
        commissioner,
        a.run_id,
      ]),
    );
    expect(
      (
        await db.query(
          "select sync_status,last_synced_at from public.leagues where id=$1",
          [a.league_id],
        )
      ).rows[0],
    ).toEqual({ sync_status: "failed", last_synced_at: null });
  });
  it("rejects overlapping sync and stale lease finalization", async () => {
    const a = await begin();
    await expect(begin()).rejects.toThrow(/wait|running/);
    await db.query(
      "update public.sync_runs set started_at=now()-interval '3 minutes' where id=$1",
      [a.run_id],
    );
    const b = await begin();
    await expect(
      admin(() =>
        db.query("select public.finish_sleeper_sync($1,$2,$3)", [
          commissioner,
          a.run_id,
          JSON.stringify(snapshot),
        ]),
      ),
    ).rejects.toThrow(/expired/);
    await admin(() =>
      db.query("select public.fail_sleeper_sync($1,$2,'provider')", [
        commissioner,
        a.run_id,
      ]),
    );
    expect(
      (
        await db.query("select sync_status from public.leagues where id=$1", [
          b.league_id,
        ])
      ).rows[0],
    ).toEqual({ sync_status: "syncing" });
  });
});

it('upgrades the already-published Phase 2 schema without losing approved identities or imported records', async () => {
  const legacy = new PGlite();
  try {
    await legacy.exec(authBootstrap);
    for(const file of ['20260923195759_foundation.sql','20260923224500_phase2_sleeper.sql']) await legacy.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
    await legacy.query("insert into auth.users(id,email) values($1,'owner@test.com'),($2,'manager@test.com')",[commissioner,alice]);
    await legacy.query("insert into public.leagues(id,name,season,commissioner_id,current_week,sync_status,last_synced_at) values($1,'Existing',2026,$2,0,'syncing',now())",[league,commissioner]);
    await legacy.query("insert into public.teams(id,league_id,external_id,name,points_for) values($1,$2,'1','Existing team',143.52)",[team,league]);
    await legacy.query("insert into public.provider_league_members(league_id,provider_user_id,display_name,team_id) values($1,'123','Existing Sleeper manager',$2)",[league,team]);
    await legacy.query("insert into public.matchups(league_id,week,provider_matchup_id,team_id,points,status) values($1,7,'1',$2,100.05,'live')",[league,team]);
    await legacy.query("insert into public.team_claims(league_id,team_id,user_id,status,reviewed_at,reviewed_by) values($1,$2,$3,'approved',now(),$4)",[league,team,alice,commissioner]);
    await legacy.query('insert into public.league_members(league_id,user_id,team_id) values($1,$2,$3)',[league,alice,team]);
    await legacy.query("insert into public.sync_runs(league_id,provider,external_id,status) values($1,'sleeper','555','running')",[league]);
    await legacy.exec(readFileSync('supabase/migrations/20260923235640_sleeper_import_claims.sql','utf8'));
    expect((await legacy.query('select user_id,team_id from public.league_members')).rows).toEqual([{user_id:alice,team_id:team}]);
    expect((await legacy.query('select requester_id,requester_label,status,reviewer_id from public.team_claims')).rows).toEqual([{requester_id:alice,requester_label:'manager@test.com',status:'approved',reviewer_id:commissioner}]);
    expect((await legacy.query('select external_id,display_name from public.provider_managers')).rows).toEqual([{external_id:'123',display_name:'Existing Sleeper manager'}]);
    expect((await legacy.query('select team_id,manager_external_id from public.team_provider_managers')).rows).toEqual([{team_id:team,manager_external_id:'123'}]);
    expect((await legacy.query('select team_score from public.matchups')).rows).toEqual([{team_score:'100.05'}]);
    expect((await legacy.query('select status,actor_id from public.sync_runs')).rows).toEqual([{status:'failed',actor_id:commissioner}]);
    expect((await legacy.query('select current_week,sync_status from public.leagues')).rows).toEqual([{current_week:null,sync_status:'failed'}]);
    await expect(legacy.query("select public.review_team_claim(gen_random_uuid(),gen_random_uuid(),'approved')")).rejects.toThrow(/does not exist/);
  } finally {await legacy.close();}
});
