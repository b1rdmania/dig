# Drum Pattern Lab — Handoff White Paper

**Status:** Planning / concept  
**Audience:** Founders, lead engineer, design partner  
**Last updated:** 2026-04-30  

This document captures the agreed product shape, technical direction, explicit **decision points** (options + recommendation where useful), and **open problems / research** for the next owner. It is not a build spec; it is a handoff artifact for prioritization and staffing.

---

## 1. Executive summary

**Drum Pattern Lab** (working name) is a browser-first experience centered on **curated drum patterns** tied to **genres, scenes, and historical “pocket” archetypes**. Users load or browse patterns, **edit** steps and feel, **layer** parts, swap **kits**, watch **playhead-led visualization**, and eventually **export** MIDI or connect to DAWs/controllers.

**Differentiation** is pedagogical and cultural: scene-specific **groove DNA** (swing, accent maps, grid habits), not a generic empty grid or a full DAW.

**Related assets in org:**

| Asset | Role |
|--------|------|
| **[b1rdmania/motif](https://github.com/b1rdmania/motif)** (Wario Synthesis Engine) | Prior art: MIDI retrieval/search, parse → normalized events, Web Audio playback, track→voice mapping. Reuse patterns; product scope differs. |
| **Dig** (`dig-baby-mvp`) | Postgres catalog (Discogs lineage), search, `enrich.scenes` / styles — **metadata and deep links**, not drum pattern storage. |

**Core technical bet:** Own a small **symbolic pattern format** (`PatternDocument`), schedule audio in the browser, integrate MIDI **import/export** early enough to avoid paint‑corner.

---

## 2. Problem statement

Producers and curious listeners lack a **low-friction, opinionated** place to:

- Learn how **different scenes** treat rhythm (e.g. swing, off-grid hats, ghost snares).
- **Remix** archetypal patterns without installing a DAW.
- **Hear** the same pattern through **different kits** to internalize timbre vs groove.

Existing tools cluster at two extremes: **sample marketplaces + static loops** and **full DAWs**. The gap is a **concise, visual, scene-aware drum lab**.

---

## 3. Product shape (phased)

### Phase 0 — Concept lock (this paper + schema sketch)

- `PatternDocument` v0.1 agreed.
- Content strategy and legal posture chosen (see §7).
- Phase 1 scope written in one page.

### Phase 1 — Toy (ship something shareable)

- Single pattern editor: step grid (and optional per-lane length).
- One kit backend (samples **or** synthesis — **decision required**, §6.1).
- Transport: play/stop, BPM, **groove preset** selector (named, not only raw %).
- **Visualizer:** playhead + triggered cells (minimum); optional simple spectrum/level from master bus.
- **Persistence:** local storage and/or **URL state** for sharing (no account required).

### Phase 2 — Lab

- **Layers:** multiple patterns, mute/solo, simple mix.
- **Pack browser:** genre/scene tags, load into editor.
- **Export:** download **Type 0/1 MIDI** with consistent drum map (§6.2).

### Phase 3 — Desk / live

- **Ableton-oriented export** (clip semantics, drum rack note layout — research).
- **MIDI clock / device I/O** where platforms allow.
- Optional: **Dig-linked** pack pages (“in the spirit of this scene / these releases”).

---

## 4. Technical architecture (high level)

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Pack / pattern  │────▶│ PatternDocument  │────▶│ Scheduler +     │
│ metadata (DB    │     │ (JSON canonical) │     │ Web Audio /     │
│ or static v1)   │     │                  │     │ kit backend     │
└─────────────────┘     └────────┬─────────┘     └────────┬────────┘
                                 │                         │
                                 ▼                         ▼
                        ┌──────────────────┐     ┌─────────────────┐
                        │ MIDI import/out  │     │ UI: grid, layers,│
                        │ (.mid ↔ doc)     │     │ playhead viz     │
                        └──────────────────┘     └─────────────────┘
```

**Suggested implementation stack (non-binding):** TypeScript, Vite or Next.js for UI, Web Audio API; MIDI libraries as in §5. **Backend optional** for Phase 1 if packs ship as static JSON + audio assets; **required** for search accounts, illegal-MIDI-harvesting avoidance, or analytics.

**Dig integration surface:** HTTP API + IDs (master/artist/style/scene) for **labels and links**, not for storing MIDI.

---

## 5. Canonical data: `PatternDocument` (v0.1 sketch)

*Purpose: single source of truth inside the app; MIDI and UI project from this.*

Proposed top-level fields (names illustrative):

| Field | Purpose |
|--------|---------|
| `version` | Schema version. |
| `bpm` | Global tempo; may allow per-pattern override later. |
| `timeSignature` | e.g. `4/4`; document odd-time policy. |
| `ticksPerStep` | Grid resolution (e.g. 16th = 4 steps per beat). |
| `lanes` | Ordered list: `id`, `name`, `midiNote` (GM drum map default). |
| `steps` | Per-lane: boolean or velocity array; optional **micro-offset ticks** for humanization. |
| `groove` | Reference to named preset + optional scalar overrides. |
| `metadata` | `title`, `packId`, `tags[]`, optional `digRefs[]` (discogs IDs only). |

**Handoff action:** Replace this sketch with a JSON Schema file in-repo once Phase 0 closes.

---

## 6. Decision points

Decisions below should be **resolved in order** where dependencies exist (e.g. licensing before pack production).

### 6.1 Kit backend: samples vs synthesis

| Option | Pros | Cons |
|--------|------|------|
| **Sample-based kits** (SFZ, one-shots) | Familiar sound; genre authenticity. | Asset size; licensing; voice loading latency. |
| **Synthesis-first** (noise + envelopes) | Small payload; Motif-like precedent for “chip” aesthetics. | Harder to match acoustic/recorded “scene” identity. |
| **Hybrid** | Flexibility. | Two code paths to maintain. |

**Recommendation:** Phase 1 **one curated sample kit** (minimal map) *or* one **synthetic 808-like kit** for speed — pick based on “authentic scene feel” vs “time to first demo.”

### 6.2 Drum MIDI map for export

| Option | Pros | Cons |
|--------|------|------|
| **General MIDI percussion** | Interoperable with Live drum racks, many hosts. | Some genres use non-GM layouts. |
| **Fixed internal map + GM export transform** | Single internal truth; conversion on export. | Must document mapping table. |

**Recommendation:** Internal lanes map to **GM** by default; document exceptions per pack if ever required.

### 6.3 Groove representation

| Option | Pros | Cons |
|--------|------|------|
| **Named presets only** | Simple; matches “genre lessons.” | Less power-user control. |
| **Global groove curve + per-hit offsets** | Expressive; unique feel. | Harder to author; needs tooling. |

**Recommendation:** Phase 1 **named presets + global intensity**; reserve per-hit offsets for Phase 2.

### 6.4 Where patterns live

| Option | Pros | Cons |
|--------|------|------|
| **Static JSON in repo / CDN** | Fastest MVP; no DB. | No dynamic catalog. |
| **New Postgres schema** (same or separate service) | Query, editorial workflow. | Ops cost. |
| **Dig DB extended** | One fleet. | Mixes editorial music data with catalog; only justified if product is Dig-native. |

**Recommendation:** **Static or tiny API for Phase 1**; add DB when editorial velocity demands it.

### 6.5 Legal / content sourcing

| Option | Pros | Cons |
|--------|------|------|
| **Original patterns only** | Clean rights. | No “iconic loop” claims without care. |
| **Licensed packs** | Marketing power. | Contract and cost. |
| **User-generated** | Scale. | Moderation; baseline quality. |

**Recommendation:** Ship **original archetype** patterns with clear **“inspired by X tradition”** copy; avoid implying unlicensed transcription of specific commercial recordings.

### 6.6 Org placement

| Option | Notes |
|--------|--------|
| **Standalone app/repo** | Clearest product boundary; Motif code copied or extracted as libs. |
| **Module under Dig** | Only if deep linking and shared auth/analytics are mandatory from day one. |

**Recommendation:** **Standalone** until Dig linkage is a primary funnel.

---

## 7. Open problems and research agenda

### 7.1 Product / design

- **Onboarding:** One-screen tutorial that teaches grid + groove without tooltip spam.
- **Layer UX:** How many layers before cognitive overload; per-layer length vs global bar.
- **Mobile:** Tap targets and iOS audio unlock (Motif already handled similar concerns — audit).
- **Share model:** URL length limits for full pattern state vs short IDs + server fetch.

### 7.2 Technical

- **Clock stability:** Tab background throttling; minimum viable **AudioWorklet** vs main-thread scheduling (benchmark).
- **Humanization:** Whether random jitter is **seeded** for reproducible shares.
- **Large kits:** Lazy loading, memory caps on mobile Safari.
- **MIDI import:** Cleaning **multi-track** MIDI into **single drum lane set**; channel 10 vs melodic tracks.

### 7.3 Export / interoperability

- **Ableton Live:** Test round-trip: export MIDI → Live drum rack → re-import; document note range and clip length.
- **Hardware:** Web MIDI output matrix (browser support + latency expectations).

### 7.4 Content / editorial

- **Taxonomy alignment:** Map packs to **Dig `styles` / `enrich.scenes`** where helpful, without over-claiming data lineage.
- **Quality bar:** How many patterns per scene for “credible” v1.

### 7.5 Open-source reconnaissance (non-exhaustive)

Tasks for engineering spike (1–2 days):

- Evaluate **@tonejs/midi** vs **midi-file** for R/W and bundle size.
- Scan **MIT/BSD** step-sequencer React components for grid UX only.
- If sample kits: SFZ player options in browser vs custom sampler.

*Outcome:* Short ADR list: chosen libs + rejected alternatives + license notes.

### 7.6 Competitive / market (optional research)

- Document 3–5 adjacent products (browser sequencers, learning apps, loop vendors) and **one-line differentiation**.

---

## 8. Risks

| Risk | Mitigation |
|------|------------|
| **IP / misleading association** | Original content; careful copy; no cover art / trademarks without rights. |
| **Scope creep toward DAW** | Phase gates in §3; “not v1” list in sprint briefs. |
| **Feel is “generic”** | Invest in groove presets + velocity sculpting per pack; user test with producers. |
| **Safari / mobile audio** | Early device matrix; reuse Motif lessons. |

---

## 9. Recommended immediate next steps (for the receiving team)

1. **Approve or edit** decision table §6 (especially 6.1, 6.4, 6.5, 6.6).  
2. **Freeze `PatternDocument` v0.1** as JSON Schema + one example file per envisioned genre.  
3. **Run OSS spike** §7.5; capture ADRs.  
4. **Produce Phase 1 one-pager** with explicit **out of scope** bullets.  
5. **Legal once-over** on pack copy and any MIDI sourced from third parties.

---

## 10. Document control

- **Authoring context:** Planning dialogue + public Motif README + Dig schema review (catalog ≠ rhythm data).  
- **Not in scope for this doc:** Budget, staffing, branding, domain name.  
- **Successor doc:** Implementation plan (`implementation-plan-drum-pattern-lab.md`) after §6 decisions close.

---

*End of handoff white paper.*
