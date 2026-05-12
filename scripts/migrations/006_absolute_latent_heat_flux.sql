-- =====================================================================
-- 006_absolute_latent_heat_flux.sql
-- Heat Regulation Capacity Index — Absolute Latent Heat Flux Magnitude Diagnostic
-- Version: v1.0
-- Date:    May 2026
--
-- Purpose: Add the latent_heat_flux_annual_wm2 column to hrc_tiles.
--          This is a *magnitude diagnostic* companion to hrc_score
--          (which is a ratio / efficiency diagnostic).
--
-- Definition: Annual mean rate at which the tile moves energy upward
--             through evaporation of water, in watts per square metre.
--             Derived from the same Penman-Monteith-Leuning version 2
--             evapotranspiration product that feeds the Heat Regulation
--             Capacity numerator.
--
-- Conversion: latent_heat_flux_annual_wm2
--               = annual_evapotranspiration_mm_per_year × 0.0777
--             Equivalently:
--               = mean_evapotranspiration_mm_per_day × 28.36
--             Equivalently (and the form the Earth Engine scripts use):
--               = annual_latent_heat_J_per_m2_per_year ÷ 31,536,000
--
-- Apply against: Supabase dev branch first, then production.
-- Backfill:      Not required. Pre-v2.1.2 tiles remain NULL.
-- Reversibility: Additive column only; no data loss; safe to roll back
--                by DROP COLUMN if needed.
--
-- Note: renumbered to 006 to fit our local migration sequence
-- (001 v1_1 → 005 v2_1 higher-fidelity already applied).
-- =====================================================================

ALTER TABLE hrc_tiles
  ADD COLUMN IF NOT EXISTS latent_heat_flux_annual_wm2 NUMERIC;

COMMENT ON COLUMN hrc_tiles.latent_heat_flux_annual_wm2 IS
  'Annual mean latent heat flux in watts per square metre. '
  'Magnitude diagnostic companion to hrc_score. '
  'Computed as annual evapotranspiration in millimetres per year × 0.0777. '
  'Higher values = more total cooling work delivered. '
  'hrc_score measures efficiency (fraction of received energy used for cooling); '
  'this field measures magnitude (total cooling work delivered). '
  'Populated for v2.1.2 tiles and later; NULL for older tiles.';

-- =====================================================================
-- Verification queries (run after migration)
-- =====================================================================

-- 1. Confirm the column exists and has the comment attached:
SELECT column_name, data_type, col_description('hrc_tiles'::regclass, ordinal_position) AS comment
FROM information_schema.columns
WHERE table_name = 'hrc_tiles'
  AND column_name = 'latent_heat_flux_annual_wm2';

-- 2. Confirm pre-existing rows are all NULL (no accidental write):
SELECT COUNT(*) FILTER (WHERE latent_heat_flux_annual_wm2 IS NULL)     AS null_rows,
       COUNT(*) FILTER (WHERE latent_heat_flux_annual_wm2 IS NOT NULL) AS populated_rows,
       COUNT(*)                                                         AS total_rows
FROM hrc_tiles;

-- 3. After v2.1.2 import, confirm populated rows are within the expected range:
--    Île-de-France regional mean expected: 20 to 40 W/m².
--    Tapajós regional mean expected: 60 to 90 W/m².
SELECT region_code,
       ROUND(MIN(latent_heat_flux_annual_wm2)::numeric, 2)  AS min_wm2,
       ROUND(AVG(latent_heat_flux_annual_wm2)::numeric, 2)  AS mean_wm2,
       ROUND(MAX(latent_heat_flux_annual_wm2)::numeric, 2)  AS max_wm2,
       COUNT(*)                                              AS tile_count
FROM hrc_tiles
WHERE methodology_version = 'v2.1.2_higher_fidelity'
  AND latent_heat_flux_annual_wm2 IS NOT NULL
GROUP BY region_code
ORDER BY region_code;
