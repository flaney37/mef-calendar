import { describe, expect, it } from "vitest";
import {
  SESSION_SECONDS,
  createSessionToken,
  passwordMatches,
  sessionTokenValid,
} from "./admin-auth";

const PASSWORD = "correct-horse-battery-staple";
const NOW = 1_800_000_000;

describe("passwordMatches", () => {
  it("accepts only the exact password", () => {
    expect(passwordMatches(PASSWORD, PASSWORD)).toBe(true);
    expect(passwordMatches("correct-horse", PASSWORD)).toBe(false);
    expect(passwordMatches(`${PASSWORD} `, PASSWORD)).toBe(false);
  });

  it("lets nobody in when no password is configured", () => {
    expect(passwordMatches("", "")).toBe(false);
  });
});

describe("session token", () => {
  const token = createSessionToken(PASSWORD, NOW);

  it("is valid until it expires", () => {
    expect(sessionTokenValid(token, PASSWORD, NOW)).toBe(true);
    expect(sessionTokenValid(token, PASSWORD, NOW + SESSION_SECONDS - 1)).toBe(true);
    expect(sessionTokenValid(token, PASSWORD, NOW + SESSION_SECONDS)).toBe(false);
  });

  it("stops working when the password changes", () => {
    expect(sessionTokenValid(token, "new-password", NOW)).toBe(false);
  });

  it("can't be extended by editing the expiry", () => {
    const [, sig] = token.split(".");
    expect(sessionTokenValid(`${NOW + 10 * SESSION_SECONDS}.${sig}`, PASSWORD, NOW)).toBe(false);
  });

  it.each([undefined, "", "garbage", "123", "abc.def", `${NOW + 100}.`])("rejects %j", (bad) => {
    expect(sessionTokenValid(bad, PASSWORD, NOW)).toBe(false);
  });
});
