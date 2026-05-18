# Heat Regulation Capacity Index — Ecoregion-Relative Albedo Modifier
## Patch document: v1.0 → v1.1

**Version:** v1.1 patch
**Date:** May 2026
**Status:** Patch to existing handoff; supersedes v1.0 Sections 2, 6.2, 6.3, and 11 (formula block) where specified
**Companion document:** `HRC_albedo_modifier_claude_code_handoff_v1_0.md` — read first; this patch lists the edits to apply.
**For:** Claude Code, executing in a fresh context window. Apply the edits below to the v1.0 handoff before starting any code work.

---

## Why this patch exists

Phase 0 smoke testing of the v1.0 handoff caught an algebraic error in the proposed Tier A v2.2 formula. The additive form in v1.0 Section 2 does not behave the way the prose claimed it would: intact forest pixels (evaporative fraction around 0.5 to 0.7, deficit around zero) get *boosted* by approximately `10 × w × (1 − evaporative_fraction)` — roughly +0.6 score points at `w = 0.15` — rather than staying unchanged. Three of the four Phase 0 hard gates fail under realistic synthetic inputs.

The root cause: in the additive formula `((1 − w) × EF + w × (1 − deficit))`, when deficit is zero the second term contributes a flat `w` independent of evaporative fraction. The "intact unchanged" claim only holds at evaporative fraction near 1.0, which corresponds to no real surface. The error was an over-eager analogy to the Tier B formula, which works because its weighted components sum to one and replace pure evaporative fraction entirely — a baseline that does not exist for Tier A.

This patch replaces the additive formulation with the multiplicative form, recalibrates the Phase 0 acceptance criteria, tightens the intact-pixel tolerance (which is now exactly zero drift by construction), and documents the restoration-gap interaction that needs to be reported in Phase 0.

The project owner has selected **Option A — conservative calibration**: weight sweep over `{0.10, 0.15, 0.20}`, with drop targets revised to at least 0.20 for both Beauce cropland and BR-163 clearance. The albedo modifier is a ten- to twenty-percent ecosystem-health correction, not a major recalibration.

Credit: Phase 0 smoke test (synthetic-input pre-flight) caught the formula bug before Google Earth Engine compute. The smoke-test pattern is recommended as Phase −1 for every future handoff that proposes a new formula and should be added to the pre-build validation process guide as a separate work-stream item.

---

## Files affected

- `HRC_albedo_modifier_claude_code_handoff_v1_0.md` — apply edits 1 through 6 below; save as v1.1 after applying.
- `HRC_higher_fidelity_methodology_v2_2.md` (does not yet exist; created in Phase 1) — incorporate the multiplicative form when first drafted; add a "lessons from Phase 0" note crediting the smoke test.

No code files are affected by this patch because no Phase 0 implementation has been written yet. The Earth Engine and Python scripts named in v1.0 Section 6.4 should be written against the patched v1.1 formula, not against the v1.0 formula.

---

## Edit 1 — Replace Section 2 (formula change)

**Find** the entire content of Section 2 in v1.0, beginning at the heading `## 2. The formula change` and ending immediately before `## 3. The ecoregion-relative albedo reference`.

**Replace with:**

```
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
```

---

## Edit 2 — Replace Section 6.2 (Phase 0 diagnostic panel)

**Find** the table beginning `| # | Pixel | Coordinates | Regime | v2.1.1 score | Expected v2.2 score | Expected direction |` in Section 6.2.

**Replace with:**

```
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
```

---

## Edit 3 — Replace Section 6.3 (Phase 0 acceptance criteria)

**Find** the table beginning `| Check | Pass criterion |` immediately under `### 6.3 Phase 0 acceptance criteria`.

**Replace with:**

```
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
| **New:** v2.2-recomputed reference (`reference_p90_v2_2`) reported alongside per-pixel scores | See Edit 5 below. Restoration-gap comparison must use v2.2 reference against v2.2 score; mixing v2.1.1 reference with v2.2 pixel score is apples-to-oranges. |

Rationale for the tightened intact tolerance: under the v1.0 additive form, intact pixels could legitimately drift by approximately `10 × w × (1 − EF) ≈ 0.6` because of the formula bug, so the tolerance had to be 0.5 to avoid false-positive hard-gate failures. Under the v1.1 multiplicative form, an intact pixel drifts only by `10 × EF × w × deficit_local`, which for a tower pixel at its ecoregion intact reference should be at most 0.05 to 0.10. A larger drift indicates the tower pixel is not at the intact reference, which is informative diagnostic content in its own right.
```

---

## Edit 4 — Insert new subsection 6.6 (smoke-test gate before Earth Engine compute)

**Find** the end of Section 6.5 (`### 6.5 Phase 0 effort`) and add immediately after it, before the start of Phase 1:

```
### 6.6 Mandatory synthetic smoke test before any Earth Engine compute

The v1.0 formula bug was caught by a synthetic smoke test before Google Earth Engine compute was spent. The same gate applies to the patched v1.1 formula:

Before submitting any Earth Engine task that materialises the v2.2 score on real tiles, run a one-page Python (or Earth Engine console JavaScript) script that:

1. Hard-codes the five synthetic `(EF, deficit)` priors from the Section 6.2 panel.
2. Computes the v2.2 score under the multiplicative form at `w = 0.10, 0.15, 0.20`.
3. Confirms that each pixel's drift versus v2.1.1 matches the expected direction and magnitude in the Section 6.2 table.
4. Fails noisily if any check fails.

This is fifteen minutes of work and protects an hour of Google Earth Engine compute. The script lives at `scripts/albedo_modifier_phase0_smoke_test.py` and runs as the first item in the Phase 0 deliverables. The Phase 0 acceptance gate in Section 6.3 is run *after* the smoke test passes, not before.

This pattern — synthetic smoke test as Phase −1 — should be added to the pre-build validation process guide as a separate work-stream item.
```

---

## Edit 5 — Add new subsection 7.5 (restoration gap reporting under v2.2)

**Find** the end of Section 7.4 (`### 7.4 Phase 1 effort`) and add immediately after it, before the start of Section 8:

```
### 7.5 Restoration gap reporting under v2.2

The restoration gap is `reference_p90 − relative_score`. Under v2.1.1 both terms are pure evaporative fraction. Under v2.2 multiplicative both terms include the albedo modifier.

If the v2.2 score is compared against the *v2.1.1* reference, the gap calculation is apples-to-oranges and will produce misleading values for partner-facing reporting. The reference itself must be recomputed under the v2.2 formula before any restoration gap is reported.

Specifically: the 90th percentile of centroid Heat Regulation Capacity scores must be recomputed using each centroid's v2.2 score, not its v2.1.1 score. A centroid whose albedo is slightly above the ecoregion's `albedo_ref_p50` will have a small positive deficit, so its v2.2 score will be slightly below its v2.1.1 score, and the 90th percentile of the centroid distribution will shift slightly. The shift is expected to be small (the median-by-construction implies most centroids have deficit near zero) but it must be measured and reported.

A new column `reference_p90_v2_2` is added to the ecoregion reference table. The restoration gap displayed for v2.2 tiles is computed as `reference_p90_v2_2 − HRC_score_v2_2`. The v2.1.1 reference is retained under its existing column name for backward compatibility.

Phase 0 must report `reference_p90_v2_2` for the European Atlantic mixed forests ecoregion and compare it to the existing `reference_p90` (= 6.47 under v2.1.1). If the shift exceeds 0.30, the project owner should be alerted before Phase 1 deployment — a large shift may indicate that the median-centroid assumption is not holding and the reference computation deserves a closer look.
```

---

## Edit 6 — Update Section 11 reference summary (formula block)

**Find** the formula block in Section 11 beginning `**Formula:**`.

**Replace with:**

```
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
```

Additionally **add** to the "Files to be created (Phase 0)" list in Section 11:
```
- `scripts/albedo_modifier_phase0_smoke_test.py`
```

Additionally **add** to the "Files to be created (Phase 1)" list in Section 11:
```
- (new column on existing reference table) `reference_p90_v2_2`
```

---

## After applying these edits

1. Save the patched document as `HRC_albedo_modifier_claude_code_handoff_v1_1.md`. Retain `v1_0` as an audit-trail record of the original (do not delete).
2. Add a one-line entry at the top of the v1.1 file under the Status line: `**Patches applied:** v1.0 → v1.1 via HRC_albedo_modifier_handoff_v1_0_to_v1_1_patch.md (May 2026, formula corrected from additive to multiplicative after Phase 0 smoke test).`
3. Re-run the synthetic smoke test against the patched v1.1 formula to confirm intact pixels are exactly unchanged and Phase 0 hard gates pass under the revised acceptance criteria. This is the gate before any Earth Engine compute.
4. Proceed to Phase 0 implementation as specified in the patched v1.1 handoff.

---

## What this patch does NOT change

- The trust-the-data check in Section 4 — unchanged.
- The cryosphere deferral in Section 5 — unchanged.
- The Phase 1 file list in Section 7.2 — unchanged (the schema migration accommodates either formula; the script bodies will use the multiplicative form).
- The risks and blind spots in Section 8 — unchanged. The "trust gate may be too strict" and "MODIS Terra to VIIRS sensor drift" warnings still stand.
- The non-goals in Section 9 — unchanged.
- Section 10 communication protocol — unchanged.

---

This patch document is sufficient for application. If a question arises during application that this patch does not answer, escalate to the project owner before assuming a default. The next planned revision after v1.1 is the Phase 0 findings document (`HRC_albedo_modifier_phase0_findings_v1.md`), produced after the diagnostic runs.
