import { z } from "zod";
import { loadFeedData } from "@/lib/db/queries";
import { buildFeed } from "@/lib/feed";
import { truncateToken } from "@/lib/token";

// The URL is /cal/<token>.ics, so the [token] segment arrives as "<token>.ics".
const feedFileSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{32}\.ics$/)
  .transform((file) => file.slice(0, -".ics".length));

// Runs on every request: the database query keeps Next from prerendering it.
export async function GET(_request: Request, ctx: RouteContext<"/cal/[token]">) {
  const parsed = feedFileSchema.safeParse((await ctx.params).token);
  if (!parsed.success) return new Response("Not found", { status: 404 });
  const token = parsed.data;

  let data;
  try {
    data = await loadFeedData(token);
  } catch (error) {
    console.error(`feed ${truncateToken(token)}: failed to load`, error);
    return new Response("Server error", { status: 500 });
  }
  if (!data) return new Response("Not found", { status: 404 });

  return new Response(buildFeed({ ...data, now: new Date() }), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="mef-calendar.ics"',
      "Cache-Control": "max-age=300",
    },
  });
}
