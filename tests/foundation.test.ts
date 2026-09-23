import { describe, expect, it } from "vitest";
import { credentialsSchema, safeNext } from "@/lib/auth/validation";
import { leagueSchema, teamSchema, matchupSchema } from "@/lib/fantasy/types";
import { publicEnvSchema } from "@/lib/env";
import manifest from "@/app/manifest";
describe("authentication input boundaries", () => {
  it.each([
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/\nevil",
    "javascript:alert(1)",
  ])("rejects unsafe redirect %s", (value) =>
    expect(safeNext(value)).toBe("/"),
  );
  it("allows local deep links", () =>
    expect(safeNext("/trades?view=open")).toBe("/trades?view=open"));
  it("rejects invalid credentials and oversized input", () => {
    expect(
      credentialsSchema.safeParse({ email: "nope", password: "short" }).success,
    ).toBe(false);
    expect(
      credentialsSchema.safeParse({
        email: "a@b.com",
        password: "x".repeat(129),
      }).success,
    ).toBe(false);
    expect(
      credentialsSchema.safeParse({
        email: "a@b.com",
        password: "long enough password",
      }).success,
    ).toBe(true);
  });
  it("requires real connection configuration", () => {
    expect(
      publicEnvSchema.safeParse({ url: "javascript:alert(1)", key: "key" })
        .success,
    ).toBe(false);
    expect(
      publicEnvSchema.safeParse({ url: "https://example.supabase.co", key: "" })
        .success,
    ).toBe(false);
  });
});
describe("normalized provider contracts", () => {
  it("rejects unknown providers and impossible seasons", () => {
    expect(
      leagueSchema.safeParse({
        id: "1",
        externalId: "2",
        provider: "sleeper",
        name: "League",
        season: 2026,
        currentWeek: null,
      }).success,
    ).toBe(true);
    expect(
      leagueSchema.safeParse({
        id: "1",
        externalId: "2",
        provider: "other",
        name: "League",
        season: 999,
        currentWeek: 30,
      }).success,
    ).toBe(false);
  });
  it("does not accept unnormalized team payloads", () =>
    expect(teamSchema.safeParse({ roster_id: 1, owner_id: "2" }).success).toBe(
      false,
    ));
  it("permits unknown scores without inventing zeroes", () =>
    expect(
      matchupSchema.parse({
        id: "1",
        leagueId: "2",
        week: 1,
        status: "scheduled",
        scores: [{ teamId: "3", points: null }],
      }).scores[0]?.points,
    ).toBe(null));
});
it("provides installable manifest essentials", () => {
  const result = manifest();
  expect(result.display).toBe("standalone");
  expect(result.start_url).toBe("/");
  expect(
    result.icons?.some(
      (icon) => icon.sizes === "512x512" && icon.purpose === "maskable",
    ),
  ).toBe(true);
});
