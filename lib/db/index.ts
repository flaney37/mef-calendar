import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// neon-http sends each query as a single HTTPS request. That suits serverless
// functions on Vercel: no long-lived TCP connection to open or pool.
// Interactive transactions are not supported over HTTP; use db.batch() instead.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

export const db = drizzle(url, { schema });
