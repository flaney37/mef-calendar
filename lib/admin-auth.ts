// Admin panel login: one shared password (ADMIN_PASSWORD) and a signed
// session cookie. No second secret: the cookie is signed with the
// password itself, so changing the password logs every admin out.
//
// The functions here are pure (password and time are passed in) so they
// can be tested; app/admin/actions.ts wires them to cookies().

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "mef_admin";
export const SESSION_SECONDS = 7 * 24 * 60 * 60;

const sha256 = (s: string) => createHash("sha256").update(s).digest();

// Constant-time comparison, so response timing doesn't reveal how many
// leading characters were right. Hashing first makes both sides the same
// length, which timingSafeEqual requires.
export function passwordMatches(input: string, password: string): boolean {
  if (!password) return false; // not configured: nobody gets in
  return timingSafeEqual(sha256(input), sha256(password));
}

function signature(expires: number, password: string): string {
  return createHmac("sha256", password).update(`admin:${expires}`).digest("base64url");
}

// "<expiry unix seconds>.<HMAC>"
export function createSessionToken(password: string, nowSeconds: number): string {
  const expires = nowSeconds + SESSION_SECONDS;
  return `${expires}.${signature(expires, password)}`;
}

export function sessionTokenValid(
  token: string | undefined,
  password: string,
  nowSeconds: number,
): boolean {
  if (!token || !password) return false;
  const [expiresText, sig] = token.split(".");
  const expires = Number(expiresText);
  if (!Number.isInteger(expires) || !sig || expires <= nowSeconds) return false;
  const expected = Buffer.from(signature(expires, password));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
