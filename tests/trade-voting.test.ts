import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";

const authBootstrap = `create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key, email text); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$; grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid() to authenticated, service_role;`;
const commissioner = "00000000-0000-4000-8000-000000000001";
const alice = "00000000-0000-4000-8000-000000000002";
const bob = "00000000-0000-4000-8000-000000000003";
const carol = "00000000-0000-4000-8000-000000000004";
const outsider = "00000000-0000-4000-8000-000000000005";
const league = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const traders = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
];
const voters = [
  "20000000-0000-4000-8000-000000000003",
  "20000000-0000-4000-8000-000000000004",
];
const foreignTeam = "20000000-0000-4000-8000-000000000005";

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

function payload(extra: Record<string, unknown> = {}) {
  return {
    league_id: league,
    privacy_mode: "anonymous",
    participants_may_vote: false,
    closes_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    sides: [
      {
        team_id: traders[0],
        assets: [{ type: "player", label: "Jahmyr Gibbs" }],
      },
      {
        team_id: traders[1],
        assets: [
          { type: "player", label: "Malik Nabers" },
          { type: "draft_pick", label: "2027 2nd" },
        ],
      },
    ],
    eligible_team_ids: voters,
    ...extra,
  };
}

async function publish(user = commissioner, body = payload()) {
  const result = await as(user, () =>
    db.query<{ publish_trade_vote: string }>(
      "select public.publish_trade_vote($1::jsonb)",
      [JSON.stringify(body)],
    ),
  );
  return result.rows[0]!.publish_trade_vote;
}

async function cast(user: string, vote: string, choice = "approve") {
  const result = await as(user, () =>
    db.query<{ cast_trade_ballot: string }>(
      "select public.cast_trade_ballot($1,$2)",
      [vote, choice],
    ),
  );
  return result.rows[0]!.cast_trade_ballot;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(authBootstrap);
  for (const file of readdirSync("supabase/migrations")
    .filter((file) => file.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
});

beforeEach(async () => {
  await db.exec(
    "reset role; truncate auth.users, public.profiles, public.leagues, private.rate_buckets cascade",
  );
  for (const [id, email] of [
    [commissioner, "commissioner@test.com"],
    [alice, "alice@test.com"],
    [bob, "bob@test.com"],
    [carol, "carol@test.com"],
    [outsider, "outsider@test.com"],
  ])
    await db.query("insert into auth.users(id, email) values ($1,$2)", [id, email]);
  await db.query(
    "insert into public.leagues(id, name, season, commissioner_id, last_synced_at, sync_status) values ($1,'League',2026,$2,now(),'complete'),($3,'Other',2026,$4,now(),'complete')",
    [league, commissioner, other, outsider],
  );
  await db.query(
    "insert into public.teams(id, league_id, external_id, name) values ($1,$2,'1','Alpha'),($3,$2,'2','Bravo'),($4,$2,'3','Alice FC'),($5,$2,'4','Carol FC'),($6,$7,'9','Foreign')",
    [traders[0], league, traders[1], voters[0], voters[1], foreignTeam, other],
  );
  await db.query(
    "insert into public.league_members(league_id, user_id, team_id) values ($1,$2,$3),($1,$4,$5),($1,$6,$7)",
    [league, bob, traders[1], alice, voters[0], carol, voters[1]],
  );
});

afterAll(async () => {
  await db.close();
});

describe("secure trade voting", () => {
  it("lets an eligible manager cast one anonymous ballot and returns a receipt", async () => {
    const vote = await publish();
    const receipt = await cast(alice, vote, "veto");
    expect(receipt).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    const progress = await as(commissioner, () =>
      db.query<{ trade_vote_progress: { votes_cast: number; eligible_count: number } }>(
        "select public.trade_vote_progress($1)",
        [vote],
      ),
    );
    expect(progress.rows[0]!.trade_vote_progress).toMatchObject({
      votes_cast: 1,
      eligible_count: 2,
      status: "open",
      outcome: null,
    });
    const stored = await db.query<{ receipt_hash: string }>(
      "select receipt_hash from public.anonymous_trade_ballots where vote_id=$1",
      [vote],
    );
    expect(stored.rows[0]!.receipt_hash).not.toBe(receipt);
    const columns = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema='public' and table_name='anonymous_trade_ballots'",
    );
    expect(columns.rows.map((row) => row.column_name)).not.toContain("team_id");
  });

  it("rejects ineligible traders, outsiders, forged ids, and a second ballot", async () => {
    const vote = await publish();
    await expect(cast(bob, vote)).rejects.toThrow(/Not eligible/);
    await expect(cast(outsider, vote)).rejects.toThrow(/Vote not found/);
    await expect(cast(commissioner, vote)).rejects.toThrow(/Not eligible/);
    await expect(
      cast(alice, "30000000-0000-4000-8000-000000000099"),
    ).rejects.toThrow(/Vote not found/);
    await cast(alice, vote);
    await expect(cast(alice, vote, "veto")).rejects.toThrow(/Already voted/);
    await expect(
      publish(outsider),
    ).rejects.toThrow(/Commissioner required/);
    await expect(
      publish(commissioner, payload({ eligible_team_ids: [foreignTeam] })),
    ).rejects.toThrow(/Invalid trade/);
    await expect(
      publish(
        commissioner,
        payload({
          sides: [
            { team_id: foreignTeam, assets: [{ type: "player", label: "Nope" }] },
            {
              team_id: traders[0],
              assets: [{ type: "custom", label: "Also nope" }],
            },
          ],
        }),
      ),
    ).rejects.toThrow(/Invalid trade/);
  });

  it("rejects a concurrent duplicate submission", async () => {
    const vote = await publish();
    const results = await Promise.allSettled([
      cast(alice, vote, "approve"),
      cast(alice, vote, "veto"),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const ballots = await db.query(
      "select choice from public.anonymous_trade_ballots where vote_id=$1",
      [vote],
    );
    expect(ballots.rows).toHaveLength(1);
  });

  it("hides live totals from members and the commissioner", async () => {
    const vote = await publish();
    await cast(alice, vote, "veto");
    await as(commissioner, async () => {
      await expect(
        db.query("select choice from public.anonymous_trade_ballots"),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query("select has_voted from public.trade_vote_eligibility"),
      ).rejects.toThrow(/permission denied/);
      await expect(db.query("select public.trade_vote_results($1)", [vote])).rejects.toThrow(
        /Results are hidden/,
      );
      const visible = await db.query<{ approve_count: number | null }>(
        "select approve_count, veto_count from public.trade_votes where id=$1",
        [vote],
      );
      expect(visible.rows[0]).toEqual({ approve_count: null, veto_count: null });
    });
    await as(alice, async () => {
      await expect(
        db.query("insert into public.anonymous_trade_ballots(vote_id, choice, receipt_hash) values ($1,'approve', md5('x'))", [
          vote,
        ]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("freezes privacy and closes a veto correctly", async () => {
    const vote = await publish(commissioner, payload({ required_veto_votes: 1 }));
    await expect(
      db.query(
        "update public.trade_votes set privacy_mode='commissioner_may_reveal_after_close' where id=$1",
        [vote],
      ),
    ).rejects.toThrow(/Vote rules are frozen/);
    await cast(alice, vote, "veto");
    await db.exec("alter table public.trade_votes disable trigger freeze_trade_vote");
    await db.query(
      "update public.trade_votes set opens_at=clock_timestamp()-interval '2 hours', closes_at=clock_timestamp()-interval '1 minute' where id=$1",
      [vote],
    );
    await db.exec("alter table public.trade_votes enable trigger freeze_trade_vote");
    await expect(cast(carol, vote, "approve")).rejects.toThrow(/Voting is closed/);
    const progress = await as(alice, () =>
      db.query<{ progress: { status: string; outcome: string } }>(
        "select public.trade_vote_progress($1) as progress",
        [vote],
      ),
    );
    expect(progress.rows[0]!.progress).toMatchObject({ status: "closed", outcome: "vetoed" });
    const results = await as(commissioner, () =>
      db.query<{ results: { outcome: string; approve_count: number; veto_count: number; identities: null } }>(
        "select public.trade_vote_results($1) as results",
        [vote],
      ),
    );
    expect(results.rows[0]!.results).toMatchObject({
      outcome: "vetoed",
      approve_count: 0,
      veto_count: 1,
      identities: null,
    });
    await expect(
      db.query("update public.anonymous_trade_ballots set choice='approve'"),
    ).rejects.toThrow(/Ballots cannot be edited/);
  });

  it("keeps revealable identities hidden until the commissioner publishes them", async () => {
    const vote = await publish(
      commissioner,
      payload({ privacy_mode: "commissioner_may_reveal_after_close", required_veto_votes: 2 }),
    );
    await cast(alice, vote, "approve");
    await cast(carol, vote, "veto");
    await as(commissioner, async () => {
      await expect(
        db.query("select team_id, choice from public.revealable_trade_ballots"),
      ).rejects.toThrow(/permission denied/);
    });
    await db.exec("alter table public.trade_votes disable trigger freeze_trade_vote");
    await db.query(
      "update public.trade_votes set opens_at=clock_timestamp()-interval '2 hours', closes_at=clock_timestamp()-interval '1 minute' where id=$1",
      [vote],
    );
    await db.exec("alter table public.trade_votes enable trigger freeze_trade_vote");
    const hidden = await as(commissioner, () =>
      db.query<{ results: { outcome: string; approve_count: number; veto_count: number; identities: null } }>(
        "select public.trade_vote_results($1) as results",
        [vote],
      ),
    );
    expect(hidden.rows[0]!.results).toMatchObject({
      outcome: "approved",
      approve_count: 1,
      veto_count: 1,
      identities: null,
    });
    await expect(as(alice, () => db.query("select public.publish_vote_identities($1)", [vote]))).rejects.toThrow(
      /Commissioner required/,
    );
    await as(commissioner, () => db.query("select public.publish_vote_identities($1)", [vote]));
    const revealed = await as(carol, () =>
      db.query<{ results: { identities: { team_id: string; choice: string }[] } }>(
        "select public.trade_vote_results($1) as results",
        [vote],
      ),
    );
    expect(revealed.rows[0]!.results.identities).toEqual([
      { team_id: voters[0], choice: "approve" },
      { team_id: voters[1], choice: "veto" },
    ]);
  });

  it("cancels an open vote without deleting its audit history", async () => {
    const vote = await publish();
    await cast(alice, vote);
    await as(commissioner, () => db.query("select public.cancel_trade_vote($1)", [vote]));
    await expect(cast(carol, vote)).rejects.toThrow(/Voting is closed/);
    const events = await db.query<{ event: string }>(
      "select event from public.trade_vote_events where vote_id=$1 order by created_at",
      [vote],
    );
    expect(events.rows.map((row) => row.event)).toEqual([
      "vote_created",
      "vote_opened",
      "ballot_cast",
      "vote_cancelled",
    ]);
    await expect(
      db.query("delete from public.trade_vote_events where vote_id=$1", [vote]),
    ).rejects.toThrow(/Audit history cannot be changed/);
  });

  it("blocks cross-league reads and direct writes", async () => {
    const vote = await publish();
    await as(outsider, async () => {
      expect((await db.query("select id from public.trade_votes")).rows).toEqual([]);
      await expect(db.query("select public.trade_vote_progress($1)", [vote])).rejects.toThrow(
        /Vote not found/,
      );
    });
    await expect(
      as(alice, () =>
        db.query(
          "insert into public.trade_votes(league_id, commissioner_id, status, privacy_mode, participants_may_vote, required_veto_votes, opens_at, closes_at) values ($1,$2,'open','anonymous',false,1,now(),now()+interval '1 day')",
          [league, alice],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("defaults the veto threshold and allows configured participants to vote", async () => {
    const vote = await publish(commissioner, payload({ required_veto_votes: undefined }));
    const stored = await db.query<{ required_veto_votes: number }>(
      "select required_veto_votes from public.trade_votes where id=$1",
      [vote],
    );
    expect(stored.rows[0]!.required_veto_votes).toBe(1);
    const included = await publish(
      commissioner,
      payload({
        participants_may_vote: true,
        eligible_team_ids: [...voters, traders[1]],
        required_veto_votes: 2,
      }),
    );
    await cast(bob, included, "veto");
    const progress = await as(bob, () =>
      db.query<{ progress: { votes_cast: number; eligible_count: number; viewer_has_voted: boolean } }>(
        "select public.trade_vote_progress($1) as progress",
        [included],
      ),
    );
    expect(progress.rows[0]!.progress).toMatchObject({
      votes_cast: 1,
      eligible_count: 3,
      viewer_has_voted: true,
    });
  });
});
