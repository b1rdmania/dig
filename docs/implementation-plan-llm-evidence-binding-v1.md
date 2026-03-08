# Implementation Plan: LLM Evidence Binding v1 (No Random Media / No Unsupported Claims)

Date: 2026-03-08
Owner: API/Web LLM agent
Priority: P0 trust + correctness
Status: Ready

## 1) Problem
Current LLM output can drift from retrieved evidence:
- unsupported claims in prose
- recommendations not deterministically resolved to Dig entities
- media rail showing unrelated videos

Observed case:
- Italian house / Flying Records prompt chain returned unrelated Shy FX / Ry Cooder / Frente videos while discussing different releases.

This is a binding/orchestration problem, not only prompt quality.

## 2) Objective
Make `/v1/ask` outputs strictly evidence-bound.

Guarantees:
1. Every factual claim is traceable to retrieved evidence.
2. Every media item is bound to an evidence entity (`source_type`, `source_discogs_id`).
3. If media cannot be verified for selected entities, return no media.
4. No speculative prose that implies verified catalog state without evidence.

## 3) Response Contract (extend existing)
Add/require fields:
- `mode`: `grounded_success | grounded_empty | timeout_degraded | upstream_error`
- `answer`
- `evidence[]`
  - `id` (local evidence id)
  - `entity_type` (`artist|label|master|release|version`)
  - `discogs_id`
  - `title_or_name`
  - `dig_url`
  - `confidence` (`verified|partial|unresolved`)
- `media[]`
  - `youtube_url`
  - `title`
  - `source_evidence_id`
  - `source_type`
  - `source_discogs_id`

Hard rule:
- `media[*].source_evidence_id` must exist in `evidence[]`.

## 4) Pipeline Changes

## 4.1 Candidate graph
Track all retrieved entities in a normalized graph:
- node key: `type:id`
- edges: derived from tool calls (label->release, release->master, master->videos)

## 4.2 Evidence selection
Before answer generation, build a final `selected_evidence` list:
- only nodes directly relevant to query intent
- dedupe by canonical key
- assign confidence

## 4.3 Media binding
Media resolver may only query videos for `selected_evidence` nodes.
Allowed paths:
- master -> videos
- release/version -> videos directly where available

Forbidden:
- broad fallback search disconnected from selected evidence
- label-wide random media pull

If no bound media found:
- return `media: []`
- answer must say "no verified media found for these results"

## 4.4 Claim guard
Introduce post-composition validator:
- if answer references entity not in `selected_evidence`, strip/replace with safe fallback
- if answer contains certainty phrases while `confidence=partial/unresolved`, downgrade language

## 5) Prompt Contract (supporting, not primary)
System prompt should state:
1. never assert details not present in evidence payload
2. never mention inability to browse URLs (assistant works from Dig retrieval)
3. separate verified vs unresolved findings explicitly

Note: prompt is secondary; hard validators enforce correctness.

## 6) Query Strategy for niche discovery prompts
For prompts like "Italian house, dub/paradise, 1994, obscure labels":

1. Resolve label(s)
2. Fetch label releases/versions
3. Resolve to masters where possible
4. Attach videos only from resolved releases/masters
5. Return two blocks internally:
- `verified_matches` (high confidence, optional media)
- `catalog_candidates_unverified`

LLM can discuss both, but must label uncertainty.

## 7) UI Changes (`llm-beta`)
Show sections:
1. Verified results
2. Unresolved candidates
3. Media (verified only)

Optional badges:
- `Verified`
- `Partial`
- `Unresolved`

Never render media rail if media binding validation fails.

## 8) Validation Rules (must implement)

Rule A: Evidence binding
- all media entries must reference valid evidence id

Rule B: Entity consistency
- all answer-linked Dig URLs must map to evidence entries

Rule C: No orphan media
- no media item without source entity metadata

Rule D: Mode integrity
- `grounded_success` requires evidence length > 0
- `grounded_empty` requires evidence length = 0 and no retrieval errors

## 9) Tests

## 9.1 Unit tests
- media binding validator
- claim-to-evidence validator

## 9.2 Integration tests
- replay failing transcript (Flying/Italian house)
- assert no unrelated media entities in output
- assert mode correctness

## 9.3 Property tests
- for random prompts, verify media sources subset of evidence set

## 9.4 Canary entities
Include:
- Kasra V (`4506398`)
- Version `9267745`
- Known media-rich master
- Label-heavy niche query path

## 10) Rollout Plan
1. Implement validators + response schema (behind flag)
2. Run transcript replay tests
3. Enable on beta LLM page only
4. Monitor 24h:
- mismatch rate
- zero-media rate
- user correction rate
5. Remove flag when mismatch rate is effectively zero

## 11) Metrics to track
- `llm_media_binding_fail`
- `llm_claim_validation_fail`
- `llm_mode_grounded_success_rate`
- `llm_unresolved_candidate_rate`

Expose in Usage V2 internal panel.

## 12) Commands
```bash
git checkout -b codex/llm-evidence-binding-v1
npx -y pnpm@10.27.0 --filter @dig/api typecheck
npx -y pnpm@10.27.0 --filter @dig/api test
npx -y pnpm@10.27.0 --filter @dig/web typecheck
npx -y pnpm@10.27.0 --filter @dig/web build
```

Deploy:
```bash
fly deploy --config fly.api.toml --remote-only
fly deploy --config fly.web.toml --remote-only
```

## 13) Acceptance Criteria
1. No unrelated media appears in replay transcript scenario.
2. No unsupported factual claims in grounded_success responses.
3. Every media item references a returned evidence entity.
4. User sees explicit verified/unresolved distinction for thin queries.

## 14) Out of Scope
- ranking quality of niche recommendations
- full semantic music ontology enrichment

## 15) Done Definition
Trust bug is closed when LLM cannot output random media or unsupported claims by construction, not by prompt luck.
