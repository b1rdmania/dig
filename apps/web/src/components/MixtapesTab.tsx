"use client";

import { useState, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import styles from "./MixtapesTab.module.css";

const API_URL = process.env.NEXT_PUBLIC_DIG_API_URL ?? "https://dig-api.fly.dev";

interface Mixtape {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  track_count?: number;
}

interface Props {
  plan: string;
}

export function MixtapesTab({ plan }: Props) {
  const { getToken } = useAuth();
  const [mixtapes, setMixtapes] = useState<Mixtape[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isEarlyAccess = plan === "early_access" || plan === "team";

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
    } catch {
      // fail silently
    } finally {
      setLoading(false);
    }
  }, [loaded, loading, getToken]);

  // Load on first render (for early access users)
  if (!loaded && !loading && isEarlyAccess) {
    load();
  }

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
      if (!res.ok) {
        setError(data.error?.message ?? "Failed to create mixtape.");
        return;
      }
      if (data.mixtape) {
        setMixtapes((prev) => [data.mixtape!, ...(prev ?? [])]);
        setNewTitle("");
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setCreating(false);
    }
  }, [newTitle, getToken]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/v1/me/mixtapes/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok || res.status === 204) {
        setMixtapes((prev) => (prev ?? []).filter((m) => m.id !== id));
      }
    } catch {
      // fail silently
    }
  }, [getToken]);

  if (!isEarlyAccess) {
    return (
      <div className={styles.gated}>
        <p className={styles.gatedText}>Mixtapes are an Early Access feature.</p>
        <p className={styles.gatedSub}>Upgrade to create and export playlists to Spotify.</p>
      </div>
    );
  }

  return (
    <div className={styles.root}>
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
        <button
          type="button"
          className={styles.createBtn}
          onClick={handleCreate}
          disabled={creating || !newTitle.trim()}
        >
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
          {mixtapes.map((m) => (
            <li key={m.id} className={styles.item}>
              <div className={styles.itemInfo}>
                <span className={styles.itemTitle}>{m.title}</span>
                {m.track_count !== undefined && (
                  <span className={styles.itemMeta}>{m.track_count} track{m.track_count !== 1 ? "s" : ""}</span>
                )}
              </div>
              <button
                type="button"
                className={styles.deleteBtn}
                onClick={() => handleDelete(m.id)}
                aria-label={`Delete ${m.title}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className={styles.exportNote}>
        Spotify export coming soon.
      </p>
    </div>
  );
}
