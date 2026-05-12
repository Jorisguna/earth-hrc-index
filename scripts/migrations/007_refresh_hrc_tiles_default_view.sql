-- =====================================================================
-- 007_refresh_hrc_tiles_default_view.sql
-- Heat Regulation Capacity Index — refresh hrc_tiles_default view
-- Version: v1.0
-- Date:    May 2026
--
-- Purpose: Drop and recreate hrc_tiles_default so that its column list
--          picks up latent_heat_flux_annual_wm2 (added by migration 006
--          to the base hrc_tiles table).
--
-- Background: hrc_tiles_default was originally created in migration
--             005 with `SELECT t.*`. PostgreSQL expands `*` at view
--             creation time and freezes the column list, so columns
--             added to hrc_tiles after the view exists are NOT
--             automatically exposed by the view. The app queries
--             hrc_tiles_default at zoom >= 9, so without this refresh
--             the new latent_heat_flux_annual_wm2 column is invisible
--             to the UI even though it is populated in hrc_tiles.
--
-- Apply against: Supabase (single env per project setup).
-- Reversibility: safe — view definition is unchanged; column list is
--                re-expanded from the current base table.
-- =====================================================================

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
-- Verification queries
-- =====================================================================

-- 1. Confirm the column is now exposed by the view:
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'hrc_tiles_default'
  AND column_name = 'latent_heat_flux_annual_wm2';
-- Expected: one row.

-- 2. Confirm v2.1.2 tiles return non-null values through the view:
SELECT region_code,
       COUNT(*)                                                          AS total,
       COUNT(latent_heat_flux_annual_wm2)                                AS populated,
       ROUND(AVG(latent_heat_flux_annual_wm2)::numeric, 2)               AS mean_wm2
FROM hrc_tiles_default
WHERE methodology_version = 'v2.1.2_higher_fidelity'
GROUP BY region_code
ORDER BY region_code;
-- Expected: idf ~16000 rows mean 30-40, tapajos ~30000 rows mean 80-95.
