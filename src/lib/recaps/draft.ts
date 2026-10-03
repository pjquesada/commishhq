import { detectStories, type CurrentSide, type PriorGame, type RecapFacts, type TeamStory } from "./facts";
import { pickPhrase, type ToneSettings, type VocabEntry, type VocabUse } from "./vocabulary";

export interface DraftedRecap {
  body: string;
  facts: RecapFacts;
  vocabulary: { id: string; family: string }[];
  sections: {
    team_id: string;
    facts: { tags: string[]; points: number; opponentPoints: number; benchPoints: number | null };
    short_notification: string;
    section_body: string;
  }[];
}

function points(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}
function score(team: TeamStory): string {
  return `${points(team.points)}–${points(team.opponentPoints)}`;
}
function lead(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function line(team: TeamStory, phrase: VocabEntry | null, length: ToneSettings["length"]): string {
  const result = team.won ? "beat" : team.lost ? "lost to" : "tied";
  const base = `${team.name} ${result} ${team.opponentName} ${score(team)}.`;
  const color = phrase ? ` ${lead(phrase.text)}.` : "";
  if (length === "quick") return `${base}${color}`;
  const extra: string[] = [];
  if (team.tags.includes("WIN_STREAK")) extra.push(`${team.streak} straight wins.`);
  if (team.tags.includes("LOSS_STREAK")) extra.push(`${Math.abs(team.streak)} straight losses.`);
  if (team.tags.includes("BENCH_DISASTER") && team.benchPoints != null)
    extra.push(`The bench put up ${points(team.benchPoints)} while the starters did the damage.`);
  if (team.tags.includes("NAILBITER") && team.won) extra.push("That was an escape, not a comfortable win.");
  if (length === "normal") return `${base}${color}${extra[0] ? ` ${extra[0]}` : ""}`;
  return `${base}${color}${extra.length ? ` ${extra.join(" ")}` : ""}`;
}

function notification(team: TeamStory, phrase: VocabEntry | null): string {
  const result = team.won ? "beat" : team.lost ? "lost to" : "tied";
  const bits = [`You ${result} ${team.opponentName} ${score(team)}.`];
  if (phrase) bits.push(`${lead(phrase.text)}.`);
  if (team.tags.includes("WIN_STREAK")) bits.push(`${team.streak} straight wins.`);
  if (team.tags.includes("BENCH_DISASTER") && team.benchPoints != null)
    bits.push(`Your bench put up ${points(team.benchPoints)}.`);
  if (team.tags.includes("NAILBITER") && team.won) bits.push("You escaped it.");
  bits.push("Read the full recap.");
  return bits.join(" ").slice(0, 280);
}

export function draftRecap(
  week: number,
  current: CurrentSide[],
  prior: PriorGame[],
  settings: ToneSettings,
  usage: VocabUse[],
  options?: { playoffSpots?: number; weeksRemaining?: number },
): DraftedRecap {
  const facts = detectStories(week, current, prior, options);
  const usedFamilies = new Set<string>();
  const chosen: VocabEntry[] = [];
  const phraseFor = (team: TeamStory) => {
    const phrase = pickPhrase(settings, usage, week, team.tags, usedFamilies);
    if (!phrase) return null;
    usedFamilies.add(phrase.family);
    chosen.push(phrase);
    return phrase;
  };
  const phrases = new Map(facts.teams.map((team) => [team.teamId, phraseFor(team)]));
  const seen = new Set<string>();
  const games: string[] = [];
  for (const team of facts.teams) {
    const key = [team.teamId, team.opponentId ?? "bye"].sort().join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    const other = facts.teams.find((entry) => entry.teamId === team.opponentId);
    const bench =
      other?.tags.includes("BENCH_DISASTER") && other.benchPoints != null
        ? ` ${other.name}'s bench put up ${points(other.benchPoints)}.`
        : "";
    games.push(`${line(team, phrases.get(team.teamId) ?? null, settings.length)}${bench}`);
  }
  const notes: string[] = [`Week ${week}.`];
  const high = facts.teams.find((team) => team.tags.includes("HIGHEST_SCORE"));
  const low = facts.teams.find((team) => team.tags.includes("LOWEST_SCORE"));
  const blowout = facts.teams.find((team) => team.tags.includes("BLOWOUT_WIN"));
  const close = facts.teams.find((team) => team.tags.includes("NAILBITER") || team.tags.includes("CLOSE_WIN"));
  if (high && high.teamId !== low?.teamId) notes.push(`${high.name} had the high score at ${points(high.points)}.`);
  if (low && low.teamId !== high?.teamId) notes.push(`${low.name} had the low score at ${points(low.points)}.`);
  if (blowout) notes.push(`${blowout.name} supplied the blowout, ${score(blowout)}.`);
  if (close) notes.push(`${close.name} and ${close.opponentName} played the tight one, ${score(close)}.`);
  const body = [...notes, ...games].join("\n\n");
  return {
    body,
    facts,
    vocabulary: chosen.map((phrase) => ({ id: phrase.id, family: phrase.family })),
    sections: facts.teams.map((team) => ({
      team_id: team.teamId,
      facts: {
        tags: team.tags,
        points: team.points,
        opponentPoints: team.opponentPoints,
        benchPoints: team.benchPoints ?? null,
      },
      short_notification: notification(team, phrases.get(team.teamId) ?? null),
      section_body: line(team, phrases.get(team.teamId) ?? null, settings.length),
    })),
  };
}

const banned =
  /let's dive in|one for the books|roller coaster of emotions|in the world of fantasy football|it was a week filled with/i;

export function usesBannedVoice(text: string): boolean {
  return banned.test(text);
}
