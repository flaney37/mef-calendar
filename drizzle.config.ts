import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Next.js loads .env.local by itself, but drizzle-kit runs outside Next.
config({ path: ".env.local" });

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
