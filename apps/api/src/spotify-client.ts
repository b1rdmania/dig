/**
 * Spotify Web API client.
 * Handles token refresh, search, playlist creation and population.
 */

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID ?? "";
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? "";
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI ?? "https://dig-api.fly.dev/v1/auth/spotify/callback";

export const SPOTIFY_SCOPES = "playlist-modify-public playlist-modify-private";

// ── OAuth helpers ─────────────────────────────────────────────────────────────

export function buildAuthUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: SPOTIFY_REDIRECT_URI,
    state,
    scope: SPOTIFY_SCOPES,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

export interface SpotifyTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  scope: string;
  token_type: string;
}

export async function exchangeCode(code: string, codeVerifier: string): Promise<SpotifyTokens> {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
      client_id: SPOTIFY_CLIENT_ID,
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Spotify token exchange failed: ${err}`);
  }
  return res.json() as Promise<SpotifyTokens>;
}

export async function refreshAccessToken(refreshToken: string): Promise<SpotifyTokens> {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: SPOTIFY_CLIENT_ID,
      client_secret: SPOTIFY_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Spotify token refresh failed: ${err}`);
  }
  return res.json() as Promise<SpotifyTokens>;
}

// ── API calls ─────────────────────────────────────────────────────────────────

export interface SpotifyTrack {
  id: string;
  name: string;
  uri: string;
  artists: Array<{ name: string }>;
  album: { name: string };
  popularity: number;
}

export interface SpotifySearchResult {
  tracks: {
    items: SpotifyTrack[];
  };
}

export async function searchTrack(
  accessToken: string,
  query: string,
): Promise<SpotifyTrack[]> {
  const params = new URLSearchParams({ q: query, type: "track", limit: "5" });
  const res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return [];
  const data = await res.json() as SpotifySearchResult;
  return data.tracks?.items ?? [];
}

export async function getSpotifyUserId(accessToken: string): Promise<string> {
  const res = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Failed to get Spotify user profile");
  const data = await res.json() as { id: string };
  return data.id;
}

export async function createPlaylist(
  accessToken: string,
  spotifyUserId: string,
  name: string,
  description = "Created with dig.baby",
): Promise<{ id: string; external_urls: { spotify: string } }> {
  const res = await fetch(`https://api.spotify.com/v1/users/${spotifyUserId}/playlists`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, description, public: false }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create Spotify playlist: ${err}`);
  }
  return res.json() as Promise<{ id: string; external_urls: { spotify: string } }>;
}

export async function addTracksToPlaylist(
  accessToken: string,
  playlistId: string,
  uris: string[],
): Promise<void> {
  // Spotify limits 100 tracks per request
  for (let i = 0; i < uris.length; i += 100) {
    const chunk = uris.slice(i, i + 100);
    const res = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uris: chunk }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to add tracks to Spotify playlist: ${err}`);
    }
  }
}
