"use server";
import { redirect } from "next/navigation";
import { syncYahooLeague } from "@/lib/leagues/yahoo-sync";
import { LeagueError } from "@/lib/leagues/models";

export async function importYahooLeague(form: FormData) {
  try {
    const leagueId = await syncYahooLeague(String(form.get("leagueKey") ?? ""));
    redirect(`/leagues/${leagueId}`);
  } catch (error) {
    if (error instanceof LeagueError) redirect(`/leagues/yahoo?error=1`);
    throw error;
  }
}
