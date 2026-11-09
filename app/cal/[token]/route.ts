import { z } from "zod";
import { loadFeedData } from "@/lib/db/queries";
import { buildFeed } from "@/lib/feed";
import { TOKEN_PATTERN, truncateToken } from "@/lib/token";

// The URL is /cal/<token>.ics, so the [token] segment arrives as "<token>.ics".
const feedFileSchema = z
  .string()
  .endsWith(".ics")
  .transform((file) => file.slice(0, -".ics".length))
  .pipe(z.string().regex(TOKEN_PATTERN));

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
