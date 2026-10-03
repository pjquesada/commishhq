import type { ToneSettings } from "./vocabulary";

const blocked =
  /\b(nigger|nigga|faggot|retard|kike|spic|chink|tranny)\b/i;

function numbers(text: string): number[] {
  return [...text.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
}

export function introducesNewNumbers(source: string, polished: string): boolean {
  const allowed = numbers(source);
  return numbers(polished).some(
    (value) => !allowed.some((known) => Math.abs(known - value) < 0.001),
  );
}

export function acceptPolish(draft: string, polished: string, facts: unknown): string {
  const cleaned = polished.trim();
  if (cleaned.length < 20 || cleaned.length > 12000) return draft;
  if (blocked.test(cleaned)) return draft;
  const source = `${draft}\n${JSON.stringify(facts)}`;
  if (introducesNewNumbers(source, cleaned)) return draft;
  return cleaned;
}

export function polishPrompt(draft: string, facts: unknown, settings: ToneSettings): string {
  return [
    "Rewrite this fantasy football recap in the same voice: a funny group chat, not a sports article.",
    "Do not invent names, scores, injuries, projections, trades, or history.",
    "Keep every number that is already present. Add no new numbers.",
    `Tone: trash talk ${settings.trashTalk}, profanity ${settings.profanity}, adult humor ${settings.adultHumor ? "on" : "off"}, meme level ${settings.memeLevel}, length ${settings.length}.`,
    "Facts:",
    JSON.stringify(facts),
    "Draft:",
    draft,
  ].join("\n");
}

type AiBinding = {
  run: (
    model: string,
    input: { messages: { role: string; content: string }[] },
  ) => Promise<{ response?: string }>;
};

/** Uses the Workers AI binding when the cron isolate has one. Failure returns null. */
export async function workersAiComplete(prompt: string): Promise<string | null> {
  const model = process.env.RECAP_AI_MODEL || "@cf/zai-org/glm-4.7-flash";
  const ai = (globalThis as { AI?: AiBinding }).AI;
  if (!ai || model.includes("kimi") || model.includes("glm-5")) return null;
  try {
    const result = await ai.run(model, {
      messages: [
        {
          role: "system",
          content:
            "You polish a recap. You do not invent names, scores, injuries, projections, trades, or history.",
        },
        { role: "user", content: prompt },
      ],
    });
    return typeof result.response === "string" ? result.response : null;
  } catch {
    return null;
  }
}

export async function maybePolish(
  draft: string,
  facts: unknown,
  settings: ToneSettings,
  complete: (prompt: string) => Promise<string | null> = workersAiComplete,
): Promise<string> {
  try {
    const polished = await complete(polishPrompt(draft, facts, settings));
    if (!polished) return draft;
    return acceptPolish(draft, polished, facts);
  } catch {
    return draft;
  }
}
