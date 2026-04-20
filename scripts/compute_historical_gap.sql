-- compute_historical_gap.sql
-- Derives restoration_gap_historical from hrc_historical_reference already in the DB.
-- restoration_gap_historical = how far this tile has fallen since its 2001-2010 baseline.
-- Floored at 0: tiles that have improved since baseline have no historical gap.
-- Run AFTER schema_add_gap_columns.sql.

UPDATE hrc_tiles
SET restoration_gap_historical = GREATEST(hrc_historical_reference - hrc_score, 0)
WHERE hrc_historical_reference IS NOT NULL;

-- Verification
SELECT
  COUNT(*) FILTER (WHERE restoration_gap_historical IS NOT NULL) AS rows_updated,
  ROUND(AVG(restoration_gap_historical)::numeric, 3)             AS avg_historical_gap,
  ROUND(MIN(restoration_gap_historical)::numeric, 3)             AS min_gap,
  ROUND(MAX(restoration_gap_historical)::numeric, 3)             AS max_gap
FROM hrc_tiles
WHERE hrc_historical_reference IS NOT NULL;
