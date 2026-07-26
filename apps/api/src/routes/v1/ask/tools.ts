// ---------------------------------------------------------------------------
// Tool definitions + executor — wired to @dig/domain
// ---------------------------------------------------------------------------

import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import {
  search,
  getArtist,
  getLabel,
  getMaster,
  getArtistMasters,
  getLabelReleases,
  getBatchForTable,
  listScenes,
  getScene,
  getLabelCoreRun,
  getLabelRelated,
  getArtistRuleACredits,
  getArtistCollaborators,
  getArtistGroupsAndMembers,
} from "@dig/domain";
import type { MediaItem, EvidenceItem } from "./types.js";
import { isAllowedMasterId, INVALID_MASTER_ID_ERROR } from "./binding.js";

export const TOOLS = [
  {
    name: "search_catalog",
    description:
      "Search the Dig scene-scoped catalog (house/techno masters 1988–2008, plus their artists and labels). Use to find artists, labels, or masters by name, genre, style, or keywords. Returns matching entities with IDs you can use in follow-up calls.",
    input_schema: {
      type: "object" as const,
      properties: {
        q: { type: "string", description: "Search query — artist name, master title, label, genre term, etc." },
        type: {
          type: "string",
          enum: ["artist", "label", "master"],
          description: "Filter to a specific entity type. Omit to search masters (the default).",
        },
        genre: { type: "string", description: "Filter by genre (e.g. 'House', 'Techno', 'Electronic')" },
        limit: { type: "number", description: "Results to return (1–10, default 8)" },
      },
      required: ["q"],
    },
  },
  {
    name: "get_artist",
    description:
      "Get full details for an artist by Discogs ID: name, aliases, genres, styles, biography. Use after search_catalog returns an artist ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        discogs_id: { type: "number", description: "Discogs artist ID (from search results)" },
      },
      required: ["discogs_id"],
    },
  },
  {
    name: "get_label",
    description:
      "Get full details for a record label by Discogs ID: parent label, sublabels, profile, editorial tier (tier1 means a canonical scene label like Tresor or Warp).",
    input_schema: {
      type: "object" as const,
      properties: {
        discogs_id: { type: "number", description: "Discogs label ID (from search results)" },
      },
      required: ["discogs_id"],
    },
  },
  {
    name: "get_master",
    description:
      "Get full details for a master release by Discogs ID: tracklist, primary artist, primary label, year, genres, styles, scene_weight (curation score), and YouTube videos. The master is the canonical recording.",
    input_schema: {
      type: "object" as const,
      properties: {
        discogs_id: { type: "number", description: "Discogs master ID (from search results)" },
      },
      required: ["discogs_id"],
    },
  },
  {
    name: "get_artist_masters",
    description:
      "Get an artist's catalog of masters in the scene — albums, EPs, singles. Always try this first for any artist catalog query. Returns titles, years, and Dig URLs you should link.",
    input_schema: {
      type: "object" as const,
      properties: {
        discogs_id: { type: "number", description: "Discogs artist ID" },
        release_type: {
          type: "string",
          enum: ["album", "single_ep", "compilation", "all"],
          description: "Filter by type. Use 'album' for main studio releases, 'all' for everything. Default: 'all'.",
        },
        limit: { type: "number", description: "Number of masters to return (1–20, default 12)" },
      },
      required: ["discogs_id"],
    },
  },
  {
    name: "get_label_releases",
    description:
      "Get masters released on a specific label — useful for 'what's on Warp Records' or 'show me the Tresor catalog'. Returns titles, primary artists, years. Prefer get_label_essentials first; fall back here if essentials are empty or you need the wider catalog.",
    input_schema: {
      type: "object" as const,
      properties: {
        discogs_id: { type: "number", description: "Discogs label ID" },
        limit: { type: "number", description: "Number of masters (1–20, default 15)" },
      },
      required: ["discogs_id"],
    },
  },
  {
    name: "get_label_essentials",
    description:
      "The most opinionated 'what's good here and what's nearby' tool. Returns a label's curated Core Run (essential masters everyone should hear, ranked) plus its directional related labels (deeper / harder / rawer / cleaner / weirder / poppier / earlier / later). Use this BEFORE get_label_releases for any 'what should I listen to from label X' question.",
    input_schema: {
      type: "object" as const,
      properties: {
        discogs_id: { type: "number", description: "Discogs label ID (from search_catalog)" },
      },
      required: ["discogs_id"],
    },
  },
  {
    name: "list_scenes",
    description:
      "List all 15 curated scenes (Detroit Core, Berlin Techno, Chicago House, Dub Techno, Cologne Minimal, etc.). Returns slug, name, axis (geography/sound/era/cluster/bridge/micro), city, era window, and blurb. Use this to find a scene slug before calling get_scene.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_scene",
    description:
      "Get full detail for one curated scene by slug: member labels (with role: core/adjacent/bridge), bridges to other scenes, palette, blurb. Use after list_scenes to drill into a specific scene.",
    input_schema: {
      type: "object" as const,
      properties: {
        slug: {
          type: "string",
          description: "Scene slug (e.g. 'detroit-core', 'berlin-techno', 'dub-techno', 'chicago-house')",
        },
      },
      required: ["slug"],
    },
  },
  {
    name: "get_artist_credits",
    description:
      "An artist's credit work on in-scope masters — remixes, production, mixing, writing, engineering — including credits under their aliases. One row per master with roles and per-track lines. role accepts a family (remix, produce, mix, master, write, vocal, engineer) or an exact role. With role=remix, masters where the artist is the headline act are excluded, so the result is 'remixes they did for OTHERS'. The tool for 'what did X remix' and for going deeper on an artist's fingerprints.",
    input_schema: {
      type: "object" as const,
      properties: {
        discogs_id: { type: "number", description: "Discogs artist ID" },
        role: { type: "string", description: "Role family (remix, produce, mix, master, write, vocal, engineer) or exact role. Omit for all." },
        limit: { type: "number", description: "Max masters (1–50, default 20)" },
      },
      required: ["discogs_id"],
    },
  },
  {
    name: "get_artist_collaborators",
    description:
      "An artist's closest collaborators from the credit graph: people who appear on the same in-scope masters (across all the artist's aliases), with shared-record counts and roles. The tool for 'who did X work with' and for finding allied names to dig into.",
    input_schema: {
      type: "object" as const,
      properties: {
        discogs_id: { type: "number", description: "Discogs artist ID" },
        limit: { type: "number", description: "Max collaborators (1–30, default 10)" },
      },
      required: ["discogs_id"],
    },
  },
  {
    name: "get_artist_groups",
    description:
      "An artist's group/member edges: groups they belong to, members (if the artist IS a group), and bandmates — each with in-scope master counts. The tool for aliases and 'is X part of Y' (e.g. Fingers Inc. ↔ Larry Heard).",
    input_schema: {
      type: "object" as const,
      properties: {
        discogs_id: { type: "number", description: "Discogs artist ID" },
      },
      required: ["discogs_id"],
    },
  },
];

const YT_RE = /^[A-Za-z0-9_-]{11}$/;
function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") {
      const id = u.pathname.slice(1);
      return YT_RE.test(id) ? id : null;
    }
    if (u.hostname.endsWith("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v && YT_RE.test(v)) return v;
    }
    return null;
  } catch { return null; }
}

export async function executeTool(
  db: Kysely<Database>,
  name: string,
  input: Record<string, unknown>,
  mediaCollector: MediaItem[],
  evidenceCollector: EvidenceItem[],
  errorRef: { count: number },
  allowedMasterIds: Set<number>,
): Promise<unknown> {
  try {
    if (name === "search_catalog") {
      const q = String(input.q ?? "").slice(0, 200);
      const type = input.type as any;
      const genre = input.genre ? String(input.genre) : undefined;
      const limit = Math.min(Math.max(Number(input.limit ?? 8), 1), 10);
      const sr = await search(db, { q, type, genre, limit, quality: "all" });
      for (const r of sr.results.slice(0, 3)) {
        const entityType = r.type === "master" ? "master" : r.type === "artist" ? "artist" : "label";
        const path = r.type === "master" ? "master" : r.type === "artist" ? "artist" : "label";
        evidenceCollector.push({ type: entityType as any, discogs_id: r.discogs_id, title: r.name ?? r.title ?? "", dig_url: `https://app.dig.baby/${path}/${r.discogs_id}` });
        if (r.type === "master") allowedMasterIds.add(r.discogs_id);
      }
      return {
        results: sr.results.map((r) => ({
          type: r.type,
          discogs_id: r.discogs_id,
          name: r.name ?? r.title,
          year: r.year,
        })),
        total: sr.results.length,
        hint: sr.meta.hint ?? undefined,
      };
    }

    if (name === "get_artist") {
      const id = Number(input.discogs_id);
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.artists");
      const d = await getArtist(db, id, batchId, dumpDate) as any;
      if (!d) { errorRef.count++; return { error: "Artist not found" }; }
      evidenceCollector.push({ type: "artist", discogs_id: d.discogs_id, title: d.name, dig_url: `https://app.dig.baby/artist/${d.discogs_id}` });
      return {
        discogs_id: d.discogs_id,
        name: d.name,
        real_name: d.real_name ?? null,
        genres: d.genres ?? [],
        styles: d.styles ?? [],
        aliases: d.aliases?.map((a: any) => a.name) ?? [],
        profile: d.profile ? String(d.profile).slice(0, 600) : null,
        dig_url: `https://app.dig.baby/artist/${d.discogs_id}`,
      };
    }

    if (name === "get_label") {
      const id = Number(input.discogs_id);
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.labels");
      const d = await getLabel(db, id, batchId, dumpDate) as any;
      if (!d) { errorRef.count++; return { error: "Label not found" }; }
      evidenceCollector.push({ type: "label", discogs_id: d.discogs_id, title: d.name, dig_url: `https://app.dig.baby/label/${d.discogs_id}` });
      return {
        discogs_id: d.discogs_id,
        name: d.name,
        parent_label: d.parent_label?.name ?? null,
        sublabels: d.sublabels?.map((s: any) => s.name).slice(0, 10) ?? [],
        tier: d.tier ?? null,
        profile: d.profile ? String(d.profile).slice(0, 600) : null,
        dig_url: `https://app.dig.baby/label/${d.discogs_id}`,
      };
    }

    if (name === "get_master") {
      const id = Number(input.discogs_id);
      // Server-side guard: reject if this ID was never established as a master ID
      if (!isAllowedMasterId(allowedMasterIds, id)) {
        return { error: INVALID_MASTER_ID_ERROR };
      }
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.masters");
      const d = await getMaster(db, id, batchId, dumpDate) as any;
      if (!d) { errorRef.count++; return { error: "Master not found" }; }

      evidenceCollector.push({ type: "master", discogs_id: d.discogs_id, title: d.title, dig_url: `https://app.dig.baby/master/${d.discogs_id}` });

      // Collect YouTube videos
      const artistName = d.primary_artist?.name ?? d.artists?.[0]?.name ?? "Unknown";
      for (const v of (d.videos ?? []).slice(0, 3)) {
        if (v?.url && extractYouTubeId(v.url)) {
          mediaCollector.push({
            discogs_id: d.discogs_id,
            title: v.title ?? d.title,
            artist: artistName,
            youtube_url: v.url,
          });
        }
      }

      return {
        discogs_id: d.discogs_id,
        title: d.title,
        year: d.year,
        primary_artist: d.primary_artist?.name ?? null,
        primary_label: d.primary_label?.name ?? null,
        artists: d.artists?.map((a: any) => a.name) ?? [],
        genres: d.genres ?? [],
        styles: d.styles ?? [],
        scene_weight: d.scene_weight ?? null,
        tracklist: d.tracklist?.slice(0, 20).map((t: any) => ({
          position: t.position,
          title: t.title,
          duration: t.duration ?? null,
        })) ?? [],
        notes: d.notes ? String(d.notes).slice(0, 300) : null,
        has_video: mediaCollector.some((m) => m.discogs_id === d.discogs_id),
        dig_url: `https://app.dig.baby/master/${d.discogs_id}`,
      };
    }

    if (name === "get_artist_masters") {
      const id = Number(input.discogs_id);
      const releaseType = (input.release_type as any) ?? "all";
      const limit = Math.min(Math.max(Number(input.limit ?? 12), 1), 20);
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.master_artists");
      const result = await getArtistMasters(db, id, batchId, dumpDate, limit, undefined, "oldest", releaseType);
      const masters = result.links.map((l: any) => ({
        discogs_id: l.discogs_id,
        title: l.title,
        year: l.year ?? null,
        type: l.release_type_label ?? l.release_type ?? null,
        dig_url: `https://app.dig.baby/master/${l.discogs_id}`,
      }));
      for (const m of masters.slice(0, 5)) {
        evidenceCollector.push({ type: "master", discogs_id: m.discogs_id, title: m.title, dig_url: m.dig_url });
        allowedMasterIds.add(m.discogs_id);
      }

      // Auto-collect videos from top masters so videos appear without requiring an explicit get_master call
      const top = masters.slice(0, 3);
      await Promise.all(top.map(async (m) => {
        try {
          const { batchId: mb, dumpDate: md } = await getBatchForTable(db, "catalog.masters");
          const detail = await getMaster(db, m.discogs_id, mb, md) as any;
          if (!detail) return;
          const artistName = detail.primary_artist?.name ?? detail.artists?.[0]?.name ?? m.title;
          for (const v of (detail.videos ?? []).slice(0, 2)) {
            if (v?.url && extractYouTubeId(v.url)) {
              mediaCollector.push({ discogs_id: m.discogs_id, title: v.title ?? m.title, artist: artistName, youtube_url: v.url });
            }
          }
        } catch { /* fail open */ }
      }));

      return {
        masters,
        total: result.pagination.total_estimate ?? result.links.length,
        has_more: result.pagination.has_more,
        note: masters.length === 0
          ? "No masters found in scope. Try searching by label name, or check if this artist falls outside the 1988–2008 house/techno scene."
          : undefined,
      };
    }

    if (name === "get_label_releases") {
      const id = Number(input.discogs_id);
      const limit = Math.min(Math.max(Number(input.limit ?? 15), 1), 20);
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.labels");
      const result = await getLabelReleases(db, id, batchId, dumpDate, limit) as any;
      const labelMasters = (result.links ?? []).map((l: any) => ({
        discogs_id: l.discogs_id,
        title: l.title,
        year: l.year ?? null,
        artist: l.artist ?? null,
        dig_url: `https://app.dig.baby/master/${l.discogs_id}`,
      }));
      for (const r of labelMasters.slice(0, 3)) {
        evidenceCollector.push({ type: "master", discogs_id: r.discogs_id, title: r.title, dig_url: r.dig_url });
        allowedMasterIds.add(r.discogs_id);
      }
      return {
        masters: labelMasters,
        total: result.pagination?.total_estimate ?? (result.links?.length ?? 0),
        has_more: result.pagination?.has_more ?? false,
      };
    }

    if (name === "get_label_essentials") {
      const id = Number(input.discogs_id);
      const [coreRun, related] = await Promise.all([
        getLabelCoreRun(db, id, 10),
        getLabelRelated(db, id),
      ]);

      // Establish all core_run masters as cite-able and pre-fetch videos so
      // they're available if the model decides to mention them.
      for (const m of coreRun) {
        allowedMasterIds.add(m.master_discogs_id);
        evidenceCollector.push({
          type: "master",
          discogs_id: m.master_discogs_id,
          title: m.title,
          dig_url: `https://app.dig.baby/master/${m.master_discogs_id}`,
        });
      }
      const top = coreRun.slice(0, 5);
      await Promise.all(top.map(async (m) => {
        try {
          const { batchId: mb, dumpDate: md } = await getBatchForTable(db, "catalog.masters");
          const detail = await getMaster(db, m.master_discogs_id, mb, md) as any;
          if (!detail) return;
          const artistName = detail.primary_artist?.name ?? m.primary_artist_name ?? m.title;
          for (const v of (detail.videos ?? []).slice(0, 2)) {
            if (v?.url && extractYouTubeId(v.url)) {
              mediaCollector.push({
                discogs_id: m.master_discogs_id,
                title: v.title ?? m.title,
                artist: artistName,
                youtube_url: v.url,
              });
            }
          }
        } catch { /* fail open */ }
      }));

      return {
        label_id: id,
        core_run: coreRun.map((m) => ({
          master_discogs_id: m.master_discogs_id,
          title: m.title,
          year: m.year,
          primary_artist: m.primary_artist_name,
          source: m.source,
          note: m.note,
          dig_url: `https://app.dig.baby/master/${m.master_discogs_id}`,
        })),
        related: related.map((r) => ({
          to_label_id: r.to_label_id,
          to_label_name: r.to_label_name,
          direction: r.direction,
          blurb: r.blurb,
          master_count: r.to_label_master_count,
          dig_url: `https://app.dig.baby/label/${r.to_label_id}`,
        })),
        note: coreRun.length === 0
          ? "No curated core run for this label yet — fall back to get_label_releases."
          : undefined,
      };
    }

    if (name === "list_scenes") {
      const { batchId } = await getBatchForTable(db, "catalog.masters");
      const scenes = await listScenes(db, batchId);
      return {
        scenes: scenes.map((s) => ({
          slug: s.slug,
          name: s.name,
          axis: s.axis,
          city: s.city,
          era:
            s.era_start && s.era_end
              ? `${s.era_start}-${s.era_end}`
              : s.era_start
              ? `${s.era_start}-`
              : null,
          blurb: s.blurb,
          label_count: s.label_count,
          dig_url: `https://app.dig.baby/scene/${s.slug}`,
        })),
        total: scenes.length,
      };
    }

    if (name === "get_scene") {
      const slug = String(input.slug ?? "").trim().slice(0, 80);
      if (!slug) { errorRef.count++; return { error: "Scene slug required" }; }
      const { batchId } = await getBatchForTable(db, "catalog.masters");
      const scene = await getScene(db, slug, batchId);
      if (!scene) { errorRef.count++; return { error: `Scene not found: ${slug}` }; }

      // Register member labels as cite-able evidence so the model's links validate.
      for (const l of scene.labels.slice(0, 12)) {
        evidenceCollector.push({
          type: "label",
          discogs_id: l.discogs_id,
          title: l.name,
          dig_url: `https://app.dig.baby/label/${l.discogs_id}`,
        });
      }

      return {
        slug: scene.slug,
        name: scene.name,
        axis: scene.axis,
        city: scene.city,
        era:
          scene.era_start && scene.era_end
            ? `${scene.era_start}-${scene.era_end}`
            : scene.era_start
            ? `${scene.era_start}-`
            : null,
        blurb: scene.blurb,
        labels: scene.labels.map((l) => ({
          discogs_id: l.discogs_id,
          name: l.name,
          role: l.role,
          master_count: l.master_count,
          dig_url: `https://app.dig.baby/label/${l.discogs_id}`,
        })),
        bridges_out: scene.bridges_out.map((b) => ({
          to_slug: b.to_slug,
          via_kind: b.via_kind,
          via: b.via_name,
          blurb: b.blurb,
        })),
        bridges_in: scene.bridges_in.map((b) => ({
          from_slug: b.from_slug,
          via_kind: b.via_kind,
          via: b.via_name,
          blurb: b.blurb,
        })),
        dig_url: `https://app.dig.baby/scene/${scene.slug}`,
      };
    }

    if (name === "get_artist_credits") {
      const id = Number(input.discogs_id);
      const role = input.role ? String(input.role) : null;
      const limit = Math.min(Math.max(Number(input.limit ?? 20), 1), 50);
      const { batchId } = await getBatchForTable(db, "catalog.masters");
      const isRemixRole = (role ?? "").toLowerCase() === "remix";
      const result = await getArtistRuleACredits(db, id, batchId, {
        limit,
        roleFilter: role,
        includeAliases: true,
        excludeSelfPrimary: isRemixRole,
      });
      for (const l of result.links.slice(0, 20)) {
        allowedMasterIds.add(l.master_discogs_id);
        evidenceCollector.push({
          type: "master",
          discogs_id: l.master_discogs_id,
          title: l.master_title ?? `Master ${l.master_discogs_id}`,
          dig_url: `https://app.dig.baby/master/${l.master_discogs_id}`,
        });
      }
      return {
        credits: result.links.map((l) => ({
          master_discogs_id: l.master_discogs_id,
          title: l.master_title,
          year: l.master_year,
          primary_artist: l.primary_artist_name,
          primary_label: l.primary_label_name,
          roles: l.roles,
          dig_url: `https://app.dig.baby/master/${l.master_discogs_id}`,
        })),
        has_more: result.pagination?.has_more ?? false,
      };
    }

    if (name === "get_artist_collaborators") {
      const id = Number(input.discogs_id);
      const limit = Math.min(Math.max(Number(input.limit ?? 10), 1), 30);
      const { batchId } = await getBatchForTable(db, "catalog.masters");
      const result = await getArtistCollaborators(db, id, batchId, { limit });
      return {
        collaborators: result.collaborators.map((c) => ({
          discogs_id: c.discogs_id,
          name: c.name,
          masters_together: c.masters_together,
          roles: c.roles,
          dig_url: `https://app.dig.baby/artist/${c.discogs_id}`,
        })),
      };
    }

    if (name === "get_artist_groups") {
      const id = Number(input.discogs_id);
      const { batchId } = await getBatchForTable(db, "catalog.masters");
      const result = await getArtistGroupsAndMembers(db, id, batchId);
      const edge = (e: { discogs_id: number; name: string | null; master_count: number }) => ({
        discogs_id: e.discogs_id,
        name: e.name,
        master_count: e.master_count,
        dig_url: `https://app.dig.baby/artist/${e.discogs_id}`,
      });
      return {
        groups: result.groups.map(edge),
        members: result.members.map(edge),
        bandmates: result.bandmates.map(edge),
      };
    }

    errorRef.count++;
    return { error: `Unknown tool: ${name}` };
  } catch (err: any) {
    errorRef.count++;
    return { error: String(err?.message ?? err) };
  }
}
