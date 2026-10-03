import { timeZoneOffsetMs } from "@/lib/time";

export function localParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: value("weekday"),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

/** Tuesday 9:00 local opens the window. Every other day is catch-up for an already completed week. */
export function recapWindowOpen(instant: Date, timeZone: string): boolean {
  const local = localParts(instant, timeZone);
  if (local.weekday !== "Tue") return true;
  return local.hour > 9 || (local.hour === 9 && local.minute >= 0);
}

export function weekIsFinal(
  teams: { id: string }[],
  matchups: {
    week: number;
    team_id: string;
    status: string;
    team_score: number | null;
    opponent_id: string | null;
    opponent_score: number | null;
  }[],
  week: number,
): boolean {
  const rows = matchups.filter((row) => row.week === week);
  const covered = new Set(rows.map((row) => row.team_id));
  if (teams.length === 0 || teams.some((team) => !covered.has(team.id))) return false;
  return rows.every(
    (row) =>
      row.status === "final" &&
      row.team_score !== null &&
      (row.opponent_id === null || row.opponent_score !== null),
  );
}

export function tuesdayNineUtc(year: number, month: number, day: number, timeZone: string): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, 9, 0, 0));
  const corrected = new Date(utcGuess.getTime() - timeZoneOffsetMs(utcGuess, timeZone));
  return new Date(utcGuess.getTime() - timeZoneOffsetMs(corrected, timeZone));
}
