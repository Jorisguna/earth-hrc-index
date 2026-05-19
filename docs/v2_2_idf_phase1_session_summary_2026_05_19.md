# v2.2 Île-de-France — Phase 1 session summary

**Dates:** 2026-05-18 → 2026-05-19
**Status:** Live on local dev server; not yet deployed to Vercel.
**Predecessor handoff:** [HRC_albedo_modifier_claude_code_handoff_v1_2.md](./HRC_albedo_modifier_claude_code_handoff_v1_2.md)
**What this is:** A pick-up-cold summary of everything that happened, what's working, what's left.

---

## TL;DR

The v2.2 albedo modifier is fully built, imported, and visible in the front-end for Île-de-France. The Tapajós region is on hold pending Path B design (already drafted as a design note). The deployed Vercel site is still running the **old** bundle — when you return, the first thing to decide is whether to deploy.

Two non-trivial methodology findings emerged during the rollout:
1. The trust-the-data filter as specified in the handoff missed a class of contaminated centroids — protected-area polygon centroids that fall in cropland-dominated landscapes. Added a 1 km cropland-buffer check to fix this.
2. The original v2.1.x reference of **6.47** for European Atlantic mixed forests was inflated by water-edge centroids (forest pixels mixing with adjacent ponds / drainage at 500 m). The corrected reference is **5.615** and is now the value stored in the DB.

---

## Decisions made (with the reasoning)

| Decision | Value | Why |
|---|---|---|
| Production weight `W` | **0.20** | User pick from the {0.10, 0.15, 0.20} sweep. Smoke test passes all gates at this weight. |
| Region scope | **IDF only** | Tapajós Path A fails the trust gate; Path B design exists but not built yet. |
| Reference for `European Atlantic mixed forests` | **5.615** | The original 6.47 anchor was inflated by water-edge centroids. The cropland-buffer filter incidentally removes those (water is usually adjacent to farmland in IDF), and the resulting 5.615 was visually validated against satellite imagery. |
| Both `hrc_reference` and `reference_p90_v2_2` set to | **5.615** | At intact conditions (deficit=0), v2.2 = v2.1.x, so the same aspirational reference applies under both methodologies. |
| Cropland-buffer threshold | **>25% of 1 km buffer** | Reject WDPA centroids whose 1 km neighbourhood is dominated by MCD12Q1 cropland classes (12, 13, 14). Patched into scripts 33, 38, and 31_..._v2_2. |

---

## What's deployed where

| Layer | State | Notes |
|---|---|---|
| Supabase schema (migration 008) | **applied** | Eight new columns on `hrc_tiles`; `hrc_tiles_default` view refreshed. |
| v2.2 IDF tile data | **imported** | 15994 rows, methodology_version = `v2.2_higher_fidelity`. 15752 enabled, 242 disabled (`insufficient_samples` for the Western European broadleaf forests sliver). |
| `hrc_reference` / `reference_p90_v2_2` back-fill | **applied** | Both columns = 5.615 on all 15752 enabled tiles. |
| Front-end code (toggle, BioregionCard rows, centroid overlay, tooltips, HRC labels) | **built locally** | Vite build passes. Not yet deployed. |
| Vercel deployment | **stale** | Still serving the pre-v2.2 bundle. Tiles render via legacy code paths. |

---

## Files created or changed this session

| File | What |
|---|---|
| `scripts/migrations/008_albedo_modifier_v2_2.sql` | Schema migration (eight new columns + view refresh). |
| `scripts/38_albedo_reference_idf_v2_2.js` | Per-ecoregion v2.2 reference. Includes cropland-buffer patch. |
| `scripts/31_hrc_v2_1_idf_tiles_v2_2.js` | IDF tile pipeline (Part A = v2.1.x carry-forward, Part B = inline reference, Part C = per-tile join). Cropland-buffer patch applied. |
| `scripts/33_hrc_v2_1_idf_reference.js` | v2.1.x intact reference. Cropland-buffer patch applied during the 5.615 investigation. |
| `scripts/import_hrc_v2_2_tiles.py` | Tile importer. Now uses 250-row batches + 3 retries to survive Supabase HTTP/2 stream blips. |
| `scripts/convert_centroid_audit_to_json.py` | Audit CSV → `public/idf_reference_centroids.json` for the front-end overlay. |
| `scripts/delete_idf_for_v2_2_import.sql` | Pre-import IDF cleanup (DELETE + verification, wrapped in transaction). |
| `scripts/albedo_modifier_phase0_smoke_test.py` | Smoke test default weight bumped to 0.20. |
| `src/App.jsx` | Methodology toggle, centroid overlay layer (ScatterplotLayer + TextLayer), tooltip, MapDisplayControls additions. |
| `src/components/BioregionCard.jsx` | Methodology-aware score and gap rows; "Albedo modifier active / inactive" row. |
| `src/lib/methodologyMode.js` | `getActiveScore` / `getActiveGap` / `getActiveReference` / modifier-status helpers. Reads `hrc_reference` directly for v2.1.x mode (not score+gap reconstruction). |
| `src/lib/explainers.js` | Added `methodologyVersion` and `albedoModifier` entries. |
| `docs/HRC_higher_fidelity_methodology_v2_2.md` | New methodology paper (delta to v2.1.2). |
| `docs/HRC_albedo_modifier_tapajos_path_b_design_v1.md` | Tapajós Path B design (parallel work stream). |
| `public/idf_reference_centroids.json` | 67 centroids, 33 kept, 34 rejected (with cropland-buffer patch applied). |
| Project memory | Two new files: `feedback_sample_provenance_visibility.md` and `feedback_water_edge_centroid_contamination.md`. |

---

## Front-end UX added

- **Methodology toggle** in the headline bar (only appears when at least one loaded tile has v2.2 data). Default = v2.2; switch to v2.1.1 to see the legacy score.
- **Albedo modifier row** in the BioregionCard with plain-language status (`active` or `inactive — insufficient reference data` with specific reason).
- **Show reference sites** toggle in the map display controls. Renders the WDPA centroids as a ScatterplotLayer overlay:
  - Green dots: kept centroids (feed the reference).
  - Amber: rejected by 1 km cropland buffer.
  - Orange: rejected because MCD12Q1 land cover at the centroid is cropland / urban / water.
  - Blue: rejected because the 500 m wetland buffer is >25%.
  - Grey: rejected because no albedo or no EF value.
- **HRC label** beside each dot (white-on-dark text overlay with the centroid's v2.1.1 HRC score).
- **Hover tooltip** on the dots: PA name, IUCN cat, ecoregion, kept/rejected status, HRC v2.1.1, albedo, EF, LC class, both buffer fractions.
- **Focused-ecoregion highlight**: when a tile is selected, centroids feeding that tile's ecoregion enlarge and brighten.

---

## Key numbers to remember

| Quantity | Value |
|---|---|
| Tiles imported (IDF) | 15994 |
| Modifier-enabled tiles | 15752 |
| Modifier-disabled tiles (`insufficient_samples`) | 242 |
| FR-Fon tower v2.2 score | 5.65 (vs v2.1.1 = 5.70, |Δ| = 0.057) |
| Regional mean v2.1.1 | 5.917 |
| Regional mean v2.2 | 5.667 |
| `albedo_ref_p50` (European Atlantic mixed forests) | ≈ 0.134 |
| Final reference for both `hrc_reference` and `reference_p90_v2_2` | **5.615** |
| Total WDPA polygons in IDF bbox (IUCN I-IV, Designated) | 66 |
| Surviving IUCN I-IV centroids after trust filter | 37 |
| Surviving IUCN I-VI centroids after trust filter | 33 |

---

## Open items / next session

**Immediate:**
1. **Deploy.** The new UI (methodology toggle, centroid overlay, BioregionCard rows) is only on local dev. Vercel needs to be deployed to get it live.
2. **Update the methodology paper.** [HRC_higher_fidelity_methodology_v2_2.md](./HRC_higher_fidelity_methodology_v2_2.md) still references the 6.47 anchor and doesn't mention the cropland-buffer patch or the water-edge centroid finding. Section 7.13.7 needs the corrected Phase 0 numbers.

**Pending work streams:**
3. **Tapajós Path B implementation.** [Design note](./HRC_albedo_modifier_tapajos_path_b_design_v1.md) exists. Estimate ~2.5 days. When built, Tapajós tiles get v2.2 deployment.
4. **Water-edge centroid filter (v2.2.2 patch).** Currently the cropland-buffer filter catches water-edge centroids as a side effect, because water bodies in IDF sit in farmland. This won't generalise to Tapajós (water surrounded by rainforest). A dedicated tighter water-fraction check is warranted before the Tapajós deployment. Documented in project memory: `feedback_water_edge_centroid_contamination.md`.

**Lower priority:**
5. The 242 disabled tiles in Western European broadleaf forests have null `hrc_reference` and `reference_p90_v2_2`. Their v2.2 score equals v2.1.x score (modifier disabled by construction). The v2.1.1 toggle shows "—" for their restoration gap because we have no v2.1.x reference for that ecoregion. Could be back-filled if the user wants those tiles to display a gap in v2.1.1 mode.
6. Pre-existing lint errors in `App.jsx` (`onInfo` unused in `GapModeToggle`, `set-state-in-effect` in the initial-load `useEffect`) — predate this session; not introduced by v2.2 work but worth fixing.

---

## What to do first when you return

1. Open the local dev server (`npm run dev`), fly to Île-de-France, and confirm the v2.2 toggle + centroid overlay still work after a fresh load.
2. Decide whether to deploy to Vercel. The current data in production is read by the legacy bundle, which displays `hrc_score` (v2.1.x). Deploying flips the headline to v2.2 by default for IDF tiles only — no data changes, just UI.
3. If anything looks off, the most recent verified-good state is: 15994 v2.2 IDF tiles, both reference columns = 5.615 across 15752 enabled rows. The two backfill SQL UPDATEs from this session reproduce that state.

---

## Why 5.615 and not 6.47

The handoff §11 listed the European Atlantic mixed forests reference as 6.47, derived from script 33 with WDPA IUCN I-IV centroids (n=39). During the v2.2 rollout we added a 1 km cropland-buffer filter (originally intended to remove cropland-mosaic PNR centroids from the v2.2 albedo reference). When the same filter was applied to script 33 it dropped the p90 from 6.47 to 5.615.

Initial hypothesis: the filter was incorrectly removing small forest-enclave centroids that legitimately scored high. Visual inspection of the rejected dots in the satellite-imagery overlay refuted this — the high-scoring rejected centroids were sitting near visible water bodies, not in small forest enclaves. Their 500 m MODIS pixel mixed forest with adjacent ponds / streams, and the water (EF ≈ 1) drove the HRC reading up to 7+.

So 6.47 was inflated by a handful of water-contaminated mixed pixels, and 5.615 is the more honest reference. The user confirmed by visual inspection that 5.615 better represents typical intact French forest.

The cropland-buffer filter, intended for cropland mosaics, accidentally removed water-edge centroids too. This worked in IDF because water in IDF is usually adjacent to farmland. The pattern won't hold for Tapajós (water is inside rainforest), which is why a dedicated water-fraction filter is on the v2.2.2 list.

---

## Reference values that you might need

For the SQL backfills (already applied; included here in case you need to re-run after a re-import):

```sql
-- v2.1.x reference + restoration_gap
UPDATE hrc_tiles
SET hrc_reference        = 5.615,
    restoration_gap      = GREATEST(5.615 - hrc_score, 0),
    reference_filter     = 'IUCN_I-IV',
    reference_method     = 'centroid_p90_IUCN_I-IV_cropland_buffer',
    reference_confidence = 'moderate'
WHERE methodology_version = 'v2.2_higher_fidelity'
  AND ecoregion_name = 'European Atlantic mixed forests';

-- Mirror onto v2.2 reference column
UPDATE hrc_tiles
SET reference_p90_v2_2 = hrc_reference
WHERE methodology_version = 'v2.2_higher_fidelity'
  AND albedo_modifier_status = 'enabled'
  AND hrc_reference IS NOT NULL;
```

---

That's the state when this summary was written. Everything from here is decisions you'll be making on your terms.
