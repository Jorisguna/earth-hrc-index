-- =====================================================================
-- 008_albedo_modifier_v2_2.sql
-- Heat Regulation Capacity Index — Albedo Modifier (v2.2)
-- Version: v1.0
-- Date:    May 2026
--
-- Purpose: Add columns to hrc_tiles for the v2.2 albedo modifier and the
--          v2.2 restoration-gap reference. v2.2 promotes the existing
--          Tier B `Albedo_deficit` term into Tier A as an ecoregion-
--          relative ecosystem-health modifier, gated by a per-ecoregion
--          trust-the-data check.
--
-- Formula (v2.2, multiplicative form, project owner decision 2026-05-18:
--          w = 0.20 for production):
--   hrc_score_v2_2 = 10 × clip(λE/Rn, 0, 1) × (1 − w × albedo_deficit_norm)
--
-- Disable rule: if the ecoregion fails the Section 4 trust gate of
--   HRC_albedo_modifier_claude_code_handoff_v1_2.md, the multiplier is
--   set to 1 and hrc_score_v2_2 = 10 × EF (identical to v2.1.1).
--
-- Apply against: Supabase. Additive columns only; existing v2.0 / v2.1.x
--                tiles remain untouched (new columns are NULL for them).
-- Reversibility: safe — drop the added columns to roll back. The view
--                recreation at the end re-expands from the base table,
--                so dropping columns also requires re-running this view
--                refresh after.
--
-- Handoff:    docs/HRC_albedo_modifier_claude_code_handoff_v1_2.md §7.2.
-- Phase 0:    docs/HRC_albedo_modifier_phase0_findings_v1.md (signed off).
-- =====================================================================

-- ── Add v2.2 albedo modifier columns ──────────────────────────────────
ALTER TABLE hrc_tiles
  ADD COLUMN IF NOT EXISTS pixel_albedo                    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS albedo_ref_p50                  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS albedo_deficit_norm             DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS albedo_modifier_status          TEXT,
  ADD COLUMN IF NOT EXISTS albedo_modifier_disabled_reason TEXT,
  ADD COLUMN IF NOT EXISTS hrc_score_v2_2                  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS albedo_data_source              TEXT,
  ADD COLUMN IF NOT EXISTS reference_p90_v2_2              DOUBLE PRECISION;

-- ── Column comments ───────────────────────────────────────────────────
COMMENT ON COLUMN hrc_tiles.pixel_albedo IS
  'MCD43A3 black-sky shortwave albedo (band Albedo_BSA_shortwave, scale 0.001) '
  'at the tile centroid for the v2.2 source window. Diagnostic / provenance.';

COMMENT ON COLUMN hrc_tiles.albedo_ref_p50 IS
  'Ecoregion intact-reference albedo, the 50th percentile of MCD43A3 albedo '
  'sampled at WDPA centroids that survived the trust-the-data filter '
  '(see HRC_albedo_modifier_claude_code_handoff_v1_2.md §3). '
  'Joined from the per-ecoregion reference table by ecoregion id. '
  'NULL when the ecoregion is disabled (insufficient samples / noisy / '
  'low PA coverage / cryosphere biome).';

COMMENT ON COLUMN hrc_tiles.albedo_deficit_norm IS
  'clip((pixel_albedo − albedo_ref_p50) / albedo_ref_p50, 0, 1). '
  'Zero when the tile is at or darker than the ecoregion reference (no penalty). '
  'One at the full penalty cap. Asymmetric: only positive deficits are '
  'penalised in v2.2 (cryosphere two-sided handling deferred to Phase 2). '
  'NULL when the modifier is disabled for the ecoregion.';

COMMENT ON COLUMN hrc_tiles.albedo_modifier_status IS
  'Per-tile state of the v2.2 albedo modifier. Valid values: '
  '''enabled'' — the ecoregion passed all Section 4 trust gates; the multiplier (1 − w × albedo_deficit_norm) is applied. '
  '''disabled'' — the ecoregion failed at least one trust gate; hrc_score_v2_2 = 10 × EF (identical to v2.1.1).';

COMMENT ON COLUMN hrc_tiles.albedo_modifier_disabled_reason IS
  'Reason the v2.2 modifier is disabled for this tile. NULL when albedo_modifier_status = ''enabled''. Otherwise one of: '
  '''insufficient_samples'' — fewer than 20 valid centroids after the per-centroid filter; '
  '''noisy_reference'' — interquartile range of surviving centroid albedos exceeds 0.10; '
  '''low_pa_coverage'' — protected-area coverage below 5% of ecoregion total land area; '
  '''cryosphere_biome_phase2_deferred'' — biome is tundra or high-latitude polar (two-sided handling deferred). '
  'No silent disables — every disabled tile MUST have a non-null reason.';

COMMENT ON COLUMN hrc_tiles.hrc_score_v2_2 IS
  'v2.2 Heat Regulation Capacity score with the albedo modifier. '
  'Formula: 10 × clip(λE/Rn, 0, 1) × (1 − w × albedo_deficit_norm), '
  'with w = 0.20 in production (project owner decision 2026-05-18). '
  'When albedo_modifier_status = ''disabled'', falls back to 10 × EF '
  '(identical to v2.1.1 hrc_score). Populated only for tiles produced '
  'by the v2.2 pipeline; NULL for older methodology versions.';

COMMENT ON COLUMN hrc_tiles.albedo_data_source IS
  'Sensor / collection source for pixel_albedo and albedo_ref_p50. '
  'Currently ''MCD43A3_061'' (MODIS Terra+Aqua Bidirectional Reflectance '
  'Distribution Function-Adjusted broadband albedo, collection 6.1). '
  'Provenance column for sensor-transition detection — MODIS Terra is past '
  'design life and the VIIRS-derived replacement uses a different BRDF '
  'correction; a step change at the transition would be sensor-artefact, '
  'not real land change, and requires this column to detect.';

COMMENT ON COLUMN hrc_tiles.reference_p90_v2_2 IS
  'Ecoregion p90 of the v2.2 score, recomputed from per-centroid v2.2 '
  'scores rather than v2.1.1 scores (handoff v1.2 §7.5). The v2.2 '
  'restoration gap is reference_p90_v2_2 − hrc_score_v2_2; using the '
  'v2.1.1 hrc_reference column instead would systematically over-state '
  'the gap by approximately 0.25–0.35 for vegetated ecoregions. '
  'NULL for tiles where the ecoregion albedo modifier is disabled '
  '(no v2.2 reference can be computed without an enabled modifier).';

-- ── Refresh hrc_tiles_default to expose the new columns ───────────────
-- Same pattern as migration 007: SELECT t.* freezes column list at view
-- creation; we must drop and recreate to pick up the eight new columns.
DROP VIEW IF EXISTS hrc_tiles_default;

CREATE VIEW hrc_tiles_default AS
WITH per_region AS (
  SELECT
    region_code,
    MIN(data_resolution_m) AS best_resolution
  FROM hrc_tiles
  WHERE region_code IS NOT NULL
    AND data_resolution_m IS NOT NULL
  GROUP BY region_code
)
SELECT t.*
FROM hrc_tiles t
INNER JOIN per_region p
  ON t.region_code = p.region_code
  AND t.data_resolution_m = p.best_resolution;

-- =====================================================================
-- Verification queries (run after migration)
-- =====================================================================

-- 1. Confirm all eight new columns exist on hrc_tiles:
--    Expected: 8 rows.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'hrc_tiles'
  AND column_name IN (
    'pixel_albedo', 'albedo_ref_p50', 'albedo_deficit_norm',
    'albedo_modifier_status', 'albedo_modifier_disabled_reason',
    'hrc_score_v2_2', 'albedo_data_source', 'reference_p90_v2_2'
  )
ORDER BY column_name;

-- 2. Confirm the columns are exposed by hrc_tiles_default after view refresh:
--    Expected: 8 rows.
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'hrc_tiles_default'
  AND column_name IN (
    'pixel_albedo', 'albedo_ref_p50', 'albedo_deficit_norm',
    'albedo_modifier_status', 'albedo_modifier_disabled_reason',
    'hrc_score_v2_2', 'albedo_data_source', 'reference_p90_v2_2'
  )
ORDER BY column_name;

-- 3. Pre-existing tiles untouched — all new columns NULL:
--    Expected: total_rows == null_in_each_new_column.
SELECT COUNT(*)                                                  AS total_rows,
       COUNT(*) FILTER (WHERE hrc_score_v2_2 IS NULL)            AS null_hrc_v2_2,
       COUNT(*) FILTER (WHERE albedo_modifier_status IS NULL)    AS null_status,
       COUNT(*) FILTER (WHERE reference_p90_v2_2 IS NULL)        AS null_ref_p90_v2_2
FROM hrc_tiles;

-- 4. Existing methodology_version values unchanged:
--    Expected: v1.0 / v1.1 / v2.0 / v2.1 / v2.1.1 / v2.1.2_higher_fidelity rows
--    only — no v2.2 rows yet.
SELECT methodology_version, COUNT(*) AS n_tiles
FROM hrc_tiles
GROUP BY methodology_version
ORDER BY methodology_version;

-- 5. (Run AFTER the v2.2 import) Disabled tiles always have a reason:
--    Expected: 0 rows.
SELECT COUNT(*) AS silent_disables
FROM hrc_tiles
WHERE methodology_version = 'v2.2_higher_fidelity'
  AND albedo_modifier_status = 'disabled'
  AND albedo_modifier_disabled_reason IS NULL;

-- 6. (Run AFTER the v2.2 import) Enabled tiles always have a non-null reference:
--    Expected: 0 rows.
SELECT COUNT(*) AS enabled_without_reference
FROM hrc_tiles
WHERE methodology_version = 'v2.2_higher_fidelity'
  AND albedo_modifier_status = 'enabled'
  AND (albedo_ref_p50 IS NULL OR reference_p90_v2_2 IS NULL);

-- 7. (Run AFTER the v2.2 import) v2.2 score is within bounds [0, 10]:
--    Expected: 0 rows out of range.
SELECT COUNT(*) AS out_of_range_v2_2_scores
FROM hrc_tiles
WHERE methodology_version = 'v2.2_higher_fidelity'
  AND (hrc_score_v2_2 < 0 OR hrc_score_v2_2 > 10);
