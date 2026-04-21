/**
 * FEAT018 — Google OAuth2 authentication.
 *
 * Two platform paths:
 *   - Web/Proxy (Node): proxy exposes /oauth/google/* endpoints
 *   - Capacitor: in-app browser + custom URL scheme redirect
 *
 * Refresh token stored in secure store (expo-secure-store), never in DB.
 */

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];

// Client credentials — loaded from env or config
let _clientId = "";
let _clientSecret = "";

export function setGoogleOAuthCredentials(clientId: string, clientSecret: string): void {
  _clientId = clientId;
  _clientSecret = clientSecret;
}

// ── Token storage (in-memory + secure store) ───────────────────────────

let _accessToken: string | null = null;
let _accessTokenExpiry = 0;
let _refreshToken: string | null = null;

/** Set the refresh token (loaded from secure store at startup). */
export function setRefreshToken(token: string | null): void {
  _refreshToken = token;
}

export function getRefreshToken(): string | null {
  return _refreshToken;
}

export function hasRefreshToken(): boolean {
  return !!_refreshToken;
}

/** Clear all tokens (on disconnect). */
export function clearTokens(): void {
  _accessToken = null;
  _accessTokenExpiry = 0;
  _refreshToken = null;
}

// ── Access token management ────────────────────────────────────────────

/**
 * Get a valid access token. Refreshes automatically if expired.
 * Throws if no refresh token or refresh fails.
 */
export async function getAccessToken(): Promise<string> {
  // Return cached if still valid (with 60s buffer)
  if (_accessToken && Date.now() < _accessTokenExpiry - 60_000) {
    return _accessToken;
  }

  if (!_refreshToken) {
    throw new Error("No Google refresh token — user needs to re-authenticate");
  }

  // Refresh the access token
  const body = new URLSearchParams({
    client_id: _clientId,
    client_secret: _clientSecret,
    refresh_token: _refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const errBody = await response.text();
    if (response.status === 400 || response.status === 401) {
      // Token revoked or invalid — DON'T clear _refreshToken here.
      // The persisted token (secure store / .env) would still be loaded
      // on next restart, causing an infinite retry loop. Instead, set
      // the error on the integration config so callers skip sync.
      const { setGoogleCalendarError } = require("../registry");
      setGoogleCalendarError(`Token revoked or expired (${response.status}). Reconnect in Settings.`);
      throw new Error(`Google token refresh failed (${response.status}): token may be revoked`);
    }
    throw new Error(`Google token refresh failed: ${response.status} ${errBody}`);
  }

  const data = await response.json();
  _accessToken = data.access_token;
  _accessTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;

  return _accessToken!;
}

// ── OAuth consent URL builder ──────────────────────────────────────────

export function buildConsentUrl(redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: _clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens.
 * Returns the refresh token (to be stored in secure store).
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<{ refreshToken: string; accessToken: string; expiresIn: number }> {
  const body = new URLSearchParams({
    client_id: _clientId,
    client_secret: _clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${response.status}`);
  }

  const data = await response.json();

  // Cache the access token
  _accessToken = data.access_token;
  _accessTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  _refreshToken = data.refresh_token;

  return {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresIn: data.expires_in || 3600,
  };
}
