-- ============================================================
-- HRC Index — update trend_score_60m from: HRC_Barbados_Trend_60months.csv
-- 60-month deseasonalised trend (June 2018 – May 2023)
-- Original trend_score (24-month) is preserved unchanged
-- Tiles matched by coordinates rounded to 4 decimal places
-- Paste this entire block into Supabase SQL Editor and click Run
-- ============================================================

BEGIN;

UPDATE hrc_tiles SET trend_score_60m = 0.1556144462 WHERE ROUND(longitude::numeric, 4) = -59.5503 AND ROUND(latitude::numeric, 4) = 13.0501;
UPDATE hrc_tiles SET trend_score_60m = 0.1498646512 WHERE ROUND(longitude::numeric, 4) = -59.4503 AND ROUND(latitude::numeric, 4) = 13.0501;
UPDATE hrc_tiles SET trend_score_60m = 0.2068168387 WHERE ROUND(longitude::numeric, 4) = -59.5503 AND ROUND(latitude::numeric, 4) = 13.1501;
UPDATE hrc_tiles SET trend_score_60m = 0.131052868 WHERE ROUND(longitude::numeric, 4) = -59.4503 AND ROUND(latitude::numeric, 4) = 13.1501;

COMMIT;

-- 4 UPDATE statements generated
-- After running, verify with:
-- SELECT COUNT(*), AVG(trend_score), AVG(trend_score_60m)
-- FROM hrc_tiles;