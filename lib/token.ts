import { randomBytes } from "node:crypto";

// 24 random bytes = 192 bits (CLAUDE.md asks for at least 128), encoded as
// base64url so the token is safe in a URL path without escaping: 32 chars.
export function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

// For logs: never print a full token.
export function truncateToken(token: string): string {
  return `${token.slice(0, 4)}…`;
}
