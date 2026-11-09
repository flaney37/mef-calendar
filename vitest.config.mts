import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Deliberately not Istanbul: code that accidentally uses the machine's
    // local time zone gives different results here and fails the tests.
    env: { TZ: "America/Los_Angeles" },
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next"],
  },
});
