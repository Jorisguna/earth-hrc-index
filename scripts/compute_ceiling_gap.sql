-- compute_ceiling_gap.sql
-- Derives restoration_gap_ceiling from hrc_ceiling_reference.
-- Run AFTER importing hrc_ceiling_reference for all three regions.

UPDATE hrc_tiles
SET restoration_gap_ceiling = GREATEST(hrc_ceiling_reference - hrc_score, 0)
WHERE hrc_ceiling_reference IS NOT NULL;

-- Verification
SELECT
  COUNT(*) FILTER (WHERE restoration_gap_ceiling IS NOT NULL) AS rows_updated,
  ROUND(AVG(restoration_gap_ceiling)::numeric, 3)             AS avg_ceiling_gap,
  ROUND(MIN(restoration_gap_ceiling)::numeric, 3)             AS min_gap,
  ROUND(MAX(restoration_gap_ceiling)::numeric, 3)             AS max_gap
FROM hrc_tiles
WHERE hrc_ceiling_reference IS NOT NULL;
