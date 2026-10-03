import { runScheduledJobs } from "@/lib/scheduler/run";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!secret || token.length !== secret.length) return false;
  let diff = 0;
  for (let index = 0; index < secret.length; index += 1)
    diff |= secret.charCodeAt(index) ^ token.charCodeAt(index);
  return diff === 0;
}

export async function POST(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  const result = await runScheduledJobs();
  return Response.json(result);
}
