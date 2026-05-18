# Heat Regulation Capacity Index — Ecoregion-Relative Albedo Modifier
## Claude Code Build Handoff

**Version:** v1.1
**Date:** May 2026
**Status:** Work stream initiated; design complete; Phase 0 build under way against this patched formula.
**Patches applied:** v1.0 → v1.1 via HRC_albedo_modifier_handoff_v1_0_to_v1_1_patch.md (May 2026, formula corrected from additive to multiplicative after Phase 0 smoke test).
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

Proposed Tier A (v2.2, multiplicative form):
```
HRC_A_v2_2 = 10 × EF × (1 − w × Albedo_deficit_norm)
```

Where:
- `EF` = `clip(latent_heat_flux / net_radiation, 0, 1)` — unchanged from v2.1.1.
- `w` = 0.15 — the weight of the albedo penalty. Range to test in Phase 0: 0.10, 0.15, 0.20 (Option A conservative sweep).
- `Albedo_deficit_norm` is computed per-ecoregion per Section 3 below, with `clip(0, 1)` applied. Zero when the pixel is at or darker than its ecoregion's intact-reference albedo. One when the pixel is at the full penalty cap.
- The term is **disabled** (factor = 1, full evaporative-fraction-only score) in ecoregions that fail the trust-the-data check in Section 4. In those ecoregions, `HRC_A_v2_2 = 10 × EF` — identical to v2.1.1.

By construction:
- A pixel with `Albedo_deficit_norm = 0` (at or below the ecoregion intact reference) scores **exactly** `10 × EF`, identical to v2.1.1.
- A pixel with `Albedo_deficit_norm = 1` (at the full penalty cap) scores `10 × EF × (1 − w)` — a maximum reduction of `w × 100` percent.
- The penalty scales with both the deficit *and* the original evaporative fraction. A degraded high-EF surface loses more absolute score than a degraded low-EF surface. This is the correct physics: degradation of a high-cooling surface is a larger absolute loss of cooling work than degradation of a low-cooling surface.

### 2.1 Why multiplicative and not additive

An earlier draft of this handoff (v1.0) used an additive form `((1 − w) × EF + w × (1 − Albedo_deficit_norm))`. Phase 0 smoke testing showed this form lifts intact pixels above their v2.1.1 score by approximately `10 × w × (1 − EF)` — roughly +0.6 points at `w = 0.15` for a forest with `EF = 0.6` and deficit zero. The "intact unchanged" claim in the prose only holds at `EF ≈ 1.0`, which corresponds to no real surface.

The multiplicative form makes the "intact unchanged" claim exactly true by construction (factor is identically 1 when deficit is zero). It also matches the structure of most ecosystem-health modifiers in the published literature, where the penalty is a fractional reduction of the underlying capacity rather than a flat additive offset.

Two other formulations were considered:
- **Subtractive** (`10 × max(EF − w × deficit, 0)`) — satisfies "intact unchanged" but applies a flat penalty regardless of original evaporative fraction, which over-penalises low-EF surfaces such as semi-arid grasslands.
- **Power form** (`10 × EF × (1 − deficit)^w`) — well-behaved but harder to audit and harder to interpret in linear uncertainty propagation.

The multiplicative form was selected. Do not change it without a corresponding patch document and a re-run of the Phase 0 smoke test.

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

| # | Pixel | Coordinates | Regime | EF (synthetic prior) | Deficit (synthetic prior) | v2.1.1 score | Expected v2.2 score at w = 0.15 | Expected direction |
|---|---|---|---|---|---|---|---|---|
| 1 | FR-Fon flux tower | 48.476°N, 2.780°E | Intact temperate broadleaf forest | 0.57 | ≤ 0.05 | 5.70 (validated) | 5.66 — 5.70 | **Effectively unchanged** (drift ≤ 0.05) |
| 2 | Beauce agricultural plain (illustrative) | ~48.4°N, 1.8°E | Cropland in temperate broadleaf forest ecoregion | ~0.47 | ~0.39 | ~4.70 | ~4.43 | Drop of at least 0.20 |
| 3 | K67 flux tower | -2.857°S, -54.959°W | Intact humid tropical evergreen forest | 0.56 | ≤ 0.05 | 5.62 (validated) | 5.58 — 5.62 | **Effectively unchanged** (drift ≤ 0.05) |
| 4 | BR-163 cleared patch (illustrative) | ~-3.05°S, -55.0°W | Recent deforestation, Tapajós region | ~0.21 | ~0.92 | ~2.10 | ~1.81 | Drop of at least 0.20 |
| 5 | Paris urban core | ~48.86°N, 2.35°E | Sealed urban surfaces | ~0.10 | ~1.0 | ~1.00 | ~0.85 | Drop of at least 0.10 |
| 6 | Disabled-ecoregion control | any ecoregion that fails Section 4 | Pick from the per-ecoregion gate output | n/a | n/a | as v2.1.1 | Identical to v2.1.1 | **No change** (term disabled) |

The deficit values are synthetic priors used for Phase 0 acceptance calibration. Actual measured deficits at these pixels will be reported as part of the Phase 0 diagnostic output and may differ. The "expected v2.2 score" column gives the value the formula would produce at the synthetic prior, against which the measured score is compared.

Pixels 2, 4, and 6 must be confirmed against MCD12Q1 land-cover class before being included in the panel; substitute equivalents if the proposed coordinates are misclassified.

### 6.3 Phase 0 acceptance criteria

| Check | Pass criterion |
|---|---|
| Albedo reference computation produces a 50th-percentile value for the European Atlantic mixed forests ecoregion | Reference value plausible (range 0.10 — 0.18 for broadleaf forest) |
| Trust-the-data filter removes water/urban/cropland centroids | Reported count of removed centroids; surviving count at least twenty |
| FR-Fon tower pixel v2.2 score within 0.10 of v2.1.1 value | **Hard gate** — tightened from v1.0's 0.5 tolerance. The multiplicative form drifts the intact reference only by `w × deficit_at_tower`, which should be near zero for a validated intact pixel. |
| K67 tower pixel v2.2 score within 0.10 of v2.1.1 value | **Hard gate** — same logic |
| BR-163 clearance pixel drops by at least 0.20 versus v2.1.1 | **Hard gate**. Revised down from v1.0's 0.30; matches Option A conservative reading. If degraded pixels do not drop, the change is purely cosmetic. |
| Beauce cropland pixel drops by at least 0.20 versus v2.1.1 | **Hard gate**. Revised down from v1.0's 0.50; matches Option A conservative reading. |
| At least one ecoregion in the panel fails the Section 4 trust gate | Confirms the trust mechanism is firing somewhere; if it never fires, it is not protecting anything |
| Per-pixel change distribution is reported, not just means | The *shape* of the change matters; a few large outliers indicate a bug |
| `albedo_modifier_disabled_reason` populated correctly | Every disabled ecoregion has a non-null reason; every enabled ecoregion has a null reason |
| Sensitivity sweep: scores reported at w = 0.10, 0.15, 0.20 | Project owner picks the weight from this sweep |
| **New:** v2.2-recomputed reference (`reference_p90_v2_2`) reported alongside per-pixel scores | See Section 7.5. Restoration-gap comparison must use v2.2 reference against v2.2 score; mixing v2.1.1 reference with v2.2 pixel score is apples-to-oranges. |

Rationale for the tightened intact tolerance: under the v1.0 additive form, intact pixels could legitimately drift by approximately `10 × w × (1 − EF) ≈ 0.6` because of the formula bug, so the tolerance had to be 0.5 to avoid false-positive hard-gate failures. Under the v1.1 multiplicative form, an intact pixel drifts only by `10 × EF × w × deficit_local`, which for a tower pixel at its ecoregion intact reference should be at most 0.05 to 0.10. A larger drift indicates the tower pixel is not at the intact reference, which is informative diagnostic content in its own right.

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

### 6.6 Mandatory synthetic smoke test before any Earth Engine compute

The v1.0 formula bug was caught by a synthetic smoke test before Google Earth Engine compute was spent. The same gate applies to the patched v1.1 formula:

Before submitting any Earth Engine task that materialises the v2.2 score on real tiles, run a one-page Python (or Earth Engine console JavaScript) script that:

1. Hard-codes the five synthetic `(EF, deficit)` priors from the Section 6.2 panel.
2. Computes the v2.2 score under the multiplicative form at `w = 0.10, 0.15, 0.20`.
3. Confirms that each pixel's drift versus v2.1.1 matches the expected direction and magnitude in the Section 6.2 table.
4. Fails noisily if any check fails.

This is fifteen minutes of work and protects an hour of Google Earth Engine compute. The script lives at `scripts/albedo_modifier_phase0_smoke_test.py` and runs as the first item in the Phase 0 deliverables. The Phase 0 acceptance gate in Section 6.3 is run *after* the smoke test passes, not before.

This pattern — synthetic smoke test as Phase −1 — should be added to the pre-build validation process guide as a separate work-stream item.

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

### 7.5 Restoration gap reporting under v2.2

The restoration gap is `reference_p90 − relative_score`. Under v2.1.1 both terms are pure evaporative fraction. Under v2.2 multiplicative both terms include the albedo modifier.

If the v2.2 score is compared against the *v2.1.1* reference, the gap calculation is apples-to-oranges and will produce misleading values for partner-facing reporting. The reference itself must be recomputed under the v2.2 formula before any restoration gap is reported.

Specifically: the 90th percentile of centroid Heat Regulation Capacity scores must be recomputed using each centroid's v2.2 score, not its v2.1.1 score. A centroid whose albedo is slightly above the ecoregion's `albedo_ref_p50` will have a small positive deficit, so its v2.2 score will be slightly below its v2.1.1 score, and the 90th percentile of the centroid distribution will shift slightly. The shift is expected to be small (the median-by-construction implies most centroids have deficit near zero) but it must be measured and reported.

A new column `reference_p90_v2_2` is added to the ecoregion reference table. The restoration gap displayed for v2.2 tiles is computed as `reference_p90_v2_2 − HRC_score_v2_2`. The v2.1.1 reference is retained under its existing column name for backward compatibility.

Phase 0 must report `reference_p90_v2_2` for the European Atlantic mixed forests ecoregion and compare it to the existing `reference_p90` (= 6.47 under v2.1.1). If the shift exceeds 0.30, the project owner should be alerted before Phase 1 deployment — a large shift may indicate that the median-centroid assumption is not holding and the reference computation deserves a closer look.

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

**Formula (v1.1 multiplicative form):**
```
HRC_A_v2_2 = 10 × EF × (1 − w × Albedo_deficit_norm)
```
where `w = 0.15` (default; swept over 0.10 / 0.15 / 0.20 in Phase 0, Option A conservative range), `EF = clip(λE / Rn, 0, 1)`, and `Albedo_deficit_norm = clip((α_pixel − α_ref_p50) / α_ref_p50, 0, 1)`.

**Disable rule:** if the ecoregion fails the Section 4 trust-the-data check, the multiplier becomes 1 and `HRC_A_v2_2 = 10 × EF` — identical to v2.1.1.

**By construction:**
- Pixels at or below the ecoregion intact reference albedo score exactly `10 × EF`, identical to v2.1.1.
- Pixels at the full penalty cap (deficit = 1) score `10 × EF × (1 − w)`, a maximum reduction of `w × 100` percent.
- The penalty scales with both deficit and the original evaporative fraction.

**Why not additive:** see Section 2.1. The earlier additive form (v1.0 handoff) lifted intact pixels above their v2.1.1 scores due to a flat reward term that fired regardless of evaporative fraction. Multiplicative makes "intact unchanged" exactly true by construction.

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
- `scripts/albedo_modifier_phase0_smoke_test.py`
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
- (new column on existing reference table) `reference_p90_v2_2`

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
