import type { StoryTag } from "./facts";

export interface VocabEntry {
  id: string;
  text: string;
  situations: StoryTag[];
  intensity: 1 | 2 | 3;
  memeLevel: 0 | 1 | 2;
  profanityLevel: 0 | 1 | 2;
  adult: boolean;
  cooldownWeeks: number;
  family: string;
}
export interface VocabUse {
  vocabularyId: string;
  family: string;
  week: number;
}
export interface ToneSettings {
  trashTalk: "light" | "normal" | "savage";
  profanity: "clean" | "some" | "uncensored";
  adultHumor: boolean;
  memeLevel: "low" | "medium" | "brainrot";
  length: "quick" | "normal" | "full";
}

const entry = (
  id: string,
  text: string,
  situations: StoryTag[],
  family: string,
  intensity: 1 | 2 | 3,
  memeLevel: 0 | 1 | 2,
  profanityLevel: 0 | 1 | 2,
  cooldownWeeks: number,
  adult = false,
): VocabEntry => ({
  id,
  text,
  situations,
  family,
  intensity,
  memeLevel,
  profanityLevel,
  cooldownWeeks,
  adult,
});

export const vocabulary: VocabEntry[] = [
  entry("cooked", "cooked", ["BLOWOUT_LOSS", "COLLAPSE", "LOSS_STREAK"], "cooked", 2, 1, 0, 4),
  entry("absolutely-cooked", "absolutely cooked", ["BLOWOUT_LOSS", "COLLAPSE"], "cooked", 3, 1, 0, 4),
  entry("fried", "fried", ["BLOWOUT_LOSS", "LOWEST_SCORE"], "cooked", 2, 1, 0, 4),
  entry("washed", "looking washed", ["LOSS_STREAK", "COLLAPSE"], "washed", 2, 1, 0, 4),
  entry("dogwalked", "got dogwalked", ["BLOWOUT_LOSS"], "dogwalk", 2, 1, 0, 3),
  entry("dogwalked-win", "dogwalked them", ["BLOWOUT_WIN"], "dogwalk", 2, 1, 0, 3),
  entry("packed-up", "got packed up", ["BLOWOUT_LOSS"], "packed", 2, 1, 0, 4),
  entry("sent-home", "got sent home", ["BLOWOUT_LOSS", "PLAYOFF_ELIMINATION"], "packed", 2, 0, 0, 4),
  entry("generational", "a generational week", ["HIGHEST_SCORE", "SEASON_HIGH", "BLOWOUT_WIN"], "generational", 2, 1, 0, 5),
  entry("generational-stinker", "a generational stinker", ["LOWEST_SCORE", "SEASON_LOW", "BLOWOUT_LOSS"], "generational", 3, 1, 0, 5),
  entry("legacy-game", "a legacy game", ["HIGHEST_SCORE", "SEASON_HIGH"], "legacy", 2, 1, 0, 5),
  entry("legacy-stinker", "a legacy stinker", ["LOWEST_SCORE", "SEASON_LOW"], "legacy", 3, 1, 0, 5),
  entry("masterclass", "a masterclass", ["BLOWOUT_WIN", "HIGHEST_SCORE"], "class", 1, 0, 0, 4),
  entry("disasterclass", "a disasterclass", ["BLOWOUT_LOSS", "LOWEST_SCORE"], "class", 2, 1, 0, 4),
  entry("clinic", "a clinic", ["BLOWOUT_WIN"], "class", 1, 0, 0, 4),
  entry("cinema", "cinema", ["NAILBITER", "CLOSE_WIN", "CLOSE_LOSS"], "cinema", 2, 2, 0, 4),
  entry("absolute-cinema", "absolute cinema", ["NAILBITER"], "cinema", 3, 2, 0, 4),
  entry("nasty-work", "nasty work", ["BLOWOUT_WIN", "UPSET"], "nasty", 2, 1, 0, 3),
  entry("diabolical", "diabolical", ["BENCH_DISASTER", "BLOWOUT_LOSS"], "diabolical", 2, 1, 0, 4),
  entry("criminal", "borderline criminal roster management", ["BENCH_DISASTER"], "crime", 2, 1, 0, 4),
  entry("malpractice", "fantasy malpractice", ["BENCH_DISASTER", "ABOVE_MEDIAN_LOSS"], "crime", 2, 1, 0, 4),
  entry("self-sabotage", "self-sabotage", ["BENCH_DISASTER"], "bench", 2, 0, 0, 3),
  entry("skill-issue", "a skill issue", ["BENCH_DISASTER", "LOSS_STREAK"], "skill", 2, 1, 0, 3),
  entry("fraud-watch", "fraud watch", ["BELOW_MEDIAN_WIN", "CLOSE_WIN"], "fraud", 2, 1, 0, 4),
  entry("fraud-alert", "fraud alert", ["BELOW_MEDIAN_WIN"], "fraud", 3, 2, 0, 4),
  entry("beat-allegations", "beat the allegations", ["UPSET", "WIN_STREAK"], "fraud", 2, 2, 0, 4),
  entry("never-beating", "never beating the allegations", ["BELOW_MEDIAN_WIN", "CLOSE_WIN"], "fraud", 3, 2, 0, 4),
  entry("mickey-win", "a Mickey Mouse win", ["BELOW_MEDIAN_WIN", "CLOSE_WIN"], "luck", 2, 1, 0, 4),
  entry("plot-armor", "the plot armor is becoming ridiculous", ["BELOW_MEDIAN_WIN", "CLOSE_WIN", "WIN_STREAK"], "luck", 2, 2, 0, 3),
  entry("devil-magic", "devil magic", ["NAILBITER", "CLOSE_WIN"], "luck", 2, 2, 0, 4),
  entry("aura", "the aura is becoming a problem", ["WIN_STREAK", "BLOWOUT_WIN"], "aura", 2, 2, 0, 3),
  entry("aura-farming", "aura farming", ["BLOWOUT_WIN", "HIGHEST_SCORE"], "aura", 3, 2, 0, 3),
  entry("negative-aura", "negative aura", ["LOSS_STREAK", "LOWEST_SCORE"], "aura", 2, 2, 0, 3),
  entry("aura-loss", "an aura loss", ["COLLAPSE", "BLOWOUT_LOSS"], "aura", 2, 2, 0, 3),
  entry("immaculate", "immaculate vibes", ["WIN_STREAK", "HIGHEST_SCORE"], "vibes", 1, 1, 0, 4),
  entry("no-motion", "no motion", ["LOWEST_SCORE", "LOSS_STREAK"], "motion", 2, 2, 0, 4),
  entry("has-motion", "has motion", ["WIN_STREAK", "UPSET"], "motion", 2, 2, 0, 4),
  entry("stood-business", "stood on business", ["BLOWOUT_WIN", "UPSET"], "business", 2, 2, 0, 4),
  entry("did-not-stand", "did not stand on business", ["COLLAPSE", "BLOWOUT_LOSS"], "business", 2, 2, 0, 4),
  entry("rent-free", "living rent free in that matchup", ["BLOWOUT_WIN"], "rent", 2, 1, 0, 5),
  entry("crashout", "a crashout", ["COLLAPSE", "BLOWOUT_LOSS"], "crash", 2, 2, 0, 4),
  entry("generational-crashout", "a generational crashout", ["COLLAPSE", "SEASON_LOW"], "crash", 3, 2, 0, 5),
  entry("locked-in", "locked in", ["WIN_STREAK", "HIGHEST_SCORE"], "locked", 1, 1, 0, 3),
  entry("dialed", "dialed", ["HIGHEST_SCORE", "SEASON_HIGH"], "locked", 2, 1, 0, 3),
  entry("different-animal", "a different animal this week", ["UPSET", "SEASON_HIGH"], "animal", 2, 1, 0, 4),
  entry("final-boss", "final boss behavior", ["HIGHEST_SCORE", "WIN_STREAK"], "boss", 2, 2, 0, 5),
  entry("main-character", "main character hours", ["HIGHEST_SCORE", "NAILBITER"], "character", 2, 2, 0, 4),
  entry("npc", "an NPC performance", ["LOWEST_SCORE", "BLOWOUT_LOSS"], "character", 2, 2, 0, 4),
  entry("side-quest", "a side quest of a lineup", ["BENCH_DISASTER", "ABOVE_MEDIAN_LOSS"], "character", 2, 2, 0, 4),
  entry("canon-event", "a canon event", ["COLLAPSE", "UPSET", "NAILBITER"], "character", 2, 2, 0, 4),
  entry("character-dev", "character development", ["COMEBACK_SEASON", "UPSET"], "character", 1, 1, 0, 5),
  entry("redemption", "a redemption arc", ["COMEBACK_SEASON"], "arc", 1, 1, 0, 5),
  entry("villain-arc", "a villain arc", ["BLOWOUT_WIN", "WIN_STREAK"], "arc", 2, 2, 0, 5),
  entry("downfall", "the downfall needs to be studied", ["COLLAPSE", "LOSS_STREAK"], "study", 3, 2, 0, 5),
  entry("studied", "this one needs to be studied", ["BENCH_DISASTER", "BLOWOUT_LOSS"], "study", 2, 1, 0, 4),
  entry("unserious", "historically unserious", ["LOWEST_SCORE", "SEASON_LOW"], "unserious", 2, 1, 0, 4),
  entry("unserious-franchise", "an unserious franchise this week", ["LOSS_STREAK"], "unserious", 2, 1, 0, 4),
  entry("poverty", "a poverty box score", ["LOWEST_SCORE", "SEASON_LOW"], "poverty", 3, 2, 0, 5),
  entry("fries", "put the fries in the bag", ["BLOWOUT_LOSS", "PLAYOFF_ELIMINATION"], "fries", 3, 2, 0, 5),
  entry("clocked-in", "clocked in and went home", ["ABOVE_MEDIAN_LOSS", "CLOSE_LOSS"], "clock", 2, 1, 0, 4),
  entry("be-serious", "be serious", ["BENCH_DISASTER", "LOWEST_SCORE"], "serious", 2, 1, 0, 3),
  entry("what-are-we-doing", "what are we doing here", ["BENCH_DISASTER", "BLOWOUT_LOSS"], "serious", 2, 1, 0, 3),
  entry("check-on-him", "somebody check on this roster", ["LOSS_STREAK", "SEASON_LOW"], "check", 2, 0, 0, 4),
  entry("thoughts-prayers", "thoughts and prayers to the starting lineup", ["BLOWOUT_LOSS", "BENCH_DISASTER"], "check", 2, 1, 0, 4),
  entry("sources-over", "sources are saying it's over", ["PLAYOFF_ELIMINATION", "LOSS_STREAK"], "sources", 2, 2, 0, 5),
  entry("retirement", "the group chat is hearing retirement", ["LOSS_STREAK", "COLLAPSE"], "sources", 3, 2, 0, 5),
  entry("pack-it-up", "pack it up", ["PLAYOFF_ELIMINATION", "BLOWOUT_LOSS"], "pack", 2, 1, 0, 4),
  entry("consolation", "get ready to learn the consolation bracket", ["PLAYOFF_ELIMINATION"], "pack", 3, 2, 0, 6),
  entry("glazing", "the win column is doing the glazing", ["WIN_STREAK"], "glaze", 2, 2, 0, 4),
  entry("stat-padding", "stat-padding against a soft matchup", ["BELOW_MEDIAN_WIN"], "pad", 2, 1, 0, 4),
  entry("bench-merchant", "bench merchant behavior", ["BENCH_DISASTER"], "bench", 2, 2, 0, 3),
  entry("ppb-champion", "points-per-bench champion", ["BENCH_DISASTER"], "bench", 3, 2, 0, 4),
  entry("let-him-cook", "the lineup cooked", ["BLOWOUT_WIN", "HIGHEST_SCORE"], "cook-win", 2, 1, 0, 3),
  entry("should-not-cook", "should not have trusted that lineup", ["BENCH_DISASTER"], "cook-win", 2, 1, 0, 3),
  entry("so-back", "we're so back", ["COMEBACK_SEASON", "WIN_STREAK"], "back", 2, 2, 0, 4),
  entry("so-over", "it's so over", ["COLLAPSE", "PLAYOFF_ELIMINATION"], "back", 2, 2, 0, 4),
  entry("agenda-alive", "the agenda is alive", ["UPSET", "WIN_STREAK"], "agenda", 2, 2, 0, 4),
  entry("agenda-dead", "the agenda is dead", ["COLLAPSE", "LOSS_STREAK"], "agenda", 2, 2, 0, 4),
  entry("victory-lap", "a quiet victory lap", ["BLOWOUT_WIN"], "lap", 1, 0, 0, 3),
  entry("receipts", "the receipts are in the box score", ["UPSET", "COLLAPSE"], "receipts", 2, 1, 0, 4),
  entry("caught-4k", "caught in 4K", ["BENCH_DISASTER", "BLOWOUT_LOSS"], "receipts", 2, 2, 0, 4),
  entry("aged-milk", "that game plan aged like milk", ["COLLAPSE", "BENCH_DISASTER"], "milk", 2, 1, 0, 4),
  entry("aged-well", "aged beautifully", ["COMEBACK_SEASON", "WIN_STREAK"], "milk", 1, 1, 0, 4),
  entry("cold-take", "a freezing-cold process", ["BENCH_DISASTER"], "takes", 2, 1, 0, 4),
  entry("galaxy-brain", "a galaxy-brain week", ["UPSET", "HIGHEST_SCORE"], "galaxy", 2, 2, 0, 5),
  entry("4d-chess", "4D chess against the matchup", ["UPSET", "NAILBITER"], "galaxy", 3, 2, 0, 5),
  entry("galaxy-disaster", "a galaxy-brain disaster", ["BENCH_DISASTER", "BLOWOUT_LOSS"], "galaxy", 3, 2, 0, 5),
  entry("sicko", "sicko behavior", ["NAILBITER", "BELOW_MEDIAN_WIN"], "sicko", 2, 2, 0, 4),
  entry("disgusting-work", "disgusting work", ["BLOWOUT_WIN"], "filth", 2, 1, 0, 3),
  entry("pure-filth", "pure filth in the best way", ["HIGHEST_SCORE", "BLOWOUT_WIN"], "filth", 3, 2, 0, 4),
  entry("disgusting-scenes", "disgusting scenes", ["BLOWOUT_LOSS", "LOWEST_SCORE"], "filth", 2, 1, 0, 3),
  entry("hate-watch", "a generational hate watch", ["BLOWOUT_LOSS", "COLLAPSE"], "hate", 3, 2, 0, 5),
  entry("hater", "hater of the year material", ["LOSS_STREAK"], "hate", 2, 2, 0, 5),
  entry("hall-shame", "first-ballot Hall of Shame", ["SEASON_LOW", "BENCH_DISASTER"], "hall", 3, 2, 0, 6),
  entry("hall-fame", "Hall of Fame box score", ["SEASON_HIGH", "HIGHEST_SCORE"], "hall", 2, 1, 0, 6),
  entry("close-escape", "escaped more than they won", ["NAILBITER", "CLOSE_WIN"], "escape", 2, 0, 0, 2),
  entry("plain-win", "handled the matchup", ["BLOWOUT_WIN"], "plain", 1, 0, 0, 2),
  entry("plain-loss", "came up short", ["CLOSE_LOSS", "BLOWOUT_LOSS"], "plain", 1, 0, 0, 2),
  entry("ass-beat", "got his ass beat", ["BLOWOUT_LOSS"], "swear", 3, 1, 2, 4),
  entry("what-the-hell", "what the hell was that lineup", ["BENCH_DISASTER"], "swear", 2, 1, 1, 4),
  entry("shitshow", "an absolute shitshow", ["LOWEST_SCORE", "BLOWOUT_LOSS"], "swear", 3, 1, 2, 4),
  entry("bullshit-win", "a bullshit win", ["BELOW_MEDIAN_WIN", "CLOSE_WIN"], "swear", 3, 1, 2, 4),
  entry("lucky-bastard", "you lucky bastard", ["NAILBITER", "CLOSE_WIN"], "swear", 3, 1, 2, 4, true),
  entry("lineup-ass", "that lineup was ass", ["BENCH_DISASTER", "LOWEST_SCORE"], "swear", 3, 1, 2, 4),
  entry("fucking-cooked", "the roster is fucking cooked", ["LOSS_STREAK", "COLLAPSE"], "swear", 3, 2, 2, 5),
  entry("what-the-fuck", "what the fuck are we doing", ["BENCH_DISASTER"], "swear", 3, 2, 2, 4),
  entry("generational-ass", "a generational ass performance", ["SEASON_LOW", "LOWEST_SCORE"], "swear", 3, 2, 2, 5),
  entry("holy-shit", "holy shit", ["HIGHEST_SCORE", "NAILBITER"], "swear", 2, 1, 2, 3),
  entry("warning-label", "this recap should come with a warning label", ["BLOWOUT_WIN", "BLOWOUT_LOSS"], "adult", 2, 1, 0, 6, true),
];

const intensityCap = { light: 1, normal: 2, savage: 3 } as const;
const memeCap = { low: 0, medium: 1, brainrot: 2 } as const;
const profanityCap = { clean: 0, some: 1, uncensored: 2 } as const;

export function pickPhrase(
  settings: ToneSettings,
  usage: VocabUse[],
  week: number,
  situations: StoryTag[],
  usedFamilies: Set<string>,
): VocabEntry | null {
  const eligible = vocabulary
    .filter((phrase) => phrase.situations.some((tag) => situations.includes(tag)))
    .filter((phrase) => phrase.intensity <= intensityCap[settings.trashTalk])
    .filter((phrase) => phrase.memeLevel <= memeCap[settings.memeLevel])
    .filter((phrase) => phrase.profanityLevel <= profanityCap[settings.profanity])
    .filter((phrase) => !phrase.adult || settings.adultHumor)
    .filter((phrase) => !usedFamilies.has(phrase.family))
    .filter((phrase) =>
      usage.every(
        (use) =>
          (use.vocabularyId !== phrase.id && use.family !== phrase.family) ||
          week - use.week >= phrase.cooldownWeeks,
      ),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  if (eligible.length === 0) return null;
  const index = (week + situations.length) % eligible.length;
  return eligible[index] ?? null;
}
