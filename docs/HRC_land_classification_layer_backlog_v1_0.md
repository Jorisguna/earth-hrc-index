# Land Classification Layer — Backlog

| Field | Value |
|---|---|
| **Version** | 1.0 |
| **Date** | 2026-08-06 |
| **Status** | **Backlog — standalone project, not scoped or scheduled.** Not a blocker on the current Mead (US-Ne1/US-Ne2) release. |
| **Origin** | Surfaced while scoping `import.py` for the 30 m tier: Phase 3 validated the pipeline at *tower points* (Ne1/Ne2 pass, Ne3 held — `docs/HRC_30m_test_sites_usa_d2_decision_v1_0.md`), but the tile export is a spatial grid over the whole Mead bbox with one uniform method applied everywhere. There is currently no way to know, pixel by pixel, whether a given tile resembles the validated regime (irrigated) or the held one (rainfed) — or, more broadly, what land cover any tile anywhere in the app actually is. |

---

## 1. What it would need to do, minimally

Distinguish irrigated from rainfed cropland within the Mead bbox — the immediate, concrete need. That alone would let a future import scope tiles by regime-similarity rather than by geographic proximity to a tower (a weak proxy — a rainfed field can sit next to an irrigated one).

## 2. What it could do, if scoped wider

The same underlying need recurs beyond Mead:
- Any future US test site (or CONUS-wide work) has the identical problem — a pipeline validated at N tower points, applied uniformly across a spatial grid.
- The independent numerator-check investigation's CONUS exposure sampling (`HRC_P1-2_multiyear_results_v1_0.md`) already uses **NLCD 2021 land cover** for its own per-class breakdown — that's a concrete, already-validated-elsewhere candidate data source, not a speculative one. The same investigation's blind-spot note flags NLCD's own limitation directly relevant here: land cover is static per year, so a footprint whose vegetation changed (burned, cleared, irrigated status changed) is mislabeled — exactly the kind of case US-Me2's coordinate audit found by accident.
- A general land-classification layer could also inform D3-style regime flagging (the drydown/senescence classification work referenced in the external investigation) and the eventual Bioregion Card's "what am I looking at" context, beyond just gating imports.

## 3. Why it's a standalone project, not a Mead sub-task

- It needs a data-source decision (NLCD vs. USDA Cropland Data Layer vs. something else), a validation pass of its own (does it actually distinguish irrigated/rainfed at Mead correctly? against what ground truth?), and probably its own small pipeline — not a quick addition to `pipeline.js` or `import.py`.
- Scoping it now would block Ne1/Ne2 — which are already validated and ready — on infrastructure with no bearing on their own readiness.
- It's reusable beyond Mead once built properly; building it narrowly and fast for Mead alone risks a throwaway that doesn't serve the next site.

## 4. What resolves without it

The immediate Mead import scope question doesn't need to wait — see `docs/HRC_30m_test_sites_usa_d2_decision_v1_0.md` and the `import.py` scoping decision recorded alongside it. This backlog item is about the *next* time this exact problem recurs, not a precondition for shipping Ne1/Ne2.
