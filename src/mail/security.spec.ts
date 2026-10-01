import { randomBytes } from "node:crypto";
import { decryptCredentials, encryptCredentials, loadCredentialsKey } from "./credentials-crypto";
import { createOAuthState, InvalidOAuthStateError, verifyOAuthState } from "./oauth-state";

const key = randomBytes(32);

describe("credentials encryption", () => {
  it("round-trips and never stores the plaintext", () => {
    const stored = encryptCredentials({ refreshToken: "1//secret-token" }, key);
    expect(stored).not.toContain("secret-token");
    expect(stored.startsWith("v1.")).toBe(true);
    expect(decryptCredentials(stored, key)).toEqual({ refreshToken: "1//secret-token" });
  });

  it("uses a fresh IV each time", () => {
    const creds = { refreshToken: "same" };
    expect(encryptCredentials(creds, key)).not.toBe(encryptCredentials(creds, key));
  });

  it("fails on tampering or the wrong key", () => {
    const stored = encryptCredentials({ refreshToken: "x" }, key);
    const parts = stored.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptCredentials(parts.join("."), key)).toThrow();
    expect(() => decryptCredentials(stored, randomBytes(32))).toThrow();
  });

  it("requires a 32-byte key", () => {
    expect(() => loadCredentialsKey(undefined)).toThrow(/not set/);
    expect(() => loadCredentialsKey(Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
  });
});

describe("OAuth state", () => {
  it("verifies a fresh state for the same provider", () => {
    const state = createOAuthState("gmail", key);
    expect(() => verifyOAuthState(state, "gmail", key)).not.toThrow();
  });

  it("rejects an expired state", () => {
    const state = createOAuthState("gmail", key, Date.now() - 11 * 60 * 1000);
    expect(() => verifyOAuthState(state, "gmail", key)).toThrow(/expired/);
  });

  it("rejects a tampered state, another provider, or another key", () => {
    const state = createOAuthState("gmail", key);
    const [body, sig] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ provider: "gmail", exp: Date.now() + 1e9, nonce: "x" })).toString("base64url");
    expect(() => verifyOAuthState(`${forged}.${sig}`, "gmail", key)).toThrow(InvalidOAuthStateError);
    expect(() => verifyOAuthState(`${body}.${sig}`, "outlook", key)).toThrow(/another provider/);
    expect(() => verifyOAuthState(state, "gmail", randomBytes(32))).toThrow(InvalidOAuthStateError);
    expect(() => verifyOAuthState("garbage", "gmail", key)).toThrow(InvalidOAuthStateError);
  });
});
