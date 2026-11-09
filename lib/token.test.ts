import { describe, expect, it } from "vitest";
import { generateToken, truncateToken } from "./token";

describe("generateToken", () => {
  it("is URL-safe and 32 chars long", () => {
    expect(generateToken()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("does not repeat", () => {
    const tokens = new Set(Array.from({ length: 1000 }, generateToken));
    expect(tokens.size).toBe(1000);
  });
});

describe("truncateToken", () => {
  it("keeps only the first 4 chars", () => {
    expect(truncateToken("abc1defghijk")).toBe("abc1…");
  });
});
