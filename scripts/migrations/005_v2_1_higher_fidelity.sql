-- ============================================================
-- 005_v2_1_higher_fidelity.sql
-- v2.1 higher-fidelity showcase — schema additions
--
-- Adds:
--   - region_code        TEXT             — replaces lat/lon CASE expressions
--                                          for region identification (also
--                                          enables the hrc_tiles_default view)
--   - data_source        TEXT             — pipeline that produced the score
--                                          (e.g. 'ERA5_LAND_9km', 'PML_V2_500m')
--   - data_resolution_m  INT              — effective spatial resolution
--   - source_window      TEXT             — calendar window of the satellite
--                                          analysis (e.g. '2023-01-01/2024-01-01')
--   - lst_source         TEXT             — LST source for upwelling longwave
--                                          (e.g. 'mixed_Terra_Aqua', 'ECOSTRESS_70m')
--   - hrc_raw_ratio      DOUBLE PRECISION — unclipped λE/Rn before [0,10] clamp
--                                          values > 1.0 flag energy-balance
--                                          closure violations
--   - reference_method   TEXT             — which Path produced the intact
--                                          reference for this tile
--                                          ('centroid_p90_IUCN_I-IV',
--                                           'centroid_p90_IUCN_I-VI',
--                                           'image_mask_p90_Hansen',
--                                           'flux_tower_published')
--
-- Backfills existing v2.0 tiles with their identification fields. Tile rows
-- created by the v2.1 higher-fidelity pipeline must populate all fields
-- explicitly at INSERT time.
--
-- Creates hrc_tiles_default view — selects highest-resolution tier per region.
-- This is what the application should query, not the raw table.
--
-- IMPORTANT: Run the pre-flight diagnostic FIRST (see comments below).
-- ============================================================

-- ── Pre-flight diagnostic ──────────────────────────────────────
-- Run this BEFORE the migration to confirm none of the new columns
-- already exist with unexpected types. Comment kept here for the audit
-- trail; the actual diagnostic is documented in
-- docs/v2_1_higher_fidelity_open_items.md.
--
--   SELECT column_name, data_type, numeric_precision, numeric_scale
--   FROM information_schema.columns
--   WHERE table_name = 'hrc_tiles'
--     AND column_name IN (
--       'region_code', 'data_source', 'data_resolution_m',
--       'source_window', 'lst_source', 'hrc_raw_ratio',
--       'reference_method'
--     )
--   ORDER BY column_name;
--
-- Expected outcome: zero rows returned (none of the columns exist yet).

-- ── Add columns ────────────────────────────────────────────────
ALTER TABLE hrc_tiles
  ADD COLUMN IF NOT EXISTS region_code        TEXT,
  ADD COLUMN IF NOT EXISTS data_source        TEXT,
  ADD COLUMN IF NOT EXISTS data_resolution_m  INT,
  ADD COLUMN IF NOT EXISTS source_window      TEXT,
  ADD COLUMN IF NOT EXISTS lst_source         TEXT,
  ADD COLUMN IF NOT EXISTS hrc_raw_ratio      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS reference_method   TEXT;

-- ── Backfill region_code for existing v2.0 tiles ──────────────
-- Pre-existing 639 tiles distributed across three pilot regions.
-- Region boundaries match the bounding boxes used in the v2.0 GEE
-- tile-import scripts (25/26/27_hrc_tiles_*_v2_0.js).
UPDATE hrc_tiles
SET region_code = 'wales'
WHERE region_code IS NULL
  AND longitude BETWEEN -5.35  AND -2.65
  AND latitude  BETWEEN 51.35  AND 53.45;

UPDATE hrc_tiles
SET region_code = 'la'
WHERE region_code IS NULL
  AND longitude BETWEEN -119.0 AND -117.4
  AND latitude  BETWEEN 33.6   AND 34.4;

UPDATE hrc_tiles
SET region_code = 'sfbay'
WHERE region_code IS NULL
  AND longitude BETWEEN -123.0 AND -121.2
  AND latitude  BETWEEN 37.0   AND 38.6;

-- ── Backfill source identification for existing v2.0 tiles ────
-- All pre-existing tiles are ERA5-Land 9km from the v2.0 import
-- (Jan 2025 – Jan 2026 window).
UPDATE hrc_tiles
SET data_source       = 'ERA5_LAND_9km',
    data_resolution_m = 9000,
    source_window     = '2025-01-01/2026-01-01'
WHERE data_source IS NULL
  AND methodology_version = 'v2.0';

-- ── Backfill reference_method from existing reference_filter ──
-- Existing reference_filter values are 'IUCN_I-IV' (Wales) or
-- 'IUCN_I-VI' (LA, SF Bay), produced by the centroid-sampling
-- approach in the v2.0 reference scripts.
UPDATE hrc_tiles
SET reference_method = 'centroid_p90_' || reference_filter
WHERE reference_method IS NULL
  AND reference_filter IS NOT NULL;

-- ── Index region_code for the view's join performance ─────────
CREATE INDEX IF NOT EXISTS hrc_tiles_region_resolution
  ON hrc_tiles (region_code, data_resolution_m);

-- ── Create hrc_tiles_default view ─────────────────────────────
-- Selects highest-resolution tier per region. The application should
-- query this view rather than the raw hrc_tiles table — this prevents
-- mixed-resolution aggregations (e.g. mean HRC across both 9km and 500m
-- tiles in the same region, which would produce nonsense).
--
-- "Highest resolution" is taken as MIN(data_resolution_m). Tiers we
-- expect to coexist:
--   9000  — v2.0 ERA5-Land (default for Wales, LA, SF Bay)
--    500  — v2.1 PML_V2 (Île-de-France, Tapajós)
--     70  — future ECOSTRESS / Constellr (deferred, v2.2+)
CREATE OR REPLACE VIEW hrc_tiles_default AS
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

-- ── Verification queries ──────────────────────────────────────
-- After applying the migration, these queries confirm correctness.

-- 1. All existing tiles have region_code populated
--    Expected: 0 rows
SELECT COUNT(*) AS untagged_tiles
FROM hrc_tiles
WHERE region_code IS NULL;

-- 2. Per-region counts and source identification
--    Expected: Wales 320, LA 98, SF Bay 221, all 'ERA5_LAND_9km'/9000
SELECT region_code, data_source, data_resolution_m, COUNT(*) AS n_tiles
FROM hrc_tiles
GROUP BY region_code, data_source, data_resolution_m
ORDER BY region_code;

-- 3. reference_method backfilled correctly
--    Expected: Wales centroid_p90_IUCN_I-IV (320),
--              LA centroid_p90_IUCN_I-VI (~94),  -- 4 tiles in Mojave have null reference
--              SF Bay centroid_p90_IUCN_I-VI (221)
SELECT region_code, reference_method, COUNT(*) AS n_tiles
FROM hrc_tiles
GROUP BY region_code, reference_method
ORDER BY region_code, reference_method;

-- 4. View returns expected default-tier counts
--    Expected: same per-region counts as the underlying table (since
--              no v2.1 higher-fidelity tiles exist yet)
SELECT region_code, COUNT(*) AS n_tiles_in_default_view
FROM hrc_tiles_default
GROUP BY region_code
ORDER BY region_code;
