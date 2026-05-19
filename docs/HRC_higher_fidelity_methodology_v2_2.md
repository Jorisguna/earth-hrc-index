# Heat Regulation Capacity Index — Higher-Fidelity Methodology v2.2

**Version:** v2.2
**Date:** May 2026
**Status:** Phase 1 production methodology, Île-de-France only. Tapajós continues on v2.1.2 until the Path B reference (see [Tapajós Path B design](./HRC_albedo_modifier_tapajos_path_b_design_v1.md)) is built and imported.
**Predecessor:** v2.1.2 (`HRC_higher_fidelity_methodology_v2_1.md`, sections 1–7.12). This document is the v2.2 *delta* — it lists the formula change, the new ecoregion reference, the trust-the-data gate, the deferred cryosphere handling, and the Phase 0 validation results. All upstream pipeline sections (evapotranspiration, net radiation, MODIS land-surface-temperature processing, the latent-heat-flux magnitude diagnostic) are unchanged from v2.1.2 and are not restated here.

---

## What changed in v2.2

The Tier A Heat Regulation Capacity score gains an **ecoregion-relative albedo modifier**. Two pixels with identical evaporative fraction can now score differently if their surface albedos diverge from the local intact-reference. Specifically: a degraded forest patch in a vegetated ecoregion whose albedo has risen above the ecoregion's intact median is penalised relative to its evaporative-fraction-only v2.1.2 score; an intact pixel is left effectively unchanged.

The modifier is gated. In ecoregions where the trust-the-data check (Section 7.13.4) fails, the term is disabled and the v2.2 score falls back to identical v2.1.2 behaviour. The user-facing application surfaces the enabled/disabled state on every tile so the difference is observable, not hidden.

This is the implementation of `HRC_albedo_modifier_claude_code_handoff_v1_2.md`. The full decision trail — including why multiplicative was chosen over additive, why the median was chosen over the 90th percentile, and what cropland-vs-forest signal the modifier is and is not designed to capture — is documented in that handoff and its companion patch documents.

---

## Section 7.13 — Ecoregion-relative albedo modifier

### 7.13.1 Formula

The v2.1.2 Tier A score:
```
HRC_v2_1_2 = 10 × clip(λE / Rn, 0, 1)
            = 10 × EF
```

The v2.2 Tier A score (multiplicative form):
```
HRC_v2_2 = 10 × EF × (1 − W × Albedo_deficit_norm)
```

Where:
- `EF = clip(λE / Rn, 0, 1)`, identical to v2.1.2.
- `W = 0.20` (production weight, project owner decision 2026-05-18). The Phase 0 sweep covered `W ∈ {0.10, 0.15, 0.20}`; 0.20 was chosen for the larger ecosystem-health signal while still passing the FR-Fon intact-drift gate (|Δ| ≈ 0.057 at measured deficit 0.05, well inside the ±0.10 bound).
- `Albedo_deficit_norm = clip(max(α_pixel − α_ref_p50, 0) / α_ref_p50, 0, 1)` — see §7.13.2 for `α_ref_p50` and §7.13.5 for the asymmetric `max(·, 0)` floor.

**By construction:**
- A pixel at or below the ecoregion's intact reference albedo (deficit = 0) scores **exactly** `10 × EF` — identical to v2.1.2.
- A pixel at the full penalty cap (deficit = 1) scores `10 × EF × (1 − W)` — at `W = 0.20`, a maximum reduction of 20%.
- The penalty scales with both the deficit *and* the original evaporative fraction. A degraded high-EF surface loses more absolute score than a degraded low-EF surface; this is the correct physics — degradation of a high-cooling surface is a larger absolute loss of cooling work.

**Why multiplicative.** An additive form (`(1 − W) × EF + W × (1 − deficit)`) lifts intact pixels above their v2.1.2 score by approximately `10 × W × (1 − EF)` — roughly +0.6 points at `W = 0.15` for a forest with `EF = 0.6` and deficit zero. The "intact unchanged" property only holds at `EF ≈ 1`, which corresponds to no real surface. The multiplicative form makes "intact unchanged" exactly true. The decision trail and three alternative formulations considered (subtractive, power-form, additive) are in `HRC_albedo_modifier_claude_code_handoff_v1_2.md` §2.1.

### 7.13.2 The ecoregion-relative albedo reference

For each RESOLVE 2017 ecoregion intersecting a region of interest:

1. Filter the World Database on Protected Areas (WDPA) polygons by `STATUS = 'Designated'` and IUCN category list. Île-de-France uses Ia–VI (a Phase 0 finding — strict I–IV alone failed the protected-area-coverage trust gate in France).
2. Convert each WDPA polygon to its centroid (matches the existing v2.1.2 intact-site reference pattern; avoids the geometry-union and image-mask failures documented in `HRC_intact_site_reference_methodology_v2_0.md` §2.2).
3. Apply the per-centroid trust filter (§7.13.4.1 below) — reject centroids whose surface is water, urban, cropland, or wetland-dominated.
4. Sample MCD43A3 black-sky shortwave albedo (`Albedo_BSA_shortwave`, scale 0.001, mandatory-quality mask) at each surviving centroid for the calendar-year window of the radiation pipeline (currently 2023).
5. If twenty or more centroids survive, compute the 25th / 50th / 75th percentiles of their albedos. The 50th (`α_ref_p50`) is the ecoregion's intact-reference albedo.

**Why the median, not the 90th percentile.** For the existing Heat Regulation Capacity reference, the 90th percentile is the right choice — the reference measures *aspirational performance* (what the best intact sites achieve). For albedo, the reference measures *typical intact appearance*: departures from typical in either direction are the signal. The 90th percentile of intact albedo would punish naturally-dark intact patches (organic litter, dense canopy, wet soil). The median does not.

For Tapajós, this Path A centroid-sampling approach fails — the dominant ecoregion (Tapajós-Xingu moist forests) yields only 3 surviving centroids because the protected-area estate consists of a small number of very large reserves rather than many smaller ones. Tapajós therefore uses a Path B method (Hansen-defined intact-forest masking; see [Tapajós Path B design](./HRC_albedo_modifier_tapajos_path_b_design_v1.md)) once that work stream completes. The unified output contract is the same — `α_ref_p50`, status, disabled-reason, `reference_p90_v2_2` — so the tile pipeline and front-end logic are shared between Paths A and B.

### 7.13.3 The Heat Regulation Capacity reference under v2.2

The restoration-gap displayed on every tile is `reference_p90 − HRC_score`. Under v2.1.2, both terms are pure evaporative fraction. Under v2.2, both terms include the albedo modifier. Comparing the v2.2 score against the v2.1.2 reference would produce an apples-to-oranges restoration gap, systematically over-stating the gap for vegetated ecoregions by approximately 0.25–0.35.

The v2.2 pipeline therefore computes a parallel reference, `reference_p90_v2_2`, as the 90th percentile of per-centroid (Path A) or per-intact-pixel (Path B) v2.2 scores. Each input pixel's v2.2 score is computed using its own `EF` and the ecoregion's `α_ref_p50`; the 90th percentile of those is the new reference.

The v2.1.2 reference (`hrc_reference`) is retained on every v2.2 tile row so the front-end v2.1.1 toggle can still display the legacy restoration gap. The two references are computed from different centroid populations (legacy: IUCN I–IV from script 33; v2.2: IUCN I–VI from script 38) and therefore differ even in the Heat-Regulation-Capacity-only direction: for the European Atlantic mixed forests ecoregion, the legacy reference is 6.47 and the v2.2 reference (at `W = 0.20`) is in the 6.0–6.1 range — a shift of ~0.4 across the change in both centroid set and modifier.

### 7.13.4 The trust-the-data gate

The modifier is applied to a tile only if its ecoregion passes **all** of the following gates after the per-centroid (Path A) or per-intact-pixel (Path B) trust filter has been applied.

#### 7.13.4.1 Per-centroid (Path A) / per-pixel (Path B) input filter

A centroid (or, in Path B, an intact pixel) is rejected from the reference computation if any of the following holds at its location:

- MCD12Q1 Land Cover Type 1 class is **17** (Water Bodies).
- MCD12Q1 class is **13** (Urban and Built-Up).
- MCD12Q1 class is **12** (Cropland) or **14** (Cropland / Natural Vegetation Mosaic).
- The mean of (class 11 OR class 17) within a 500-metre buffer of the centroid exceeds 0.25 — the centroid is dominated by water or wetland-edge.

This is the same filter applied in `HRC_option_4_phase_0_sampling_diagnostic_handoff_v1_0.md` for the evaporative-fraction reference contamination check.

#### 7.13.4.2 Per-ecoregion gate

After the input filter, the ecoregion's albedo modifier is **enabled** only if all of:

- At least twenty surviving centroids (Path A) — or, equivalently, at least 500 surviving intact pixels (Path B).
- The interquartile range of the surviving-input albedos is less than 0.10. A noisy reference is not a usable reference.
- Protected-area coverage of the ecoregion is at least 5% of the bbox-local ecoregion area (matches the existing v2.0 ecoregion-flagging convention; replaced in Path B by an intact-coverage analogue — see Path B design note §4).
- The ecoregion's biome is not a cryosphere biome (§7.13.6; deferred to Phase 2).

If any gate fails, the ecoregion is recorded with `albedo_modifier_status = 'disabled'` and its tiles compute `HRC_v2_2 = 10 × EF`, identical to v2.1.2. The reason for the disable is written into `albedo_modifier_disabled_reason` so the front-end can surface a specific tooltip rather than silently dropping the modifier. The four reasons in production are:

- `insufficient_samples` — fewer than the minimum input count.
- `noisy_reference` — IQR exceeds 0.10.
- `low_pa_coverage` (Path A) / `low_intact_coverage` (Path B) — coverage below 5%.
- `cryosphere_biome_phase2_deferred` — biome is tundra or high-latitude polar.

Every disabled tile carries one of these reasons. No silent disables.

### 7.13.5 Asymmetric penalty (vegetated biomes)

The deficit normalisation has a `max(·, 0)` floor: only pixels brighter than the ecoregion reference are penalised. Pixels darker than reference (dense canopy, organic litter, wet soil) receive the full reward of their evaporative fraction with no further adjustment.

This is the correct asymmetry for vegetated biomes: an unexpectedly-dark forest patch is an intact / over-performing surface, not a degraded one. The asymmetric form is what the production v2.2 ships with, and it is appropriate for every ecoregion in the current showcase regions (Île-de-France, Tapajós).

### 7.13.6 Cryosphere handling — deferred to Phase 2

In cryosphere biomes (RESOLVE biome 11 — Tundra — and the high-latitude polar biomes), lost ice and snow makes the surface *darker* than the intact reference, not brighter. The asymmetric vegetated form misses this — a one-sided positive-deficit penalty does not apply.

For Phase 2 the intended form is two-sided:
```
Albedo_deficit_norm_cryosphere = clip(|α_pixel − α_ref_p50| / α_ref_p50, 0, 1)
```

Until Phase 2 is built, every cryosphere ecoregion is flagged in §7.13.4.2 with `albedo_modifier_disabled_reason = 'cryosphere_biome_phase2_deferred'`. This is implemented as a hard biome-list check in the pipeline. None of the current showcase regions are cryosphere; the flag is wired pre-emptively so the safety mechanism is testable.

### 7.13.7 Phase 0 validation results

The full Phase 0 evidence is in `HRC_albedo_modifier_phase0_findings_v1.md`. The summary at the production weight (`W = 0.20`, derived from the Phase 0 priors via the smoke test):

| Pixel | EF | Pixel albedo | Ecoregion ref albedo | Deficit | v2.1.2 score | v2.2 score (W = 0.20) | Δ | Hard gate |
|---|---|---|---|---|---|---|---|---|
| FR-Fon (intact temperate broadleaf) | 0.570 | 0.141 | 0.134 | 0.049 | 5.70 | 5.64 | −0.06 | **Pass** — within ±0.10 |
| Beauce (cropland in temperate broadleaf ecoregion) | 0.607 | 0.159 | 0.134 | 0.180 | 6.07 | 5.85 | −0.22 | **Pass** — drop ≥ 0.15 |
| Paris (urban / mosaic suburb at 500 m) | 0.565 | 0.138 | 0.134 | 0.026 | 5.65 | 5.62 | −0.03 | **Pass** — drop ≥ 0.02 |
| K67 (intact tropical, Tapajós) | 0.562 | 0.116 | — | — (Path A disabled) | 5.62 | 5.62 | 0.00 | **Pass** — identity by construction |
| BR-163 (cleared, Tapajós) | 0.564 | 0.148 | — | — (Path A disabled) | 5.64 | 5.64 | 0.00 | **Pass** — identity by construction; re-evaluated under Path B |

The trust gate fires correctly. In the Phase 0 IDF panel, 5 of 6 ecoregions disabled with non-null reasons. Tapajós (Path A) shows all four ecoregions disabling with `insufficient_samples`, which is the expected result that motivates the Path B work stream.

The reference-shift for the European Atlantic mixed forests ecoregion is within the acceptable band: legacy `hrc_reference` (script 33, IUCN I–IV, n=39) is 6.47; Phase 0 `reference_p90_v2_2` (script 38, IUCN I–VI, n=64, `W = 0.15`) is 6.12; the v2.2 production value at `W = 0.20` is in the 6.0–6.1 range — a shift of approximately −0.4 in total, attributable to a combination of the broader centroid set (~−0.10) and the modifier itself (~−0.30). This is within the project owner's ±0.5 hard gate for the v2.1.1 / v2.2 score-on-the-same-tile divergence.

---

## What this section does NOT change

Explicit non-goals retained from v2.1.2:

- The evaporative-fraction formula and the upstream evapotranspiration or net-radiation inputs (Penman-Monteith-Leuning V2 v018 for latent heat, ERA5-Land + MCD43A3 + MOD/MYD11A1 for net radiation) are unchanged.
- The intact-site Heat Regulation Capacity reference (90th percentile of HRC, not albedo) remains the legacy method from script 33 — Path A centroid-sampling at IUCN I–IV. The new `reference_p90_v2_2` is *added*, not a replacement.
- The latent-heat-flux magnitude diagnostic (`latent_heat_flux_annual_wm2`, v2.1.2) is unchanged and continues to display alongside the score.
- The Trend Score and the historical / ceiling restoration gaps are unchanged. v2.2 vs v2.1.x gap-versus-gap comparisons are out of scope.
- The urban heat-island correction flagged in the Whitepaper Section 9.4 is not addressed. Paris drops modestly under v2.2 in mosaic-suburb pixels; dense inner-Paris arrondissements are outside the current bbox and remain a separate work stream.
- Biodiversity, canopy-structure, and hydrological-connectivity proxies are unchanged (i.e., not present). The Whitepaper open item "this rewards industrial monoculture as much as old-growth forest" is **not** addressed by v2.2 — the modifier penalises bright cleared land, not low-biodiversity-but-irrigated monoculture.
- The Ocean Extension scoring framework is unchanged.

---

## Data sources used in v2.2

| Source | Collection ID | Role | Resolution | Window |
|---|---|---|---|---|
| Broadband shortwave albedo | `MODIS/061/MCD43A3` band `Albedo_BSA_shortwave` (scale 0.001, quality mask `BRDF_Albedo_Band_Mandatory_Quality_shortwave == 0`) | Pixel albedo + intact-reference input | 500 m | calendar year 2023 |
| Land cover | `MODIS/061/MCD12Q1` band `LC_Type1` | Per-centroid (or per-pixel, Path B) trust filter | 500 m | 2023 annual |
| Protected areas | `WCMC/WDPA/current/polygons` filtered `STATUS = 'Designated'`, IUCN Ia–VI | Centroid source for Path A | polygon | current |
| Ecoregions | `RESOLVE/ECOREGIONS/2017` | Reference unit; biome code source | polygon | 2017 vintage |
| Hansen intact forest (Path B) | `UMD/hansen/global_forest_change_2024_v1_12` bands `treecover2000`, `lossyear`, `datamask` | Per-pixel intact mask for Path B | 30 m | 2024 vintage |
| (Upstream, unchanged) Penman-Monteith-Leuning V2 v018, ERA5-Land, MOD11A1, MYD11A1 | — | Evapotranspiration and net radiation, per v2.1.2 §3–§6 | — | calendar year 2023 |

`albedo_data_source` is recorded on every v2.2 tile as `MCD43A3_061` for sensor-transition provenance. MODIS Terra is past its design life; a future Visible Infrared Imaging Radiometer Suite (VIIRS) replacement would use a different Bidirectional-Reflectance-Distribution-Function correction and could produce a step change in the reference. The provenance column lets the project distinguish sensor-artefact shifts from real land-cover changes.

---

## Production weight

`W = 0.20` (project owner decision 2026-05-18). The Phase 0 sensitivity sweep covered `{0.10, 0.15, 0.20}`. The smoke test (`scripts/albedo_modifier_phase0_smoke_test.py`) gates at the production weight and must pass before any Earth Engine compute is spent on a v2.2 tile job.

To change the production weight in future:

1. Update `DEFAULT_WEIGHT` in `scripts/albedo_modifier_phase0_smoke_test.py` and re-run.
2. Update `W` in `scripts/38_albedo_reference_idf_v2_2.js` and `scripts/31_hrc_v2_1_idf_tiles_v2_2.js`.
3. Re-export the IDF reference and tile CSVs; re-import via `scripts/import_hrc_v2_2_tiles.py`. The v2.2 column `albedo_modifier_weight` (in the reference CSV) and the `hrc_formula` field (in tile rows: `pml_v2_500m_v2.2_albedo_modifier_w{value}`) record the chosen weight per import for downstream traceability.
4. Update the v2.2 column comment in `scripts/migrations/008_albedo_modifier_v2_2.sql` (run as a small follow-up migration or a `COMMENT ON COLUMN` patch).
5. Patch this document's §7.13.1 to the new value.

A weight change is not a methodology version bump — it is a parameter-within-v2.2 change. The methodology version stays `v2.2_higher_fidelity`.

---

## Reproducibility

All v2.2 code is in the repository:

| File | Purpose |
|---|---|
| [`scripts/albedo_modifier_phase0_smoke_test.py`](../scripts/albedo_modifier_phase0_smoke_test.py) | Phase −1 mandatory gate. Must pass before any GEE compute. |
| [`scripts/38_albedo_reference_idf_v2_2.js`](../scripts/38_albedo_reference_idf_v2_2.js) | Path A per-ecoregion albedo reference + `reference_p90_v2_2` for IDF. |
| [`scripts/31_hrc_v2_1_idf_tiles_v2_2.js`](../scripts/31_hrc_v2_1_idf_tiles_v2_2.js) | IDF v2.2 tile pipeline — joins per-ecoregion reference and emits per-tile v2.2 score + status + reason. |
| [`scripts/import_hrc_v2_2_tiles.py`](../scripts/import_hrc_v2_2_tiles.py) | Supabase importer. DELETE+INSERT pattern matching the v2.0 / v2.1.x convention. |
| [`scripts/migrations/008_albedo_modifier_v2_2.sql`](../scripts/migrations/008_albedo_modifier_v2_2.sql) | Schema migration. Adds eight columns to `hrc_tiles` and refreshes the `hrc_tiles_default` view. |
| [`docs/HRC_albedo_modifier_claude_code_handoff_v1_2.md`](./HRC_albedo_modifier_claude_code_handoff_v1_2.md) | Original handoff. The decision trail and Phase 0 rationale. |
| [`docs/HRC_albedo_modifier_phase0_findings_v1.md`](./HRC_albedo_modifier_phase0_findings_v1.md) | Phase 0 measured-result evidence. |
| [`docs/HRC_albedo_modifier_tapajos_path_b_design_v1.md`](./HRC_albedo_modifier_tapajos_path_b_design_v1.md) | Tapajós Path B design — parallel work stream, not yet built. |

The Earth Engine collections, the W value, and the trust thresholds are all set as named constants at the top of each script so future audits can trace what was computed when.
