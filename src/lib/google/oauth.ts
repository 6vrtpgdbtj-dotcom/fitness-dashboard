import "server-only";
import { randomBytes } from "node:crypto";
import { google } from "googleapis";
import { decryptSecret, encryptSecret } from "./crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
] as const;

export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
type GoogleCredentials = {
  refresh_token?: string | null;
  access_token?: string | null;
  expiry_date?: number | null;
};

function googleConfig() {
  // Legacy deployment names remain accepted during configuration migration.
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) throw new Error("Google OAuth is not configured.");
  return { clientId, clientSecret, redirectUri };
}

export function createGoogleOAuthClient(): OAuth2Client {
  const { clientId, clientSecret, redirectUri } = googleConfig();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function createGoogleOAuthState() {
  return randomBytes(32).toString("base64url");
}

export function createGoogleAuthorizationUrl(state: string) {
  return createGoogleOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [...GOOGLE_SCOPES],
    state,
  });
}

export async function saveGoogleCredentials(input: {
  organizationId: string;
  profileId: string;
  credentials: GoogleCredentials;
}) {
  if (!input.credentials.refresh_token) throw new Error("Google did not return a refresh token.");
  const client = createAdminClient();
  const { error } = await client.from("oauth_credentials").upsert({
    organization_id: input.organizationId,
    profile_id: input.profileId,
    provider: "google",
    encrypted_refresh_token: encryptSecret(input.credentials.refresh_token),
    encrypted_access_token: input.credentials.access_token ? encryptSecret(input.credentials.access_token) : null,
    expires_at: input.credentials.expiry_date ? new Date(input.credentials.expiry_date).toISOString() : null,
    scopes: GOOGLE_SCOPES,
  }, { onConflict: "organization_id,profile_id,provider" });
  if (error) throw new Error("Could not store Google credentials.");
}

async function authorizedClientForProfile(profileId: string): Promise<OAuth2Client> {
  const service = createAdminClient();
  const { data: credential, error } = await service.from("oauth_credentials")
    .select("organization_id, profile_id, encrypted_refresh_token, encrypted_access_token, expires_at")
    .eq("profile_id", profileId)
    .eq("provider", "google")
    .maybeSingle();
  if (error || !credential) throw new Error("Google authorization is required before connecting a sheet.");

  const client = createGoogleOAuthClient();
  client.setCredentials({
    refresh_token: decryptSecret(credential.encrypted_refresh_token),
    access_token: credential.encrypted_access_token ? decryptSecret(credential.encrypted_access_token) : undefined,
    expiry_date: credential.expires_at ? Date.parse(credential.expires_at) : undefined,
  });
  return client;
}

export async function getAuthorizedGoogleClientForProfile(profileId: string): Promise<OAuth2Client> {
  return authorizedClientForProfile(profileId);
}

export async function getAuthorizedGoogleClient(connectionId: string): Promise<OAuth2Client> {
  const service = createAdminClient();
  const { data: connection, error } = await service.from("sheet_connections")
    .select("connected_by")
    .eq("id", connectionId)
    .maybeSingle();
  if (error || !connection) throw new Error("Google Sheet connection was not found.");
  return authorizedClientForProfile(connection.connected_by);
}
