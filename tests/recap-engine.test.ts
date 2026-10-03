import { describe, expect, it } from "vitest";
import { benchSummary } from "../src/lib/fantasy/bench";
import { detectStories, type CurrentSide, type PriorGame } from "../src/lib/recaps/facts";
import { draftRecap, usesBannedVoice } from "../src/lib/recaps/draft";
import { acceptPolish, maybePolish } from "../src/lib/recaps/polish";
import { recapWindowOpen, tuesdayNineUtc, weekIsFinal } from "../src/lib/recaps/schedule";
import type { ToneSettings } from "../src/lib/recaps/vocabulary";

const clean: ToneSettings = {
  trashTalk: "normal",
  profanity: "clean",
  adultHumor: false,
  memeLevel: "medium",
  length: "normal",
};

function side(
  teamId: string,
  name: string,
  opponentId: string,
  opponentName: string,
  points: number,
  opponentPoints: number,
  extra: Partial<CurrentSide> = {},
): CurrentSide {
  return { teamId, name, opponentId, opponentName, points, opponentPoints, ...extra };
}

describe("weekly recap engine", () => {
  it("detects blowouts, close games, and the high and low scores", () => {
    const facts = detectStories(7, [
      side("a", "Alpha", "b", "Bravo", 148.7, 100),
      side("b", "Bravo", "a", "Alpha", 100, 148.7),
      side("c", "Charlie", "d", "Delta", 110.2, 109.8),
      side("d", "Delta", "c", "Charlie", 109.8, 110.2),
    ], []);
    const alpha = facts.teams.find((team) => team.teamId === "a");
    const delta = facts.teams.find((team) => team.teamId === "d");
    expect(alpha?.tags).toEqual(expect.arrayContaining(["HIGHEST_SCORE", "BLOWOUT_WIN"]));
    expect(facts.teams.find((team) => team.teamId === "b")?.tags).toContain("LOWEST_SCORE");
    expect(delta?.tags).toEqual(expect.arrayContaining(["NAILBITER", "CLOSE_LOSS"]));
    expect(facts.teams.every((team) => !team.tags.includes("PLAYOFF_CLINCH"))).toBe(true);
  });

  it("counts streaks, median wins and losses, and a bench that could have flipped the game", () => {
    const prior: PriorGame[] = [6, 5].flatMap((week) => [
      { teamId: "a", week, points: 120, opponentPoints: 90 },
      { teamId: "b", week, points: 90, opponentPoints: 120 },
    ]);
    const facts = detectStories(7, [
      side("a", "Alpha", "b", "Bravo", 130, 80),
      side("b", "Bravo", "a", "Alpha", 80, 130, { benchPoints: 60, benchWouldFlip: true }),
    ], prior);
    expect(facts.teams.find((team) => team.teamId === "a")?.tags).toContain("WIN_STREAK");
    expect(facts.teams.find((team) => team.teamId === "b")?.tags).toEqual(
      expect.arrayContaining(["LOSS_STREAK", "BENCH_DISASTER", "LOWEST_SCORE"]),
    );
    const median = detectStories(3, [
      side("a", "Alpha", "b", "Bravo", 80, 70),
      side("b", "Bravo", "a", "Alpha", 70, 80),
      side("c", "Charlie", "d", "Delta", 140, 100),
      side("d", "Delta", "c", "Charlie", 100, 140),
    ], []);
    expect(median.teams.find((team) => team.teamId === "a")?.tags).toContain("BELOW_MEDIAN_WIN");
    expect(median.teams.find((team) => team.teamId === "d")?.tags).toContain("ABOVE_MEDIAN_LOSS");
  });

  it("keeps profanity, meme level, and phrase families inside the league settings", () => {
    const game = [
      side("a", "Alpha", "b", "Bravo", 140, 90),
      side("b", "Bravo", "a", "Alpha", 90, 140),
    ];
    const polite = draftRecap(4, game, [], { ...clean, trashTalk: "light", memeLevel: "low", profanity: "clean" }, []);
    expect(polite.body).not.toMatch(/\b(ass|shit|fuck)/i);
    expect(usesBannedVoice(polite.body)).toBe(false);
    expect(polite.body).not.toMatch(/injury|projection|monday night/i);
    const savage = draftRecap(4, game, [], { ...clean, trashTalk: "savage", profanity: "uncensored", memeLevel: "brainrot" }, []);
    const families = new Set(savage.vocabulary.map((phrase) => phrase.family));
    expect(families.size).toBe(savage.vocabulary.length);
    const cooled = draftRecap(
      6,
      [side("a", "Alpha", "b", "Bravo", 101, 100), side("b", "Bravo", "a", "Alpha", 100, 101)],
      [],
      { ...clean, memeLevel: "brainrot" },
      [{ vocabularyId: "plot-armor", family: "luck", week: 5 }],
    );
    expect(cooled.body.toLowerCase()).not.toContain("plot armor");
    expect(cooled.vocabulary.every((phrase) => phrase.family !== "luck")).toBe(true);
  });

  it("falls back when AI invents a number or fails", async () => {
    const draft = "Alpha beat Bravo 140–90.";
    expect(acceptPolish(draft, "Alpha scored 999.4 and Bravo was hurt.", { points: [140, 90] })).toBe(draft);
    await expect(maybePolish(draft, { points: [140, 90] }, clean, async () => {
      throw new Error("429");
    })).resolves.toBe(draft);
    await expect(maybePolish(draft, { points: [140, 90] }, clean, async () => null)).resolves.toBe(draft);
  });

  it("opens the Tuesday window at 9:00 local time through daylight saving", () => {
    expect(tuesdayNineUtc(2026, 1, 6, "America/New_York").toISOString()).toBe("2026-01-06T14:00:00.000Z");
    expect(tuesdayNineUtc(2026, 3, 10, "America/New_York").toISOString()).toBe("2026-03-10T13:00:00.000Z");
    expect(recapWindowOpen(new Date("2026-01-06T13:59:00.000Z"), "America/New_York")).toBe(false);
    expect(recapWindowOpen(new Date("2026-01-06T14:00:00.000Z"), "America/New_York")).toBe(true);
    expect(recapWindowOpen(new Date("2026-03-10T12:59:00.000Z"), "America/New_York")).toBe(false);
    expect(recapWindowOpen(new Date("2026-03-10T13:00:00.000Z"), "America/New_York")).toBe(true);
    expect(recapWindowOpen(new Date("2026-03-11T15:00:00.000Z"), "America/New_York")).toBe(true);
  });

  it("does not treat a live or incomplete week as ready", () => {
    const teams = [{ id: "a" }, { id: "b" }];
    expect(weekIsFinal(teams, [{ week: 7, team_id: "a", status: "final", team_score: 1, opponent_id: "b", opponent_score: 2 }], 7)).toBe(false);
    expect(
      weekIsFinal(teams, [
        { week: 7, team_id: "a", status: "live", team_score: 1, opponent_id: "b", opponent_score: 2 },
        { week: 7, team_id: "b", status: "live", team_score: 2, opponent_id: "a", opponent_score: 1 },
      ], 7),
    ).toBe(false);
  });

  it("calculates bench points without player names", () => {
    const bench = benchSummary(["s1"], { s1: 10, b1: 54 }, 10, 40);
    expect(bench).toMatchObject({ benchPoints: 54, benchBeatStarter: true, benchWouldFlip: true });
    const drafted = draftRecap(2, [
      side("a", "Alpha", "b", "Bravo", 10, 40, { benchPoints: 54, benchBeatStarter: true, benchWouldFlip: true }),
      side("b", "Bravo", "a", "Alpha", 40, 10),
    ], [], clean, []);
    expect(drafted.body).toContain("54");
    expect(drafted.body).not.toContain("player");
  });

  it("marks a mathematical clinch and elimination only when the remaining weeks make it true", () => {
    const prior: PriorGame[] = [{ teamId: "a", week: 1, points: 100, opponentPoints: 80 }];
    const facts = detectStories(
      14,
      [side("a", "Alpha", "b", "Bravo", 110, 70), side("b", "Bravo", "a", "Alpha", 70, 110)],
      prior,
      { playoffSpots: 1, weeksRemaining: 0 },
    );
    expect(facts.teams.find((team) => team.teamId === "a")?.tags).toContain("PLAYOFF_CLINCH");
    expect(facts.teams.find((team) => team.teamId === "b")?.tags).toContain("PLAYOFF_ELIMINATION");
  });
});
