import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { loadCredentialsKey } from "./credentials-crypto";

// The OAuth `state` parameter: proves the callback belongs to a connect flow
// our own (API-key-protected) endpoint started, and expires after 10 minutes.
// Signed rather than stored, so no table is needed. The HMAC key is derived
// from MAIL_CREDENTIALS_KEY, so there's one secret to manage, not two.

const STATE_TTL_MS = 10 * 60 * 1000;

interface StatePayload {
  provider: string;
  exp: number;
  nonce: string;
}

function hmacKey(key: Buffer): Buffer {
  return createHmac("sha256", key).update("shortlyst-oauth-state").digest();
}

function sign(body: string, key: Buffer): string {
  return createHmac("sha256", hmacKey(key)).update(body).digest("base64url");
}

export function createOAuthState(provider: string, key = loadCredentialsKey(), now = Date.now()): string {
  const payload: StatePayload = { provider, exp: now + STATE_TTL_MS, nonce: randomBytes(12).toString("base64url") };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, key)}`;
}

export class InvalidOAuthStateError extends Error {}

/** Returns the provider the flow was started for; throws when the state was
 * tampered with, expired, or started for a different provider. */
export function verifyOAuthState(
  state: string,
  expectedProvider: string,
  key = loadCredentialsKey(),
  now = Date.now(),
): void {
  const [body, signature] = state.split(".");
  if (!body || !signature) throw new InvalidOAuthStateError("Malformed state");

  const expected = Buffer.from(sign(body, key));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new InvalidOAuthStateError("State signature mismatch");
  }

  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
  if (payload.exp < now) throw new InvalidOAuthStateError("State expired — start the connection again");
  if (payload.provider !== expectedProvider) throw new InvalidOAuthStateError("State was issued for another provider");
}
