# HRC 30 m US Test Sites — What's Blocking Release

| Field | Value |
|---|---|
| **Version** | 1.0 |
| **Date** | 2026-08-05 |
| **Status** | **Not ready.** Nothing has shipped past Phase 2 diagnostics — no row of this tier exists in the live app or database yet. |
| **Scope** | What stands between today and *anything* landing in production. |

---

## Hard blockers — nothing ships without these, regardless of site

1. ~~Phase 3 gate has not run.~~ **DONE 2026-08-06.** `validate.py` built and run against real exports over the D-H intersection. D2 winner recorded: **denominator B** (see `docs/HRC_30m_test_sites_usa_d2_decision_v1_0.md`). Only **US-Ne1 and US-Ne2** cleared both gates — see the revised per-site table below, this narrows further than "Mead is closest to ready" suggested.
2. **No migration, no importer, no aggregator.** Migration 009 (new `hrc_tiles` columns), `import.py`, and `aggregate.js` (H3 res-10 aggregation) don't exist. There's no mechanical path from a CSV to the database yet.
3. **App integration hasn't started.** G1 (H3-resolution mapping) shipped in an earlier session but is a no-op until real rows exist. G4 (region nav), G7 (Cooling Work label), Bioregion Card fields, G2 verification — none built.

## Decisions that need a call, not more engineering

- **Q1 — cap EF at 1.0 vs. drop the month. RESOLVED 2026-08-06.** Cap, don't drop, and flag with the pre-cap value preserved — never a silent overwrite. `pipeline.js` now computes a separate tile-product variant (`hrc_A/B_capped`) alongside the existing strict Phase-3 variant (`hrc_A/B`, unchanged, still drops these months for D-H): every month with valid data is kept, each month's numerator is capped at its own denominator (so no month can push the annual ratio past EF=1.0), and `hrc_A/B_uncapped` + `months_capped_A/B` are exported alongside so the cap is auditable — `uncapped` is literally what the published value was capped *from*. Confirmed working at full tile scale (350k+ pixels across three sites): `hrc_B_capped` never exceeds 10.0 anywhere; `hrc_B_uncapped` does, as expected.
- **D2 — denominator winner. RESOLVED 2026-08-06.** B, unambiguous. Full record: `docs/HRC_30m_test_sites_usa_d2_decision_v1_0.md`.
- **Q6 — single-year scope. RESOLVED 2026-08-05.** Ship 2023 as the satellite-computed score, with a tower-derived interannual range as a Bioregion Card caveat (not a second satellite view / toggle — that's out of scope for this release). Computed from `tower.py --year` against the AmeriFlux BASE files, 2019–2024, no GEE run needed. Result: **US-Ne1 5.70–6.56, US-Ne2 5.46–6.48, US-Ne3 4.72–5.84** (`tower_ef_mead_interannual_summary_v1_0.csv`). The irrigated>rainfed anchor holds in 5 of 6 years; in 2024, US-Ne2 and US-Ne3 print identically (5.46) rather than separating — never reverses, just doesn't distinguish that one year. Worth one caveat sentence on the card.

## Per-site (per-tower) readiness — revised post-Gate-P3

Phase 3 passing turned out to be tower-specific, not site-specific — Mead is not uniformly ready.

| Tower / site | Status |
|---|---|
| **US-Ne1, US-Ne2** (Mead, irrigated) | **Cleared.** Both gates pass under B, with one documented curve caveat (Feb/Mar — a testing-window artifact, see D2 record §3). Blocked only by the remaining hard blockers (migration/import/aggregate, app). |
| **US-Ne3** (Mead, rainfed) | **Held — new.** Fails both gates; investigated to a plausible but same-session, not independently-verified, explanation (D2 record §4). Needs a decision or further verification before Phase 4, not just engineering. |
| **Tonzi/Vaira** (Mediterranean wildland) | **Not an engineering problem**, unchanged. Gate run now confirms the pipeline gets the ecology right (curve passes) while magnitude fails on the externally-documented OpenET numerator floor — pipeline-side confirmation of an already-settled call. |
| **Metolius** (forest) | Coordinate fixed; regime label resolved to `post_fire_regenerating`. Gate technically passes magnitude but on only 5 thin intersection months, compounding the already-known closure=0.519 tower-reference problem. Not cleared. |

## Shortest realistic path (Ne1/Ne2 only — not all of Mead)

1. ~~Patch `pipeline.js`'s footprint export~~ — done.
2. ~~Build and run `validate.py`; record the D2 winner~~ — done, B, see the decision record.
3. ~~Resolve Q1~~ — done.
4. Migration 009 + `import.py` + `aggregate.js`, **US-Ne1/US-Ne2 only** (or decide on Ne3 first if you'd rather resolve it than ship two-of-three).
5. P5 app changes.

**Bottom line:** the mechanics (migration/import/aggregate/app) are the whole remaining path now — no open decisions block Ne1/Ne2. Ne3, Tonzi/Vaira, and Metolius each need something else first (a decision, an external fix, or more evidence) — not more pipeline engineering.
