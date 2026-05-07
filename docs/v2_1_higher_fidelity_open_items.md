# v2.1 Higher-Fidelity — Open Items & Pre-Release Gates

**Purpose:** Track pending items that must be resolved before specific milestones (production deploy, external/partner sharing of methodology paper, peer-review submission). Items are listed in priority order with a clear owner and gate.

**Distinguish from the historical baseline v2.1:** This document concerns the *higher-fidelity showcase* v2.1 work (Île-de-France + Tapajós at 500 m). The historical baseline v2.1 (2001–2010 reference, all three pilot regions at 9 km) is fully shipped and not tracked here.

---

## Open Items

### 1. ⚠ K67 EBC factor citation verification

**Status:** Pending verification
**Gate:** Before external sharing of methodology paper or v2.1 reference value 7.89
**Owner:** Project lead

The K67 (Tapajós BR-Sa1) Heat Regulation Capacity reference value of **7.89** depends on an energy-balance-closure factor of **1.18** applied to the uncorrected `LE_F_MDS` flux because the AmeriFlux v1.3 r1 release does not populate `LE_CORR`.

The 1.18 factor and its supporting citations are flagged in the methodology paper and process guide as derived from training-data memory during pre-build validation:

> **Hutyra et al. (2008)** *Global Change Biology*
> **Restrepo-Coupe et al. (2013)** *Agricultural and Forest Meteorology*

**Action required:**

1. Locate the actual published papers (not summaries or training-data memory)
2. Confirm both papers report an EBC factor of approximately 1.18 for K67 / BR-Sa1
3. If a different value is reported (the methodology paper notes the published range is 1.05–1.25), update:
   - `validation_artefacts/k67/analyse_k67.py` (the constant `EBC_FACTOR_K67_PUBLISHED`)
   - `validation_artefacts/k67/k67_annual_ef.csv` (regenerate with corrected factor)
   - `validation_artefacts/k67/k67_monthly_ef.csv` (regenerate with corrected factor)
   - The methodology paper §7.3 and §10.5
   - The K67 reference value (currently 7.89, sensitivity range 7.02–8.36 across 1.05–1.25 EBC)
   - The acceptance gate tolerance in the build (currently ±0.5 of 7.89)

**Sensitivity:** the 7.89 reference is the centre value. Across the published EBC range:

| EBC factor | K67 HRC reference |
|------------|-------------------|
| 1.05 (low) | 7.02 |
| 1.18 (central — current) | 7.89 |
| 1.25 (high) | 8.36 |

If verification produces a different central value, the satellite-vs-tower acceptance gate logic remains valid — only the target number changes.

**Why this is flagged so prominently:** it is unusual for a methodology paper to state "this factor was derived from training-data memory and must be verified." The methodology authors did the right thing by surfacing the limitation rather than burying it. Following through on the verification is the corresponding right thing.

---

---

## Resolved Items

### Schema region_code column — resolved 2026-05-07

**Decision:** Option A — add `region_code` column to `hrc_tiles`, backfill 639 existing tiles from lat/lon ranges.

**Why:** A column is going to be essential as the system grows beyond three pilot regions. The 1-time backfill is trivial. Future ingest scripts populate `region_code` directly, eliminating the lat/lon CASE expressions that were repeating across every verification query.

**Implementation:** [scripts/migrations/005_v2_1_higher_fidelity.sql](../scripts/migrations/005_v2_1_higher_fidelity.sql)

### Script numbering convention — resolved 2026-05-07

**Decision:** Use the **31–34** range, following the v2.0 series convention (tiles 25-27, references 28-30).

- `31_hrc_v2_1_idf_tiles.js` — Île-de-France 500m HRC pipeline
- `32_hrc_v2_1_tapajos_tiles.js` — Tapajós 500m HRC pipeline
- `33_hrc_v2_1_idf_reference.js` — Path A centroid sampling
- `34_hrc_v2_1_tapajos_reference.js` — Path B Hansen image masking

**Why:** Tiles before references matches the existing v2.0 pattern (25/26/27 tiles, then 28/29/30 references). Avoids all collisions with existing 12/13/14/15 scripts. The `_v2_1_` infix distinguishes from `_v2_0_` (v2.0) and the historical v2.1 work (which has no version suffix in the filename).

---

## Items deferred to v2.2 (not in current scope)

Per methodology paper §6 and handoff §12:

- ECOSTRESS 70 m land surface temperature integration (currently LA-only in Earth Engine ingest)
- Rolling baseline windows (e.g. 2005–2014, 2010–2019)
- Tier B (Sentinel-2 / Landsat) cross-validation against v2.1 satellite values
- Path B (Hansen image masking) for ecoregions outside Tapajós
- Spring-only secondary historical view
- Ecoregion-relative historical reference normalisation
- Penman-Monteith ceiling reference resurrection (with climate-stratified methodology)
- `historical_confidence` UI surfacing
- v2.1 trend computation at 500 m resolution
- v2.1 historical baseline at 500 m resolution

These are fine to defer; do not let scope creep pull them in.

---

## Change log

| Date | Item | Change |
|------|------|--------|
| 2026-05-07 | Document created | Initial open-items tracker for v2.1 higher-fidelity build |
| 2026-05-07 | K67 EBC citation verification | Logged as pending; gates external methodology-paper sharing |
| 2026-05-07 | Schema region_code | Resolved — Option A (add column, backfill) |
| 2026-05-07 | Script numbering | Resolved — 31-34 series, tiles before references |
