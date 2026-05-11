# v2.1 Higher-Fidelity Acceptance Gate — Failure Brief

**Status:** Phase 2 acceptance gate failed at both flux-tower pixels. Build halted per handoff §3.
**Date:** 2026-05-08
**Audience:** Author of `HRC_higher_fidelity_methodology_v2_1.md`

---

## What ran

The full v2.1 higher-fidelity build executed end-to-end exactly as specified in the handoff:

- Schema migration `005_v2_1_higher_fidelity.sql` applied (region_code + 6 v2.1 columns)
- GEE scripts 31, 32, 33, 34 ran with all 12 known traps avoided (PML_V2 mm/day×8, MOD11A1 0.02 scale, MCD43A3 0.001, Terra+Aqua+day+night, Jensen-aware σεT⁴ per scene then time-mean, Hansen `unmask(0)`, WDPA `STATUS='Designated'` no MARINE filter, etc.)
- 46,553 tiles imported into Supabase: 15,994 IDF + 30,559 Tapajós
- All ecoregions present in CSVs got Path A or Path B references; `Western European broadleaf forests`, `Gurupa várzea`, and `Uatumã-Trombetas moist forests` correctly fell back to Path C as anticipated by methodology paper §6.5

## Acceptance gate result

| Region | Tower reference | Satellite HRC at tower pixel | Diff | Status |
|--------|-----------------|------------------------------|------|--------|
| FR-Fon (Île-de-France) | 5.04 | 6.747 | **+1.707** | FAIL |
| K67 (Tapajós) | 7.89 | 5.957 | **−1.933** | FAIL |

Tolerance was ±0.5 per methodology paper §3.

## The diagnostic insight

The two failures are in **opposite directions**. This rules out simple systematic bugs:

| Hypothesis | Predicted signature | Observed |
|------------|--------------------|----------|
| Unit conversion error | both same direction | ✗ opposite |
| Jensen's inequality not respected | both EF too low | ✗ FR-Fon high, K67 low |
| PML_V2 × 8-days conversion missing | both EF too low | ✗ |
| MOD11A1 scale factor missing | both EF too high | ✗ |
| Stefan-Boltzmann constant typo | both same direction | ✗ |
| Time window off | both same direction | ✗ |

The pattern is consistent with **region-specific assumption violations** rather than a coding bug. The pipeline implements §4 of the methodology paper as written.

## What this likely points to

The methodology paper itself flags PML_V2 as having ~5–10 % bias and acknowledges PM-derived Rn carries additional uncertainty (§4.4, §10.1). Compounded through the EF ratio, ±10 % on each component can plausibly produce ±2 HRC errors at individual pixels.

Specifically:

- **FR-Fon (+1.7)**: satellite EF too high → likely Rn underestimated. Could be (a) MCD43A3 albedo too high under strict QA mask (selecting cloud-free days that bias high-albedo), or (b) LW_up overestimated due to MOD11A1 LST sample bias toward warm overpass times.
- **K67 (−1.9)**: satellite EF too low → likely Rn overestimated, or PML_V2 LE biased low under K67's specific canopy conditions in 2023.

Without diagnostic exports of Rn, λE, and α at the tower pixels (not in the current pipeline), this can't be narrowed further.

## What we did NOT do

Per handoff §3:

> "If still failing after these checks, the methodology paper itself may need revision — escalate before continuing build."

We have **not** proceeded to Phase 3 (app updates). The 46,553 tiles are sitting in `hrc_tiles` tagged `methodology_version = 'v2.1_higher_fidelity'` but not surfaced in any UI. They can be retained for further diagnostic work or deleted at one DELETE statement.

## Decision required from the methodology author

Three options (the handoff anticipated this branching):

1. **Add tower-pixel diagnostic exports** to scripts 31/32 — re-run GEE (~45 min more compute) — diagnose whether Rn or LE is the proximate cause. Cost: low. Information yield: high. **Recommended as next step regardless of which final path is chosen.**

2. **Revise the methodology**: tighten the assumption set (e.g. require ECOSTRESS for 70 m LST, abandon the component-by-component Rn approach for an existing global Rn product like CERES SYN1deg) and re-run.

3. **Accept the ±2 HRC pixel-level uncertainty** as an inherent characteristic of the v2.1 pipeline: position v2.1 as a "spatial-pattern preview" rather than an absolute calibration. Keep the data, document the limitation in the partner-facing summary.

The build implementation team is waiting on this decision before doing any UI work. Phase 3 effort estimate (1 day) is negligible compared to the cost of building UI on a refuted dataset.

## Reproducibility

- Acceptance gate is in `scripts/validate_satellite_vs_tower.py` — runs in <5 seconds, fully reproducible.
- Tower references locked in `validation_artefacts/{frfon,k67}/` with the analysis scripts that produced them.
- All 46,553 v2.1 tiles in `hrc_tiles` are filterable by `methodology_version = 'v2.1_higher_fidelity'`.
- Citation verification on the K67 EBC factor (Hutyra 2008, Restrepo-Coupe 2013) remains an open item per `docs/v2_1_higher_fidelity_open_items.md` §1, **independent of this gate failure** but worth resolving in any forthcoming methodology revision.
