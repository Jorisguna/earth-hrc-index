# Tapajós albedo modifier — Path B design (v1)

**Date:** 2026-05-18
**Status:** Design note, not yet implemented. Parallel work stream to IDF Phase 1.
**Authors:** Drafted under HRC_albedo_modifier_claude_code_handoff_v1_2.md.
**For:** Whoever picks up the Tapajós side of the v2.2 albedo modifier work stream.

---

## Why this exists

Phase 0 confirmed that Path A (centroid sampling of WDPA polygons) cannot compute an albedo reference for Tapajós. The four RESOLVE ecoregions intersecting the Tapajós bbox all return `albedo_modifier_status = 'disabled'` with `albedo_modifier_disabled_reason = 'insufficient_samples'`. The dominant ecoregion (Tapajós-Xingu moist forests) yields only **3 surviving centroids** even with IUCN I–VI included, far short of the 20-centroid minimum.

The root cause, per [Phase 0 Finding 1](./HRC_albedo_modifier_phase0_findings_v1.md): Tapajós's protected-area estate is a small number of very large reserves (Tapajós National Forest alone is 5,400 km²), not many smaller ones. PA *coverage* is fine — Tapajós-Xingu shows 16.5% and Madeira-Tapajós shows 54.7% — but a coverage fraction does not produce centroids.

The existing v2.1.x HRC reference for Tapajós solved exactly this problem by switching to **Path B**: instead of sampling at PA centroids, mask the radiation image to Hansen-defined intact primary forest and take statistics over the surviving pixels. See [`scripts/34_hrc_v2_1_tapajos_reference.js`](../scripts/34_hrc_v2_1_tapajos_reference.js) for the production pattern.

This document specifies how to apply Path B to the albedo reference. The implementation should produce a `hrc_albedo_reference_tapajos_v2_2.csv` that the v2.2 tile pipeline can join the same way the IDF pipeline joins script 38's output.

---

## Path B for albedo — what changes versus script 34

Script 34 produces a per-ecoregion p90 of *HRC scores* at intact pixels. The albedo Path B follows the same skeleton but:

1. Statistic is **p25 / p50 / p75 of pixel albedo** (analogous to script 38's IUCN-centroid output), not p90 of HRC. The p50 is the ecoregion's intact-reference albedo.
2. Gating thresholds are recalibrated for pixel-count scale: Hansen masking yields tens of thousands of pixels per ecoregion, not the dozens that centroid sampling yields. See §4 below for the proposed thresholds.
3. `reference_p90_v2_2` is computed inline from per-pixel v2.2 scores (each intact pixel's v2.2 score is `10 × EF_pixel × (1 − W × deficit_pixel)`), then the p90 of those per-pixel scores. Same logic as script 38 for IDF; the difference is the per-pixel input vector instead of per-centroid.

---

## §1 — Intact mask construction

Reuse the Hansen mask from script 34 verbatim:

```javascript
var hansen = ee.Image('UMD/hansen/global_forest_change_2024_v1_12');
var canopy2000 = hansen.select('treecover2000').unmask(0);  // CRITICAL
var lossYear   = hansen.select('lossyear').unmask(0);        // CRITICAL
var datamask   = hansen.select('datamask').unmask(0);        // CRITICAL
var intactMask = canopy2000.gte(80)
                   .and(lossYear.eq(0))
                   .and(datamask.eq(1))
                   .rename('intact');
```

**Do not omit the `.unmask(0)` calls.** Hansen v1.10+ applies a humid-tropical-forest mask to `lossyear` that propagates through boolean operations and silently zeros the intact mask. The script 34 docstring documents this trap; it has bitten this project before.

Hansen version: pin to `global_forest_change_2024_v1_12` for consistency with script 34. If a newer Hansen vintage is published, update both scripts in the same commit so the HRC reference and the albedo reference stay aligned to the same intact-mask definition.

---

## §2 — Per-ecoregion albedo statistics on intact pixels

For each RESOLVE ecoregion intersecting the Tapajós bbox:

```javascript
var albedoIntact = albedoAnnual.updateMask(intactMask);  // 'albedoAnnual' as in script 38

var stats = albedoIntact.reduceRegion({
  reducer:   ee.Reducer.percentile([25, 50, 75]),
  geometry:  ecoGeom,
  scale:     500,
  maxPixels: 1e9,
  tileScale: 4
});

var albedo_ref_p50 = stats.get('albedo_p50');
var albedo_ref_iqr = ee.Number(stats.get('albedo_p75')).subtract(stats.get('albedo_p25'));
```

`albedoAnnual` here is the same MCD43A3 broadband albedo image used in script 38 — `Albedo_BSA_shortwave` band, scale 0.001, quality mask `BRDF_Albedo_Band_Mandatory_Quality_shortwave == 0`. Calendar year 2023 to match the v2.1.x and v2.2 tile windows.

The intact-pixel albedo distribution is the natural Path B analogue of script 38's centroid-albedo distribution. The 50th percentile is the median intact-typical albedo — same interpretation as IDF, just sampled differently.

---

## §3 — Per-pixel v2.2 score and `reference_p90_v2_2`

The v2.2 score per intact pixel is computed inline, then p90'd per ecoregion:

```javascript
var deficitRaw  = albedoIntact.subtract(albedo_ref_p50);
var deficitNorm = deficitRaw.divide(albedo_ref_p50).max(0).min(1);
var v22Intact   = efImage.multiply(10).multiply(
                    ee.Image(1).subtract(deficitNorm.multiply(W))
                  );

var refP90V22 = v22Intact.reduceRegion({
  reducer:   ee.Reducer.percentile([90]),
  geometry:  ecoGeom,
  scale:     500,
  maxPixels: 1e9,
  tileScale: 4
}).get('hrc_score_v2_2_p90');
```

`efImage` is reused from the radiation pipeline (latent heat / net radiation, clipped to [0,1]). `W = 0.20` (production weight, project owner decision 2026-05-18).

The result is `reference_p90_v2_2` for the ecoregion — the same column the IDF pipeline (script 38 and 31_..._v2_2.js) populates via centroid-derived per-pixel scores. The v2.2 restoration gap on the front-end is `reference_p90_v2_2 − hrc_score_v2_2` regardless of whether the underlying reference came from Path A (centroids) or Path B (intact pixels). The provenance is recorded in a separate column.

---

## §4 — Trust gate thresholds for Path B

The Path A gate uses a 20-centroid minimum. Path B's pixel counts are vastly larger (tens of thousands of intact pixels per ecoregion), so the threshold has to be scaled. Borrow from script 34's existing confidence tiers:

| Path B gate | Pass criterion | Mapping to `albedo_modifier_status` |
|---|---|---|
| Sufficient intact pixels | `intact_pixel_count >= 500` | Enable. Same low-confidence floor as the v2.1.x HRC reference in script 34. |
| Reference IQR check | `albedo_ref_p75 − albedo_ref_p25 < 0.10` | Same threshold as Path A. Intact tropical forest is tight-distributed (Phase 0 K67 sample showed 0.116 against an ecoregion that should land near 0.12–0.14). |
| Ecoregion-local Hansen coverage | `intact_pixel_count × (500 m)² ≥ 5% of bbox-local ecoregion area` | Replaces the Path A PA-coverage gate. Tapajós-Xingu showed ~4,500 km² of intact pixels in the bbox vs the bbox-local ecoregion area; the 5% floor is comfortably met. |
| Cryosphere biome | `BIOME_NUM ≠ 11` | Phase 2 deferral, same as Path A. Not applicable to any Tapajós ecoregion. |

**Disabled reasons** mirror the IDF convention to keep the front-end logic shared:

- `insufficient_samples` — fewer than 500 intact pixels (mirrors Path A's `insufficient_samples`, but the underlying threshold is different — record the actual number in a separate column for traceability).
- `noisy_reference` — IQR ≥ 0.10.
- `low_intact_coverage` — Hansen-derived intact coverage below 5%. **Note:** this is a Path-B-specific reason; the front-end "modifier disabled — insufficient reference data" tooltip should be neutral enough to cover both `low_pa_coverage` (Path A) and `low_intact_coverage` (Path B).
- `cryosphere_biome_phase2_deferred` — biome 11.

Add a new column `reference_method` to the per-ecoregion CSV with values `path_a_centroid` or `path_b_hansen_intact` so the import script (and front-end tooltip) can show which reference produced a given tile's modifier.

---

## §5 — Centroid-substitute audit trail

Script 35/38's per-centroid audit CSV is invaluable for traceability — you can inspect which centroids were rejected and why, without re-running the GEE script. Path B's analogue is harder: tens of thousands of pixels are too many to export individually.

Recommended substitute: **export a per-ecoregion summary** containing the intact-pixel count, the masked-area in km², the area-percentage of the ecoregion that survived the mask, and the per-ecoregion centroid of the surviving-pixel set. This is enough to spot ecoregions where the mask collapsed (e.g., a cleared ecoregion where only edge fragments survive).

Optional: a stratified sample of 100 intact pixels per ecoregion (longitude, latitude, albedo, EF) — 400 rows total across the four Tapajós ecoregions. Useful for spot-checking that the masked-pixel distribution matches expectations, without exporting the full 100k+ pixel set.

---

## §6 — File plan

| File | Purpose | Mirrors |
|---|---|---|
| `scripts/39_albedo_reference_tapajos_v2_2.js` | Path B per-ecoregion albedo reference + per-pixel v2.2 score → `hrc_albedo_reference_tapajos_v2_2.csv` (and optional per-ecoregion summary CSV) | scripts 34 (Hansen pattern) + 38 (per-ecoregion reference output) |
| `scripts/32_hrc_v2_1_tapajos_tiles_v2_2.js` | Tapajós v2.2 tile pipeline — same structure as the IDF version in `31_..._v2_2.js`, with Path B inline instead of Path A | `scripts/31_hrc_v2_1_idf_tiles_v2_2.js` |

The import script (`scripts/import_hrc_v2_2_tiles.py`) already accepts any v2.2 tile CSV that matches the column contract — no changes needed there as long as Path B's tile CSV writes the same columns (it should).

---

## §7 — Acceptance criteria (run before importing to production)

| Check | Pass criterion |
|---|---|
| Intact-mask area sanity check matches script 34's print statement | Tapajós box reports ~4,500 km² intact area. Lower means the `unmask(0)` trap fired. |
| Tapajós-Xingu moist forests `albedo_ref_p50` is plausible for tropical evergreen | Range 0.12 – 0.16 (per K67 reading of 0.116 and broader-canopy expectation). |
| All four Tapajós ecoregions report `status = 'enabled'` | If any disable, investigate before importing — Tapajós's Hansen coverage should comfortably pass the gates. |
| K67 flux tower pixel v2.2 score within 0.5 of v2.1.1 value (5.62) | Hard gate, mirrors IDF's FR-Fon gate. Phase 0 smoke test predicts ~5.62 (drift ~0.06 at w=0.20 with K67 sitting near the intact reference). |
| BR-163 cleared patch drops by at least 0.20 versus v2.1.1 | Hard gate. Phase 0 found this pixel at lc_type1=10 (grassland) with EF 0.564; under Path B with reference ~0.13 and pixel albedo 0.148, the deficit ≥ 0.13 produces a drop of ~0.15 at w=0.20. **If the drop is smaller than the IDF Beauce drop (0.22), check the reference computation — Tapajós's pixel albedo deficit should be larger, not smaller.** |
| `reference_p90_v2_2` shift versus existing v2.1.x reference within ±0.5 | Sanity check — large shifts indicate the median-by-construction assumption is not holding for Path B's intact-pixel set. |
| Smoke test re-run with Tapajós measured-deficit numbers from this Path B exports | Update `scripts/albedo_modifier_phase0_smoke_test.py` priors for `p3_k67` and `p4_br163` from the deficit=0 Path A fallback to the measured Path B values, then re-run. Should pass at w=0.20. |

---

## §8 — Open decisions for the Path B author

1. **Sampling resolution.** Hansen is 30 m; MCD43A3 is 500 m. The albedo image is at 500 m, so the natural reduction scale is 500 m. But Hansen at 30 m could be aggregated to 500 m as "fraction of intact" first (then masking only pixels with fraction ≥ some threshold). Decision: start at 500-m reduction over a 30-m intact mask (the script 34 convention) and verify the intact-pixel counts are stable.
2. **Whether to also write the per-pixel scored intact CSV** as a Phase 1 deliverable. Pro: makes the Path B audit trail concrete. Con: adds 100k+ rows of CSV. Decision: start without it; add only if the per-ecoregion summary turns out to be too coarse for review.
3. **Whether the Path B trust gate should also include a PA-coverage check.** The current proposal drops it (replaced by intact-coverage). The PA-coverage gate's job in Path A was to prove the centroid pool was representative; Path B's intact-pixel pool is itself the evidence of intact land, so the PA gate is redundant. Decision: drop unless a reviewer wants belt-and-braces.
4. **Whether to recompute the v2.1.x HRC reference from Path B's intact-pixel set** for consistency with the v2.2 reference. Currently the v2.1.x reference is from script 34 (p90 of intact-pixel HRC, K67 fallback to 7.89). The v2.2 reference would be from this new Path B script (p90 of intact-pixel v2.2 score). They'd use the same pixel set, just different scoring. Decision: yes — emit both in the same CSV so the import script can populate `hrc_reference` and `reference_p90_v2_2` from a single source.

---

## §9 — What this does NOT do

- Does **not** ship a Phase 2 cryosphere two-sided penalty. Tapajós is tropical; cryosphere handling remains deferred.
- Does **not** change the IDF Path A reference. IDF stays on centroid sampling — Path A passes its trust gate there.
- Does **not** unify the Path A and Path B trust-gate threshold definitions. They are intentionally different because the underlying sample units (centroids vs pixels) have different scale and noise characteristics. The unified contract is at the *output* layer — both produce `albedo_ref_p50`, `albedo_modifier_status`, `albedo_modifier_disabled_reason`, `reference_p90_v2_2`, and (new) `reference_method`.
- Does **not** address the BR-163 clearance-patch's expected drop magnitude as a release-blocker. The handoff's hard gate is `drop ≥ 0.20`; Phase 0 measurements suggest ~0.15 at w=0.20. If the measured drop falls short, treat it as a calibration finding (analogous to v1.2's Beauce 0.20 → 0.15 patch) rather than a blocker.

---

## §10 — Effort estimate

One day for the GEE script (closely modelled on scripts 34 and 38, both already validated). One day for the tile pipeline (closely modelled on script 31_..._v2_2.js). Half a day for the import + verification. Total: ~2.5 days, including the smoke-test re-run and acceptance gates.

Phase 1 IDF deployment can proceed independently of this work. Tapajós tiles will continue to display v2.1.2 (modifier disabled with reason `insufficient_samples`) until Path B is built and imported — the front-end disabled-state UI from IDF carries over without change.
