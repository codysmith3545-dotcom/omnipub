import { saveCredentials } from "./store.js";

export async function setupLinkedInOAuth(clientId: string, clientSecret: string): Promise<string> {
  const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=http://localhost:3847/callback&scope=w_member_social%20r_liteprofile`;
  return authUrl;
}

export async function exchangeLinkedInCode(
  code: string,
  clientId: string,
  clientSecret: string
): Promise<void> {
  const resp = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: "http://localhost:3847/callback",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const data = (await resp.json()) as { access_token: string; expires_in: number };
  saveCredentials("linkedin", {
    type: "oauth",
    value: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  });
}

export async function setupMediumToken(token: string): Promise<void> {
  saveCredentials("medium", { type: "token", value: token });
}
