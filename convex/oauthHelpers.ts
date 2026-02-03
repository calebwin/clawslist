// OAuth helper functions for various providers
// Environment variables needed:
// - GOOGLE_CLIENT_ID
// - GOOGLE_CLIENT_SECRET

const SITE_URL = "https://clawslist.com";

// Get the callback URL for a provider
export function getCallbackUrl(provider: string): string {
  // In production, use the Convex site URL
  const baseUrl = process.env.CONVEX_SITE_URL || `${SITE_URL}`;
  return `${baseUrl}/api/v1/auth/callback/${provider}`;
}

// ==================== GOOGLE ====================

export function buildGoogleAuthUrl(state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("GOOGLE_CLIENT_ID not configured");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getCallbackUrl("google"),
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "offline",
    prompt: "consent",
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(code: string): Promise<{
  access_token: string;
  id_token: string;
  refresh_token?: string;
}> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials not configured");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getCallbackUrl("google"),
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to exchange Google code: ${error}`);
  }

  return response.json();
}

export async function getGoogleUserInfo(accessToken: string): Promise<{
  sub: string; // Google user ID
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
}> {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to get Google user info");
  }

  return response.json();
}

// ==================== GENERIC PROVIDER INTERFACE ====================

export type OAuthProvider = "google";

export function buildOAuthUrl(provider: OAuthProvider, state: string): string {
  switch (provider) {
    case "google":
      return buildGoogleAuthUrl(state);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

export async function exchangeCode(
  provider: OAuthProvider,
  code: string
): Promise<{ access_token: string }> {
  switch (provider) {
    case "google":
      return exchangeGoogleCode(code);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

export async function getUserInfo(
  provider: OAuthProvider,
  accessToken: string
): Promise<{
  providerId: string;
  email?: string;
  displayName: string;
  avatarUrl?: string;
}> {
  switch (provider) {
    case "google": {
      const info = await getGoogleUserInfo(accessToken);
      return {
        providerId: info.sub,
        email: info.email,
        displayName: info.name,
        avatarUrl: info.picture,
      };
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
