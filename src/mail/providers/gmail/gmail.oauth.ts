import { AuthExpiredError, ProviderRequestError } from "../../provider";

// Google OAuth 2.0 web-server flow, via plain fetch (same style as the
// extension's Sheets code — no googleapis SDK).

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

// Read + add/remove labels. There is no narrower scope that allows
// labelling; our code only reads messages and changes Shortlyst labels.
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

export interface GmailOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function gmailOAuthConfig(): GmailOAuthConfig | null {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const base = process.env.MAIL_OAUTH_REDIRECT_BASE ?? "http://localhost:3000/mail/oauth";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: `${base.replace(/\/$/, "")}/gmail/callback` };
}

function requireConfig(): GmailOAuthConfig {
  const config = gmailOAuthConfig();
  if (!config) throw new Error("Gmail is not configured (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET)");
  return config;
}

export function buildAuthUrl(state: string): string {
  const { clientId, redirectUri } = requireConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    // offline + consent: always return a refresh token, even on reconnect.
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
  } catch (err) {
    throw new ProviderRequestError(`Google token endpoint unreachable: ${(err as Error).message}`, undefined, true);
  }
  const json = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok) {
    // invalid_grant = the refresh token is dead (revoked, password changed,
    // app removed) — only a reconnect fixes that.
    if (json.error === "invalid_grant") throw new AuthExpiredError("Google access was revoked or expired");
    const retryable = response.status === 429 || response.status >= 500;
    throw new ProviderRequestError(
      `Google token endpoint: ${response.status} ${json.error ?? ""} ${json.error_description ?? ""}`.trim(),
      response.status,
      retryable,
    );
  }
  return json;
}

export async function exchangeCodeForTokens(code: string): Promise<{ refreshToken: string; accessToken: string; expiresIn: number }> {
  const { clientId, clientSecret, redirectUri } = requireConfig();
  const json = await postToken({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  if (!json.refresh_token) {
    throw new ProviderRequestError("Google did not return a refresh token", undefined, false);
  }
  return { refreshToken: json.refresh_token, accessToken: json.access_token, expiresIn: json.expires_in };
}

// Access tokens live ~1 hour; cached in memory per refresh token and renewed
// a minute early. Not persisted — a restart just refreshes once.
const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function getAccessToken(refreshToken: string): Promise<string> {
  const cached = accessTokenCache.get(refreshToken);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const { clientId, clientSecret } = requireConfig();
  const json = await postToken({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  accessTokenCache.set(refreshToken, { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 });
  return json.access_token;
}

export function forgetAccessToken(refreshToken: string): void {
  accessTokenCache.delete(refreshToken);
}

export async function revokeToken(refreshToken: string): Promise<void> {
  forgetAccessToken(refreshToken);
  // Best effort: an already-revoked token answers 400, which is fine.
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }).toString(),
  }).catch(() => undefined);
}
