"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import styles from "./MixtapesTab.module.css";

const API_URL = process.env.NEXT_PUBLIC_DIG_API_URL ?? "https://dig-api.fly.dev";

interface Mixtape {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  track_count?: number;
}

interface ExportJob {
  id: string;
  status: "pending" | "running" | "succeeded" | "failed";
  platform_playlist_url: string | null;
  tracks_matched: number | null;
  tracks_total: number | null;
  error_message: string | null;
  track_results: Array<{
    name: string | null;
    artist: string | null;
    matched: boolean;
    match_confidence: number;
  }> | null;
}

interface SpotifyStatus {
  connected: boolean;
  enabled: boolean;
  scopes: string | null;
}

interface Props {
  plan: string;
}

export function MixtapesTab({ plan }: Props) {
  const { getToken } = useAuth();
  const searchParams = useSearchParams();
  const spotifyParam = searchParams.get("spotify");

  const [mixtapes, setMixtapes] = useState<Mixtape[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Spotify state
  const [spotifyStatus, setSpotifyStatus] = useState<SpotifyStatus | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  // Per-mixtape export jobs
  const [exportJobs, setExportJobs] = useState<Record<string, ExportJob>>({});
  const [exportingId, setExportingId] = useState<string | null>(null);
  const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const isEarlyAccess = plan === "early_access" || plan === "team";

  // Load mixtapes
  const load = useCallback(async () => {
    if (loaded || loading) return;
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/v1/me/mixtapes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json() as { mixtapes: Mixtape[] };
      setMixtapes(data.mixtapes ?? []);
      setLoaded(true);
    } catch { /* fail silently */ }
    finally { setLoading(false); }
  }, [loaded, loading, getToken]);

  // Load Spotify status
  const loadSpotifyStatus = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/v1/auth/spotify/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json() as SpotifyStatus;
      setSpotifyStatus(data);
    } catch { /* fail silently */ }
  }, [getToken]);

  useEffect(() => {
    if (!isEarlyAccess) return;
    load();
    loadSpotifyStatus();
  }, [isEarlyAccess]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload Spotify status after OAuth redirect
  useEffect(() => {
    if (spotifyParam === "connected") loadSpotifyStatus();
  }, [spotifyParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup polling on unmount
  useEffect(() => {
    const timers = pollTimers.current;
    return () => { Object.values(timers).forEach(clearInterval); };
  }, []);

  const handleCreate = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/v1/me/mixtapes`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const data = await res.json() as { mixtape?: Mixtape; error?: { message: string } };
      if (!res.ok) { setError(data.error?.message ?? "Failed to create mixtape."); return; }
      if (data.mixtape) { setMixtapes((prev) => [data.mixtape!, ...(prev ?? [])]); setNewTitle(""); }
    } catch { setError("Network error. Try again."); }
    finally { setCreating(false); }
  }, [newTitle, getToken]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/v1/me/mixtapes/${id}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok || res.status === 204) {
        setMixtapes((prev) => (prev ?? []).filter((m) => m.id !== id));
      }
    } catch { /* fail silently */ }
  }, [getToken]);

  const handleSpotifyConnect = useCallback(async () => {
    // OAuth redirect — needs backend to issue the auth URL redirect
    // We send user to the API endpoint which redirects to Spotify
    const token = await getToken();
    if (!token) return;
    // Open in same tab — backend will redirect back to /account?spotify=connected
    window.location.href = `${API_URL}/v1/auth/spotify?auth=${encodeURIComponent(token)}`;
  }, [getToken]);

  const handleSpotifyDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      const token = await getToken();
      if (!token) return;
      await fetch(`${API_URL}/v1/auth/spotify`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      setSpotifyStatus((prev) => prev ? { ...prev, connected: false } : null);
    } catch { /* fail silently */ }
    finally { setDisconnecting(false); }
  }, [getToken]);

  const pollJob = useCallback((mixtapeId: string, jobId: string) => {
    const timer = setInterval(async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${API_URL}/v1/me/mixtapes/${mixtapeId}/export/${jobId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json() as { job: ExportJob };
        setExportJobs((prev) => ({ ...prev, [mixtapeId]: data.job }));
        if (data.job.status === "succeeded" || data.job.status === "failed") {
          clearInterval(pollTimers.current[mixtapeId]);
          delete pollTimers.current[mixtapeId];
          setExportingId(null);
        }
      } catch { /* fail silently */ }
    }, 2000);
    pollTimers.current[mixtapeId] = timer;
  }, [getToken]);

  const handleExport = useCallback(async (mixtapeId: string) => {
    if (exportingId) return;
    setExportingId(mixtapeId);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/v1/me/mixtapes/${mixtapeId}/export`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ platform: "spotify" }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: { message: string; code: string } };
        const msg = data.error?.code === "SPOTIFY_NOT_CONNECTED"
          ? "Connect Spotify first."
          : (data.error?.message ?? "Export failed.");
        setExportJobs((prev) => ({
          ...prev,
          [mixtapeId]: { id: "", status: "failed", platform_playlist_url: null, tracks_matched: null, tracks_total: null, error_message: msg, track_results: null },
        }));
        setExportingId(null);
        return;
      }
      const data = await res.json() as { job: ExportJob };
      setExportJobs((prev) => ({ ...prev, [mixtapeId]: data.job }));
      pollJob(mixtapeId, data.job.id);
    } catch {
      setExportingId(null);
    }
  }, [exportingId, getToken, pollJob]);

  if (!isEarlyAccess) {
    return (
      <div className={styles.gated}>
        <p className={styles.gatedText}>Mixtapes are an Early Access feature.</p>
        <p className={styles.gatedSub}>Upgrade to create and save track collections.</p>
      </div>
    );
  }

  const spotifyEnabled = spotifyStatus?.enabled === true;

  return (
    <div className={styles.root}>
      {/* Spotify connect section */}
      {spotifyEnabled && (
        <div className={styles.spotifyBar}>
          {spotifyStatus?.connected ? (
            <>
              <span className={styles.spotifyConnected}>Spotify connected</span>
              <button
                type="button"
                className={styles.spotifyDisconnect}
                onClick={handleSpotifyDisconnect}
                disabled={disconnecting}
              >
                {disconnecting ? "Disconnecting..." : "Disconnect"}
              </button>
            </>
          ) : (
            <>
              <span className={styles.spotifyNote}>Connect Spotify to export mixtapes</span>
              <button type="button" className={styles.spotifyConnect} onClick={handleSpotifyConnect}>
                Connect Spotify
              </button>
            </>
          )}
        </div>
      )}

      {/* OAuth redirect feedback */}
      {spotifyParam === "connected" && <p className={styles.spotifySuccess}>Spotify connected.</p>}
      {spotifyParam === "cancelled" && <p className={styles.spotifyNote}>Spotify connection cancelled.</p>}
      {spotifyParam === "error" && <p className={styles.spotifyError}>Spotify connection failed. Try again.</p>}

      {/* Create form */}
      <div className={styles.createRow}>
        <input
          type="text"
          className={styles.input}
          placeholder="New mixtape title..."
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
          maxLength={200}
        />
        <button type="button" className={styles.createBtn} onClick={handleCreate} disabled={creating || !newTitle.trim()}>
          {creating ? "Creating..." : "Create"}
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}

      {loading && <p className={styles.loading}>Loading...</p>}
      {!loading && mixtapes !== null && mixtapes.length === 0 && (
        <p className={styles.empty}>No mixtapes yet. Create one above.</p>
      )}

      {mixtapes && mixtapes.length > 0 && (
        <ul className={styles.list}>
          {mixtapes.map((m) => {
            const job = exportJobs[m.id];
            const isExporting = exportingId === m.id || job?.status === "pending" || job?.status === "running";
            const unmatched = job?.track_results?.filter((t) => !t.matched) ?? [];

            return (
              <li key={m.id} className={styles.item}>
                <div className={styles.itemMain}>
                  <div className={styles.itemInfo}>
                    <span className={styles.itemTitle}>{m.title}</span>
                    {m.track_count !== undefined && (
                      <span className={styles.itemMeta}>{m.track_count} track{m.track_count !== 1 ? "s" : ""}</span>
                    )}
                  </div>
                  <div className={styles.itemActions}>
                    {spotifyEnabled && spotifyStatus?.connected && (
                      <button
                        type="button"
                        className={styles.exportBtn}
                        onClick={() => handleExport(m.id)}
                        disabled={!!exportingId}
                      >
                        {isExporting ? "Exporting..." : "→ Spotify"}
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.deleteBtn}
                      onClick={() => handleDelete(m.id)}
                      aria-label={`Delete ${m.title}`}
                    >
                      ×
                    </button>
                  </div>
                </div>

                {/* Export status */}
                {job && (
                  <div className={styles.jobStatus}>
                    {(job.status === "pending" || job.status === "running") && (
                      <span className={styles.jobPending}>Exporting…</span>
                    )}
                    {job.status === "succeeded" && (
                      <span className={styles.jobDone}>
                        {job.tracks_matched}/{job.tracks_total} tracks matched
                        {job.platform_playlist_url && (
                          <> · <a href={job.platform_playlist_url} target="_blank" rel="noreferrer" className={styles.playlistLink}>Open playlist</a></>
                        )}
                      </span>
                    )}
                    {job.status === "succeeded" && unmatched.length > 0 && (
                      <details className={styles.unmatchedDetails}>
                        <summary className={styles.unmatchedSummary}>{unmatched.length} unmatched track{unmatched.length !== 1 ? "s" : ""}</summary>
                        <ul className={styles.unmatchedList}>
                          {unmatched.map((t, i) => (
                            <li key={i} className={styles.unmatchedItem}>
                              {t.artist ? `${t.artist} — ` : ""}{t.name ?? "Unknown"}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {job.status === "failed" && (
                      <span className={styles.jobFailed}>{job.error_message ?? "Export failed."}</span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
