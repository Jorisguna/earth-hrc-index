-- ============================================================
-- update_historical_wales.sql
-- Earth HRC Index — load historical spring HRC for Wales
--
-- Run AFTER importing HRC_Historical_Wales.csv via insert_historical.py
-- (or after pasting the generated SQL from that script).
--
-- This script:
--   1. Matches historical tiles to current tiles by proximity (~5.5 km)
--   2. Sets hrc_historical_reference on each current tile
--   3. Computes restoration_gap_historical = hrc_historical - current hrc_score
--      (positive = historically healthier, i.e. degradation detected)
--      (negative = currently healthier than historical baseline)
-- ============================================================

-- Step 1 (optional): verify historical rows loaded correctly
SELECT COUNT(*), AVG(hrc_historical_reference), MIN(hrc_historical_reference), MAX(hrc_historical_reference)
FROM hrc_tiles
WHERE longitude BETWEEN -5.4 AND -2.6
  AND latitude  BETWEEN 51.3 AND 53.5
  AND hrc_historical_reference IS NOT NULL;

-- ── If you loaded historical tiles into a SEPARATE staging table ──────────
-- Skip to the direct-match approach below.

-- ── Direct approach: historical tiles loaded into same hrc_tiles table ────
-- The historical export will produce new rows with hrc_score = NULL and
-- a separate column, OR you load them into a staging table.
-- Use the approach that matches how insert_historical.py works.

-- ── Recommended: update Wales tiles using per-ecoregion 90th percentile ──
-- This mirrors how restoration_gap is computed for the intact-site reference.
-- Compute 90th percentile of hrc_historical_reference per ecoregion in Wales,
-- then set restoration_gap_historical = that reference - current hrc_score.

WITH ecoregion_hist_refs AS (
  SELECT
    ecoregion_name,
    PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY hrc_historical_reference) AS hist_ref
  FROM hrc_tiles
  WHERE longitude BETWEEN -5.4 AND -2.6
    AND latitude  BETWEEN 51.3 AND 53.5
    AND hrc_historical_reference IS NOT NULL
    AND ecoregion_name IS NOT NULL
  GROUP BY ecoregion_name
)
UPDATE hrc_tiles t
SET restoration_gap_historical = GREATEST(0, r.hist_ref - t.hrc_score)
FROM ecoregion_hist_refs r
WHERE t.ecoregion_name = r.ecoregion_name
  AND t.longitude BETWEEN -5.4 AND -2.6
  AND t.latitude  BETWEEN 51.3 AND 53.5;

-- ── Verify ────────────────────────────────────────────────────────────────
SELECT
  ecoregion_name,
  COUNT(*) AS n_tiles,
  ROUND(AVG(hrc_score)::numeric, 3)                    AS mean_current_hrc,
  ROUND(AVG(hrc_historical_reference)::numeric, 3)     AS mean_hist_hrc,
  ROUND(AVG(restoration_gap_historical)::numeric, 3)   AS mean_hist_gap
FROM hrc_tiles
WHERE longitude BETWEEN -5.4 AND -2.6
  AND latitude  BETWEEN 51.3 AND 53.5
  AND hrc_historical_reference IS NOT NULL
GROUP BY ecoregion_name
ORDER BY ecoregion_name;
