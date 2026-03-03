# Dig Mobile App Technical White Paper (TestFlight -> App Store)

## 1) Thesis
Dig should launch mobile through TestFlight first, then App Store release after production hardening.
This minimizes rejection risk, validates real user behavior, and keeps architecture aligned with the existing API/MCP stack.

## 2) Current Platform Baseline
- Live backend: Fly-hosted REST API + MCP.
- Data scale: full Discogs-derived catalog, enrichment in progress.
- Live web UX: search, release/version pages, credits, media embeds, related artists.
- Core decision: mobile app should consume the same `/v1` contracts, no parallel logic.

## 3) Mobile Delivery Strategy
Recommended path:
1. Build native app shell with real native UX (not a webview wrapper).
2. Ship internal + external TestFlight.
3. Fix crash/latency/policy issues from beta.
4. Submit to App Store only after QA + compliance gates pass.

Why this path:
- Lower risk than direct store release.
- Faster feedback loop.
- Clear evidence for App Review readiness.

## 4) Recommended Technical Stack
Preferred:
- React Native + Expo (EAS Build) for speed and team leverage.
- TypeScript end-to-end.
- Existing REST API as source of truth.
- Optional MCP usage for advanced in-app agent features later.

Core app modules:
- Search
- Release page
- Version page
- Artist page
- Saved recent searches (local cache)
- Share/deep-link support

## 5) Architecture
Client:
- Native screens + navigation.
- Server-state cache (TanStack Query or equivalent).
- Local persistence for recents/favorites (no auth required v1).

Backend:
- Existing API unchanged.
- Add mobile-oriented endpoints only if needed for payload shaping.

Contracts:
- Reuse current response schemas.
- No divergence between web and mobile data semantics.

## 6) App Store Rejection Risk (Realistic)
Primary rejection risks:
1. App appears to be a thin web wrapper.
2. Instability (crashes, dead states, poor offline handling).
3. Privacy/compliance mismatch (policy text vs behavior).
4. In-app purchase policy issues (if paid digital features are added).

Mitigations:
- Native-first UI and navigation.
- Crash-free + load/error states for every critical screen.
- Accurate privacy policy + App Store metadata.
- Avoid paid digital features in v1 release.

## 7) Compliance Baseline
Before App Store submission:
- Public privacy policy URL.
- Data handling disclosure aligned with implementation.
- Account deletion flow only if accounts are introduced.
- Third-party content handling clearly attribution-based (links/embeds, not unlawful hosting).

## 8) TestFlight Plan
Phase A (Internal):
- Team smoke test core flows.
- Crash + API error telemetry.

Phase B (External):
- 50-200 focused testers.
- Structured bug template + triage SLA.
- Weekly release cadence.

Exit criteria to App Store:
- Crash-free sessions target met.
- p95 API latency acceptable on mobile networks.
- No P0/P1 blockers open.
- Policy checklist complete.

## 9) 4-Week Implementation Plan
Week 1:
- App scaffold, navigation, auth-less session model, API integration.

Week 2:
- Search + release/version + artist screens.
- Error/loading/offline states.

Week 3:
- Deep links, share, recents cache, telemetry.
- Internal TestFlight.

Week 4:
- External TestFlight, fixes, App Store assets/metadata prep.

## 10) Go/No-Go Gates
Go to TestFlight when:
- Core screens complete and stable.
- Telemetry and crash reporting live.
- Basic offline behavior acceptable.

Go to App Store when:
- Beta metrics stable.
- Compliance checklist complete.
- No major UX regressions from web baseline.

## 11) Non-Goals (v1 Mobile)
- Full marketplace.
- Heavy social layer.
- In-app paid tiers.
- LLM-proxy monetization stack.
