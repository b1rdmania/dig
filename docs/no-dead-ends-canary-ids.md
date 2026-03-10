# No-Dead-Ends Canary ID Set v1

Date: 2026-03-07

These IDs are fixed reference points for automated dead-end detection.
Do not remove IDs from this list — add new ones instead.

---

## Artists (20)

### Primary / release-heavy
| ID | Name | Notes |
|----|------|-------|
| 3840 | Radiohead | Masters + releases expected |
| 28795 | Prince | Large catalog |
| 38863 | Aretha Franklin | Large catalog |
| 45 | Aphex Twin | Electronic, many releases |
| 1 | The Persuader | Small but valid |

### Credits / writer / producer heavy
| ID | Name | Notes |
|----|------|-------|
| 769196 | Tommy Danvers | Known dead end — writer/arranger only, no primary masters |
| 157579 | Diane Warren | Songwriter, credits-only expected |
| 4205 | Giorgio Moroder | Producer/composer |
| 49758 | Nile Rodgers | Songwriter/producer |
| 4190593 | Max Martin | Songwriter/producer |
| 68211 | Rick Rubin | Producer |
| 17546 | Quincy Jones | Producer/arranger |

### Edge cases
| ID | Name | Notes |
|----|------|-------|
| 100 | Sample artist | Small entity, may be sparse |
| 500 | Sample artist | Mid-range ID |
| 1000 | Sample artist | Mid-range ID |
| 5000 | Sample artist | Mid-range ID |
| 10000 | Sample artist | Mid-range ID |
| 50000 | Sample artist | Mid-range ID |
| 100000 | Sample artist | Mid-range ID |
| 200000 | Sample artist | Mid-range ID |

---

## Labels (10)

| ID | Notes |
|----|-------|
| 1 | Small label |
| 100 | Mid-range |
| 500 | Mid-range |
| 1000 | Mid-range |
| 5000 | Mid-range |
| 10000 | Mid-range |
| 50000 | Mid-range |
| 100000 | Mid-range |
| 500000 | Large label expected |
| 1000000 | Large label expected |

---

## Releases (10)

| ID | Notes |
|----|-------|
| 1 | Small release |
| 100 | Mid-range |
| 500 | Mid-range |
| 1000 | Mid-range |
| 5000 | Mid-range |
| 10000 | Mid-range |
| 50000 | Mid-range |
| 100000 | Mid-range |
| 500000 | Large expected |
| 1000000 | Large expected |

---

## Versions (10)

| ID | Notes |
|----|-------|
| 1 | Version 1 — should have parent release link |
| 100 | Mid-range |
| 500 | Mid-range |
| 1000 | Mid-range |
| 5000 | Mid-range |
| 10000 | Mid-range |
| 50000 | Mid-range |
| 100000 | Mid-range |
| 500000 | Mid-range |
| 1000000 | Mid-range |

---

## Known Violations (do not remove)

| Entity | ID | Reason |
|--------|----|--------|
| Artist | 769196 | Writer/arranger only — no primary masters before credits fix |

---

## Maintenance

- Add IDs discovered during manual QA
- Mark IDs as `[EXEMPT]` with reason if truly sparse by nature
- Re-run canary check on every deploy via CI gate
