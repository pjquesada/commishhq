"use server";
import { redirect } from "next/navigation";
import { saveEspnSession, syncEspnLeague } from "@/lib/leagues/espn-sync";
import { LeagueError } from "@/lib/leagues/models";
import { espnExperimentalEnabled } from "@/lib/fantasy/providers/espn/client";

export async function importEspnLeague(form: FormData) {
  try {
    const leagueId = await syncEspnLeague(String(form.get("leagueId") ?? ""), Number(form.get("season")));
    redirect(`/leagues/${leagueId}`);
  } catch (error) {
    if (error instanceof LeagueError) redirect("/leagues/espn?error=1");
    throw error;
  }
}

export async function storeEspnSession(form: FormData) {
  if (!espnExperimentalEnabled()) redirect("/leagues/espn?error=1");
  try {
    await saveEspnSession(String(form.get("espnS2") ?? ""), String(form.get("swid") ?? ""));
  } catch (error) {
    if (error instanceof LeagueError) redirect("/leagues/espn?error=1");
    throw error;
  }
  redirect("/leagues/espn?saved=1");
}
