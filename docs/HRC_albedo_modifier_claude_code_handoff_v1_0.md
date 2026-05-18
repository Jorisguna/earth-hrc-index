# Heat Regulation Capacity Index — Ecoregion-Relative Albedo Modifier
## Claude Code Build Handoff

**Version:** v1.0
**Date:** May 2026
**Status:** Work stream initiated; design complete; no code written yet
**Purpose:** Promote the existing Tier B `Albedo_deficit` term into Tier A as an ecoregion-relative ecosystem-health modifier, with a "trust the data" gate that disables the term in ecoregions where the albedo reference cannot be computed reliably. This work stream is split into a mandatory Phase 0 diagnostic and a Phase 1 production deployment; Phase 1 is gated on Phase 0 sign-off.

**For:** Claude Code, executing in a fresh context window from the local repository at `/Users/jorisgunawardena/earth-hrc-index` (or equivalent).

---

## What this is

A handoff document capturing the decision context, the proposed Tier A formula change, the implementation pattern for the new ecoregion-relative albedo reference, the trust-the-data check that gates the term, the validation plan against existing pixels in Île-de-France and Tapajós, and the explicit go/no-go decision criteria. Read this document first when starting the next session; everything below is what a fresh thread needs.

This is a *validation-then-deploy* work stream. The deliverable is, first, Phase 0 evidence and a recommendation; then, if approved, a Phase 1 v2.2 production deployment.

---

## Quick orientation — existing project documents

Read in order before starting:

1. **`HRC_Index_Technical_Whitepaper_v1.0.docx.md`** — Section 2.2 defines the existing Tier B formula and the `Albedo_deficit` term. This work stream brings that term into Tier A.
2. **`HRC_higher_fidelity_methodology_v2_1_1.md`** — the v2.1.1 operational methodology paper. Defines the formula, the three-method intact-site reference framework, the validated pipeline architecture.
3. **`HRC_intact_site_reference_methodology_v2_0.md`** — Sections 2 to 4. The centroid-sampling pattern, the 20-sample minimum threshold, the International Union for Conservation of Nature (IUCN) management-category filter. The albedo reference reuses this entire pattern.
4. **`HRC_v2_1_claude_code_handoff_v2_1_1.md`** — the schema, the Earth Engine pipeline file structure, the acceptance-gate convention.
5. **`HRC_option_4_phase_0_sampling_diagnostic_handoff_v1_0.md`** — the most directly analogous prior work stream. The Phase 0 design here follows the same structure.

If anything in this handoff conflicts with the methodology paper, the methodology paper wins. Escalate to the project owner.

---

## Project context — one paragraph

The Heat Regulation Capacity Index scores every land tile from zero to ten by what fraction of received energy the surface moves through evaporation. The current Tier A formula is purely the evaporative fraction (latent heat flux divided by net radiation). The Tier B fallback formula already includes an albedo-deficit term at ten percent weight, but only fires when cloud cover prevents direct evapotranspiration retrieval. This work stream promotes that term into Tier A so that ecosystem health — the difference between a healthy transpiring forest and a deforested patch of comparable evaporative fraction — is captured in the headline score. The promotion is gated on a per-ecoregion data-quality check that disables the term where the reference cannot be reliably computed.

---

## 1. Why this work stream exists

The current Tier A formula treats two pixels with the same evaporative fraction identically, regardless of how the surface looks. Two specific cases motivate the change:

**Case A — degraded forest patches in vegetated ecoregions.** A clearance patch in the BR-163 corridor near Tapajós has low evaporative fraction (around 0.20) and anomalously high albedo (around 0.30 versus a surrounding intact rainforest reference of around 0.13). Pure evaporative fraction scores it at 2.0. A score this high under-states the loss because it does not register that the surface is also failing on the reflective/structural axis. The pixel reads as "slightly underperforming" when it is fully degraded.

**Case B — bright sealed urban surfaces.** A central Paris pixel has very low evaporative fraction and high broadband albedo from light-coloured roofs and concrete. Pure evaporative fraction registers the absence of cooling. The albedo signal is independent confirmation, currently discarded.

The change is *not* a replacement of the evaporative fraction. The evaporative fraction stays as the dominant signal at eighty-five percent weight. The albedo modifier is a fifteen percent ecosystem-health correction that uses independent information already produced by the upstream Moderate Resolution Imaging Spectroradiometer (MODIS) Bidirectional Reflectance Distribution Function-Adjusted Broadband Albedo (MCD43A3) product.

A second motivating constraint is **what the change must *not* do to legitimate reflective surfaces** (Greenland ice, the Sahara, Antarctic shelf). The previous proposal — a global low-albedo bonus — would have inverted the meaning of the index in cryosphere regions. The ecoregion-relative form fixes this: a Greenland pixel is compared to Greenland's own intact reference, not to a tropical forest. The trust-the-data gate (Section 4 below) is the safety mechanism that catches the cases where even ecoregion-relative comparison cannot be done reliably.

---

## 2. The formula change

Current Tier A (v2.1.1):
```
HRC_A = 10 × clip(latent_heat_flux / net_radiation, 0, 1)
```

Proposed Tier A (v2.2):
```
HRC_A_v2_2 = 10 × ((1 − w) × EF + w × (1 − Albedo_deficit_norm))
```

Where:
- `EF` = `clip(latent_heat_flux / net_radiation, 0, 1)` — unchanged from v2.1.1.
- `w` = 0.15 — the weight of the albedo term. Range to test in Phase 0: 0.10, 0.15, 0.20.
- `Albedo_deficit_norm` is computed per-ecoregion per Section 3 below, with `clip(0, 1)` applied. Zero when the pixel is at or darker than its ecoregion's intact-reference albedo. One when the pixel is at the full penalty cap.
- The term is **disabled** (effective weight zero, full evaporative-fraction-only score) in ecoregions that fail the trust-the-data check in Section 4. In those ecoregions, `HRC_A_v2_2 = 10 × EF` — identical to v2.1.1.

A healthy intact forest scores essentially unchanged (deficit is zero, the bracket equals `(1 − w) × EF + w × 1` ≈ `EF` when `EF` is near 1.0 *and* the pixel matches its reference). A degraded patch with the same evaporative fraction but high albedo scores noticeably lower. A snowfield in its native ecoregion scores unchanged.

---

## 3. The ecoregion-relative albedo reference

The albedo reference reuses the centroid-sampling pattern from `HRC_intact_site_reference_methodology_v2_0.md` exactly. The only differences are the sampled variable (MCD43A3 broadband albedo instead of HRC score) and the percentile (50th — the median intact-typical value — instead of 90th — the aspirational maximum used for the HRC reference).

For each RESOLVE 2017 ecoregion intersecting the bounding box:

1. Filter World Database on Protected Areas (WDPA) polygons by `STATUS = 'Designated'` and IUCN category list (Ia, Ib, II, III, IV for strict-protection biomes; expanded to V, VI for biomes where strict coverage is insufficient — see `HRC_intact_site_reference_methodology_v2_0.md` Section 3 for the per-region rules).
2. Convert each polygon to its centroid (matches existing pattern, avoids the geometry-union and image-mask failures documented in Section 2.2 of the existing methodology).
3. Sample MCD43A3 black-sky shortwave albedo (`Albedo_BSA_shortwave`, scale 0.001) at each centroid, using the same time window as the HRC score (calendar year 2023 for the current showcase regions).
4. **Apply the trust-the-data filter (Section 4 below).** Remove centroids classified as water, urban, or cropland by MCD12Q1.
5. If twenty or more valid centroids remain, compute the 50th percentile (median) of the surviving centroid albedos and store as `albedo_ref_p50`. Also store p25 and p75 for distribution diagnostics.
6. If fewer than twenty valid centroids remain, store a null reference and set `albedo_ref_status = 'insufficient_samples'`.

Per pixel:
```
Albedo_deficit_raw  = pixel_albedo − albedo_ref_p50
Albedo_deficit_norm = clip(Albedo_deficit_raw / albedo_ref_p50, 0, 1)
```

The `clip(0, ...)` floor is asymmetric: only positive deficits (pixel brighter than reference) are penalised. Darker-than-reference pixels (denser canopy, organic litter, wet soil) get the full reward. This is the correct asymmetry for vegetated biomes. Cryosphere handling — where lost albedo should *also* be penalised — is deferred (Section 5).

**Why the 50th percentile, not the 90th.** For evaporative fraction, the 90th percentile is the right reference because the score is measuring aspirational performance (what the best intact sites achieve). For albedo, the reference is *typical intact* — the median is the right summary because departures from typical, in either direction, are the signal. The 90th percentile of intact albedo would punish naturally-dark intact patches; the median does not.

---

## 4. The trust-the-data check

This is the safety gate the project owner specifically requested. It has two parts.

### 4.1 Per-centroid filter (within an ecoregion)

Reject a centroid from the reference computation if **any** of these is true:

- MCD12Q1 Land Cover Type 1 class at the centroid is **17** (Water Bodies)
- MCD12Q1 class is **13** (Urban and Built-Up)
- MCD12Q1 class is **12** (Cropland) or **14** (Cropland / Natural Vegetation Mosaic)
- The mean of (class 11 OR class 17) within a 500-metre buffer of the centroid exceeds 0.25 (the centroid is dominated by water or wetland edge)

This is the same filter used in `HRC_option_4_phase_0_sampling_diagnostic_handoff_v1_0.md` for the evaporative fraction reference contamination check, applied here to the albedo reference.

### 4.2 Per-ecoregion gate

After centroid filtering, the ecoregion's albedo term is **enabled** only if **all** of:

- At least twenty valid centroids remain (`albedo_ref_status = 'sufficient'`)
- The interquartile range of the surviving centroid albedos is less than 0.10 (a noisy reference is not a usable reference)
- Protected-area coverage of the ecoregion is at least five percent of the ecoregion's total land area (matches existing v2.0 ecoregion-flagging convention from `HRC_Index_Technical_Whitepaper_v1.0.docx.md` Section 9.3)
- The ecoregion's biome is not a cryosphere biome (Section 5; deferred to Phase 2)

If any gate fails, the ecoregion is recorded with `albedo_modifier_status = 'disabled'` and its tiles compute `HRC_A_v2_2 = 10 × EF` (identical to v2.1.1). The reason for the disable is written into a new `albedo_modifier_disabled_reason` column so the front-end can show "no albedo modifier applied — insufficient reference data" rather than silently dropping the term.

This is the critical honesty mechanism. The formula is only applied where the data supports it; where it does not, the score falls back to the simpler, slightly weaker, but reliable evaporative-fraction-only version. The user sees which version a tile is on.

---

## 5. Biome-conditional asymmetry (cryosphere handling — deferred)

The Section 3 formula penalises pixels brighter than the intact reference. This is correct for vegetated biomes. It under-penalises cryosphere biomes — sea ice that has been lost is *darker* than its reference, not brighter, and a one-sided positive-deficit penalty misses this.

For Phase 1 of this work stream, the asymmetric (vegetated) form is sufficient because none of the current showcase regions (Île-de-France, Tapajós, Wales, Los Angeles) are cryosphere ecoregions. The cryosphere handling is documented here as a deferred Phase 2 design note rather than implemented.

The intended Phase 2 rule:

- Look up the RESOLVE 2017 biome for the ecoregion.
- For biome 11 (Tundra) and any high-latitude polar biome: apply both-direction penalty `Albedo_deficit_norm = clip(|pixel_albedo − albedo_ref_p50| / albedo_ref_p50, 0, 1)`.
- For all other biomes: apply the asymmetric positive-deficit form from Section 3.

Until Phase 2 is built, cryosphere ecoregions are flagged in Section 4 and the albedo modifier is disabled there even if the other trust gates pass. This is implemented as a hard biome-list check in the pipeline, with `albedo_modifier_disabled_reason = 'cryosphere_biome_phase2_deferred'`.

---

## Phase 0 — Diagnostic before any production change

**Mandatory. Phase 1 production deployment does not start until Phase 0 outputs have been reviewed by the project owner.**

### 6.1 Phase 0 goal

Compute the v2.2 score as a parallel calculation on a small diagnostic panel and confirm the score changes go in the expected direction at expected magnitudes. The production tiles continue to display the v2.1.1 score throughout Phase 0. No live user-facing score changes.

### 6.2 Phase 0 diagnostic panel

Six pixels, chosen to span the regime space:

| # | Pixel | Coordinates | Regime | v2.1.1 score | Expected v2.2 score | Expected direction |
|---|---|---|---|---|---|---|
| 1 | FR-Fon flux tower | 48.476°N, 2.780°E | Intact temperate broadleaf forest | 5.70 (validated) | 5.5 – 5.8 | Unchanged or slight drop |
| 2 | Beauce agricultural plain (illustrative) | ~48.4°N, 1.8°E | Cropland in temperate broadleaf forest ecoregion | ~5.0 – 5.5 | 4.0 – 4.8 | Notable drop (cropland brighter than forest reference) |
| 3 | K67 flux tower | -2.857°S, -54.959°W | Intact humid tropical evergreen forest | 5.62 (validated, MODIS land surface temperature cold bias documented) | 5.4 – 5.7 | Unchanged or slight drop |
| 4 | BR-163 cleared patch (illustrative) | ~-3.05°S, -55.0°W | Recent deforestation, Tapajós region | ~2.0 – 3.0 | 1.4 – 2.3 | Notable drop |
| 5 | Paris urban core | ~48.86°N, 2.35°E | Sealed urban surfaces | ~1.0 – 1.5 | 0.7 – 1.2 | Drop (bright roofs against forest reference) |
| 6 | Disabled-ecoregion control | any ecoregion that fails Section 4 | Pick from the per-ecoregion gate output | as v2.1.1 | Identical to v2.1.1 | **No change** (term disabled) |

Pixels 2, 4, and 6 must be confirmed against MCD12Q1 land-cover class before being included in the panel; substitute equivalents if the proposed coordinates are misclassified.

### 6.3 Phase 0 acceptance criteria

| Check | Pass criterion |
|---|---|
| Albedo reference computation produces a 50th-percentile value for the European Atlantic mixed forests ecoregion | Reference value plausible (range 0.10 – 0.18 for broadleaf forest) |
| Trust-the-data filter removes water/urban/cropland centroids | Reported count of removed centroids; surviving count at least twenty |
| FR-Fon tower pixel v2.2 score within 0.5 of v2.1.1 value | **Hard gate** — the intact reference pixel must not move materially |
| K67 tower pixel v2.2 score within 0.5 of v2.1.1 value | **Hard gate** — same reason |
| BR-163 clearance pixel drops by at least 0.3 versus v2.1.1 | **Hard gate** — the whole point. If degraded pixels do not drop, the change is purely cosmetic |
| Beauce cropland pixel drops by at least 0.5 versus v2.1.1 | Cropland-against-forest-reference is the largest expected effect |
| At least one ecoregion in the panel fails the Section 4 trust gate | Confirms the trust mechanism is firing somewhere; if it never fires, it is not protecting anything |
| Per-pixel change distribution is reported, not just means | The *shape* of the change matters; a few large outliers indicate a bug |
| `albedo_modifier_disabled_reason` populated correctly | Every disabled ecoregion has a non-null reason; every enabled ecoregion has a null reason |
| Sensitivity sweep: scores reported at w = 0.10, 0.15, 0.20 | Project owner picks the weight from this sweep |

### 6.4 Phase 0 deliverables

- **Earth Engine script:** `60_albedo_modifier_phase0_diagnostic.js` — runs the v2.2 score as a parallel calculation on the six-pixel panel, exports comma-separated values files. Reuses the existing v2.1.1 pipeline output where possible rather than recomputing it.
- **Python analysis script:** `albedo_modifier_phase0_analysis.py` — reads the comma-separated values output, computes the binning summaries, prints the human-readable acceptance table.
- **Output artefacts:**
  - `validation_artefacts/albedo_modifier_phase0/diagnostic_panel_scores_v1.csv` — the six-pixel comparison.
  - `validation_artefacts/albedo_modifier_phase0/ecoregion_reference_summary_v1.csv` — per-ecoregion `albedo_ref_p50`, sample count after filter, trust gate status, disable reason.
  - `validation_artefacts/albedo_modifier_phase0/albedo_modifier_phase0_report_v1.md` — the summary written by the Python script.
- **Decision note:** `HRC_albedo_modifier_phase0_findings_v1.md` — captures the diagnostic result and the recommendation on whether Phase 1 proceeds, what weight to use, and any ecoregions to gate off in Phase 1.

### 6.5 Phase 0 effort

One to two days. The Earth Engine work is the centroid-sampling pattern already in production for the evaporative fraction reference, applied to a second variable. The trust-the-data filter is a new but small piece. The diagnostic panel is six points, not a regional pipeline.

---

## Phase 1 — Production deployment (only if Phase 0 passes)

### 7.1 Phase 1 goal

Promote the validated v2.2 formula to production on the Île-de-France and Tapajós higher-fidelity tiles. Existing v2.1.1 tiles are retained alongside; the application programming interface (API) can serve either methodology version on request, per the existing convention from `HRC_Index_Technical_Whitepaper_v1.0.docx.md` Section 8 on versioning.

### 7.2 Phase 1 files to create or modify

| File | Action | Purpose |
|---|---|---|
| `sql/005_albedo_modifier_v2_2.sql` | Create | Adds columns `albedo_ref_p50`, `albedo_deficit_norm`, `albedo_modifier_status`, `albedo_modifier_disabled_reason`, `hrc_score_v2_2`, `methodology_version` (already exists — extend valid values), `albedo_data_source` to `hrc_tiles`. Additive, reversible. |
| `earth_engine/61_albedo_reference_idf_v1.js` | Create | Computes ecoregion albedo references for the Île-de-France bounding box, applying the trust-the-data filter. Exports a per-ecoregion comma-separated values file. |
| `earth_engine/62_albedo_reference_tapajos_v1.js` | Create | Same for Tapajós. |
| `earth_engine/31_hrc_v2_1_idf_tiles_v2_2.js` | Create (new version of existing v2.1.1) | Île-de-France tile pipeline updated to compute the v2.2 score using the joined ecoregion albedo reference. Exports a v2.2 tile comma-separated values file. |
| `earth_engine/32_hrc_v2_1_tapajos_tiles_v2_2.js` | Create (new version of existing v2.1.1) | Same for Tapajós. |
| `scripts/import_hrc_v2_2_tiles.py` | Create | Imports the v2.2 tile comma-separated values files into Supabase, populating the new columns. |
| `web/components/BioregionCard.tsx` | Modify | Adds the v2.2 score row with a tooltip explaining the methodology. Adds a "no albedo modifier — insufficient reference data" label when disabled. |
| `web/components/MethodologyToggle.tsx` | Modify (or create) | Adds a v2.1.1 / v2.2 methodology toggle. Defaults to v2.2 for new tiles, v2.1.1 for older tiles. |
| `HRC_higher_fidelity_methodology_v2_2.md` | Create | Methodology paper update. New Section 7.13 describes the albedo modifier, the trust-the-data check, the cryosphere deferral, and the Phase 0 validation results. |
| `README.md` | Modify | Brief note on v2.2 deployment. |

### 7.3 Phase 1 acceptance gate

Every row below is checked before pushing to production:

| Check | Pass criterion |
|---|---|
| Phase 0 outputs reviewed and signed off by project owner | Documented |
| Schema migration applied without breaking existing application | All v2.1.1 tiles still render correctly |
| FR-Fon pixel v2.2 score within 0.5 of v2.1.1 value | **Hard gate** |
| K67 pixel v2.2 score within 0.5 of v2.1.1 value | **Hard gate** |
| Per-region mean v2.2 score within 1.0 of v2.1.1 mean | Soft gate; large divergence triggers investigation |
| Every disabled ecoregion has populated `albedo_modifier_disabled_reason` | No silent disables |
| Front-end correctly shows "albedo modifier applied / not applied" state | Both states observable in the panel |
| `albedo_data_source` populated on every v2.2 tile | Sensor-provenance traceable |
| Methodology paper v2.2 includes the full formula and the trust-the-data rule | Documented |
| API v2.1.1 endpoint still returns v2.1.1 scores | Backward compatibility |

### 7.4 Phase 1 effort

Three to five days after Phase 0 sign-off. Most of the work is repetition of existing patterns (centroid sampling, schema migration, application card row); the new work is the trust-the-data filter wired in.

---

## 8. Risks and blind spots

**Sensor drift across MODIS Terra-to-VIIRS transition.** The albedo reference is computed from MCD43A3, which uses MODIS Terra and Aqua. MODIS Terra is past its design life. The replacement product line (Visible Infrared Imaging Radiometer Suite — VIIRS — derived) uses a different Bidirectional Reflectance Distribution Function correction and a step change in observed broadband albedo is plausible at the transition. Build the sensor source into a `albedo_data_source` metadata column on every tile from day one; if a sensor transition introduces a step change in the reference, the ecoregion-relative reference will move and every restoration gap will discontinuously change for reasons that are sensor-artefact, not real land change. Detection requires the source column.

**Seasonal aliasing in temperate and boreal regions.** Broadleaf forests in winter are bare and brighter; conifers under snow can be either bright or dark depending on canopy closure. A single annual mean albedo gives a noisy reference. The Phase 0 diagnostic should report the seasonal standard deviation of the surviving centroid albedos; if it exceeds 0.05, document the limitation and consider season-stratified references as a Phase 2 extension.

**Cropland-dominated ecoregions.** RESOLVE 2017 ecoregions in heavily converted regions have few intact protected areas. Even after filtering, surviving centroids may be in unrepresentative remnant fragments. The Phase 0 sensitivity check should report what happens to the reference when the lowest-confidence centroid is removed; if the reference moves more than 0.05 in albedo, the ecoregion gate should fire and the modifier should be disabled.

**The cropland-versus-forest direction is the largest expected effect, and it is also the most contested.** Intensive irrigated cropland with low albedo and high evaporative fraction (e.g. flooded paddy, irrigated maize at peak season) will *not* be penalised by this term. The user blind spot from the prior conversation — "this rewards industrial monoculture as much as old-growth forest" — is **not** addressed by this work stream. The albedo modifier penalises bright cleared land. It does not detect monoculture-versus-natural. A separate biodiversity or canopy-structure proxy work stream remains the next step if the project owner wants that distinction in the score.

**Trust-the-data filter may be too strict.** With a twenty-centroid minimum, plus an interquartile-range gate, plus a five-percent-protected-area floor, a meaningful fraction of global RESOLVE ecoregions will fail and fall back to pure evaporative fraction. The Phase 0 diagnostic should report the global count of pass-versus-fail ecoregions (computed cheaply via the existing intact site reference table) so the project owner can see how much of the global map the modifier will actually affect. If it is less than thirty percent of land area, the work stream's headline impact is overstated and the priority of Phase 1 should be reconsidered.

**Urban heat-island confound.** Paris drops further under v2.2 than under v2.1.1 because the urban surface is brighter than the European Atlantic mixed forests reference. Some of that drop is correct (loss of cooling capacity); some may be confounded with the urban heat-island physics already flagged as needing a separate correction in Section 9.4 of the whitepaper. Phase 0 surfaces the magnitude; Phase 1 deploys without urban-specific correction; the urban correction remains a separate, deferred work stream.

---

## 9. What this work stream does NOT do

Explicit non-goals to prevent scope creep:

- Does **not** implement the cryosphere-biome two-sided albedo penalty (deferred to Phase 2; vegetated biomes only for v2.2).
- Does **not** change the evaporative fraction formula or any of the upstream evapotranspiration or net radiation inputs.
- Does **not** change the intact-site reference for the HRC score itself (90th percentile of HRC, not albedo) — that remains unchanged.
- Does **not** implement the urban heat-island correction (Section 9.4 of the whitepaper) — Paris drop in Phase 0 may surface the need but the fix is a separate work stream.
- Does **not** extend to new regions (Wales, Los Angeles remain on v2.0; v2.2 is Île-de-France and Tapajós only initially).
- Does **not** implement biodiversity, canopy-structure, or hydrological connectivity proxies — those address a different blind spot, deferred.
- Does **not** update the Trend Score or the Restoration Gap calculations to be cross-methodology comparable. The gap remains `reference_p90 − relative_score`, with both terms computed under the same methodology version. v2.2 vs v2.1.1 gap-versus-gap comparison is a separate study.

---

## 10. Communication during build

The project owner is non-technical. Implementation details should be discussed at the level of "what was built and why" rather than at the level of code structure. Specifically:

- **After Phase 0 completes:** report the six-pixel comparison table. Confirm the cropland-versus-forest direction is correctly recovered — that is the headline result.
- **Before starting Phase 1:** confirm with the project owner which weight (0.10, 0.15, or 0.20) to use, based on the Phase 0 sensitivity sweep.
- **After Phase 1 schema migration:** confirm existing v2.1.1 tiles still render correctly.
- **After Phase 1 pipeline runs:** report the regional mean v2.2 score for both regions, and the fraction of tiles with the modifier enabled versus disabled.
- **After Phase 1 deploy:** link to the live application showing the v2.1.1 / v2.2 toggle. Demonstrate the "modifier disabled — insufficient reference data" state on at least one tile so the project owner can see the trust mechanism working in production.

Code-level explanations only on request. The methodology paper v2.2 exists for the project owner to reference for any "why does it do that?" question.

---

## 11. Reference summary

Quick lookup for the most-needed facts:

**Formula:**
```
HRC_A_v2_2 = 10 × ((1 − w) × EF + w × (1 − Albedo_deficit_norm))
```
where `w = 0.15` (default; swept 0.10 / 0.15 / 0.20 in Phase 0), `EF = clip(λE / Rn, 0, 1)`, and `Albedo_deficit_norm = clip((α_pixel − α_ref_p50) / α_ref_p50, 0, 1)`.

**Disable rule:** if the ecoregion fails the Section 4 trust-the-data check, `HRC_A_v2_2 = 10 × EF` — identical to v2.1.1.

**Trust gates (all must pass to enable the modifier):**
- Twenty or more valid centroids after water/urban/cropland filter.
- Interquartile range of surviving centroid albedos below 0.10.
- Protected-area coverage of ecoregion at least five percent.
- Biome is not cryosphere (Phase 2 deferral).

**Earth Engine collections used:**
- `MODIS/061/MCD43A3` band `Albedo_BSA_shortwave` — broadband black-sky shortwave albedo, scale 0.001. The albedo source.
- `MODIS/061/MCD12Q1` band `LC_Type1` — for the per-centroid land-cover filter.
- `WCMC/WDPA/current/polygons` — protected area polygons.
- `RESOLVE/ECOREGIONS/2017` — ecoregion polygons and biome codes.
- The existing v2.1.1 Heat Regulation Capacity output for the showcase regions (Earth Engine asset or recomputed inline via existing pipeline).

**MCD12Q1 IGBP class codes used in the filter:**
- Class 11: Permanent Wetland (penalise via 500-metre buffer fraction)
- Class 12: Cropland (reject centroid)
- Class 13: Urban and Built-Up (reject centroid)
- Class 14: Cropland / Natural Vegetation Mosaic (reject centroid)
- Class 17: Water Bodies (reject centroid)

**Time window:** calendar year 2023 (matches v2.1.1). To be revised if a sensor transition or product update changes the operational window.

**Showcase regions:**
- Île-de-France: `[2.4, 48.3, 3.2, 48.7]`
- Tapajós: `[-55.4, -3.3, -54.5, -2.4]`

**Key validated anchors (from `HRC_v2_1_2_validation_case_studies.md` / `HRC_v2_1_1_validation_case_studies.md`):**
- FR-Fon tower pixel v2.1.1 score: **5.70**
- K67 tower pixel v2.1.1 score: **5.62**
- Île-de-France regional mean v2.1.1: **5.92**
- Tapajós regional mean v2.1.1: **5.71**
- European Atlantic mixed forests intact reference (Heat Regulation Capacity, Path A, v2.1.1): **6.47**

**Files to be created (Phase 0):**
- `earth_engine/60_albedo_modifier_phase0_diagnostic.js`
- `scripts/albedo_modifier_phase0_analysis.py`
- `validation_artefacts/albedo_modifier_phase0/diagnostic_panel_scores_v1.csv`
- `validation_artefacts/albedo_modifier_phase0/ecoregion_reference_summary_v1.csv`
- `validation_artefacts/albedo_modifier_phase0/albedo_modifier_phase0_report_v1.md`
- `HRC_albedo_modifier_phase0_findings_v1.md`

**Files to be created (Phase 1, only if Phase 0 passes):**
- `sql/005_albedo_modifier_v2_2.sql`
- `earth_engine/61_albedo_reference_idf_v1.js`
- `earth_engine/62_albedo_reference_tapajos_v1.js`
- `earth_engine/31_hrc_v2_1_idf_tiles_v2_2.js`
- `earth_engine/32_hrc_v2_1_tapajos_tiles_v2_2.js`
- `scripts/import_hrc_v2_2_tiles.py`
- `HRC_higher_fidelity_methodology_v2_2.md`

**Files NOT to modify:**
- The current v2.1.1 production pipeline scripts.
- The Wales and Los Angeles v2.0 tile pipelines.
- The intact-site reference computation for the Heat Regulation Capacity score itself.
- The Trend Score or Restoration Gap calculations.
- The Ocean Extension scoring framework.

**Estimated total work-stream effort:** one to two days for Phase 0; three to five days for Phase 1 after Phase 0 sign-off. Total four to seven days.

**Deliverable:** a short markdown decision note at end of Phase 0 (`HRC_albedo_modifier_phase0_findings_v1.md`), followed — if approved — by a v2.2 production deployment with parallel v2.1.1 / v2.2 toggle in the front-end and an updated methodology paper.

---

This handoff document is sufficient for implementation. If a question arises that this document does not answer, escalate to the project owner before assuming a default.
