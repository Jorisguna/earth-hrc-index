-- ============================================================
-- compute_historical_change_v2_1.sql
-- Derive historical_change and restoration_gap_historical from
-- hrc_historical_reference and hrc_score.
--
-- Run AFTER:
--   1. scripts/migrations/004_v2_1_historical.sql
--   2. The three regional historical update SQL files
--      (wales_historical_update_v2_1.sql, etc.)
--
-- Sign conventions (per methodology §2.4):
--   historical_change          = hrc_score - hrc_historical_reference
--     → positive = recovery (gained cooling since baseline)
--     → negative = degradation (lost cooling since baseline)
--   restoration_gap_historical = GREATEST(hrc_historical_reference - hrc_score, 0)
--     → unsigned magnitude of degradation only
--     → recoveries clip to 0 (operational restoration-targeting use)
--
-- These two quantities use DIFFERENT sign conventions ON PURPOSE.
-- ============================================================

UPDATE hrc_tiles
SET historical_change          = hrc_score - hrc_historical_reference,
    restoration_gap_historical = GREATEST(hrc_historical_reference - hrc_score, 0)
WHERE hrc_historical_reference IS NOT NULL
  AND hrc_score IS NOT NULL;

-- ── Verification: coverage and direction-of-change distribution ─────
SELECT
  CASE
    WHEN longitude BETWEEN -5.35 AND -2.65 AND latitude BETWEEN 51.35 AND 53.45 THEN 'Wales'
    WHEN longitude BETWEEN -119.0 AND -117.4 AND latitude BETWEEN 33.6 AND 34.4 THEN 'LA'
    WHEN longitude BETWEEN -123.0 AND -121.2 AND latitude BETWEEN 37.0 AND 38.6 THEN 'SF Bay'
  END AS region,
  COUNT(*)                                                  AS n_tiles,
  COUNT(hrc_historical_reference)                           AS n_with_baseline,
  ROUND(AVG(hrc_historical_reference)::numeric, 2)          AS mean_baseline,
  ROUND(AVG(hrc_score)::numeric, 2)                         AS mean_current,
  ROUND(AVG(historical_change)::numeric, 2)                 AS mean_change,
  ROUND(AVG(restoration_gap_historical)::numeric, 2)        AS mean_gap,
  COUNT(*) FILTER (WHERE historical_change > 0)             AS n_improved,
  COUNT(*) FILTER (WHERE historical_change < 0)             AS n_degraded,
  COUNT(*) FILTER (WHERE historical_change = 0)             AS n_stable
FROM hrc_tiles
WHERE methodology_version = 'v2.0'
GROUP BY region
ORDER BY region;

-- ── Verification: sign-convention crosscheck (sanity check 4) ───────
-- All 20 rows should show audit = 'OK'.
-- Any other value blocks deploy — investigate immediately.
SELECT
  longitude, latitude,
  hrc_score, hrc_historical_reference,
  historical_change,
  hrc_score - hrc_historical_reference                              AS computed_change,
  restoration_gap_historical,
  GREATEST(hrc_historical_reference - hrc_score, 0)                 AS computed_gap,
  CASE
    WHEN ABS(historical_change - (hrc_score - hrc_historical_reference)) > 0.001
      THEN 'CHANGE SIGN MISMATCH'
    WHEN ABS(restoration_gap_historical - GREATEST(hrc_historical_reference - hrc_score, 0)) > 0.001
      THEN 'GAP MISMATCH'
    ELSE 'OK'
  END AS audit
FROM hrc_tiles
WHERE hrc_historical_reference IS NOT NULL
ORDER BY RANDOM()
LIMIT 20;
