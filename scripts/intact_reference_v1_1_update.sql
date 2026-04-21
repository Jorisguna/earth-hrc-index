-- intact_reference_v1_1_update.sql
-- Sets hrc_reference per ecoregion from WDPA IUCN I–IV p90 values.
-- Window: Apr 2025 – Mar 2026 (matches hrc_score v1.1)
-- Source CSVs: HRC_Intact_Wales/SFBay/LosAngeles_v1_1
--
-- All SF Bay and LA ecoregions are low_confidence (pa_pixel_count < 20).
-- Wales Celtic broadleaf forests is the only high-confidence benchmark (266 px).
-- Mojave desert has no IUCN I–IV PAs — hrc_reference left NULL.
--
-- Run AFTER hrc_score has been updated to v1.1.

BEGIN;

-- ── Wales ─────────────────────────────────────────────────────
UPDATE hrc_tiles
SET hrc_reference = 8.636956215
WHERE ecoregion_name = 'English Lowlands beech forests';

UPDATE hrc_tiles
SET hrc_reference = 8.798875292
WHERE ecoregion_name = 'Celtic broadleaf forests';

-- ── SF Bay ────────────────────────────────────────────────────
UPDATE hrc_tiles
SET hrc_reference = 6.149081707
WHERE ecoregion_name = 'Northern California coastal forests';

UPDATE hrc_tiles
SET hrc_reference = 5.95508194
WHERE ecoregion_name = 'California Central Valley grasslands';

UPDATE hrc_tiles
SET hrc_reference = 6.060059547
WHERE ecoregion_name = 'California interior chaparral and woodlands';

-- ── Los Angeles ───────────────────────────────────────────────
UPDATE hrc_tiles
SET hrc_reference = 4.605051041
WHERE ecoregion_name = 'California montane chaparral and woodlands';

UPDATE hrc_tiles
SET hrc_reference = 4.329545021
WHERE ecoregion_name = 'California coastal sage and chaparral';

-- Mojave desert: no IUCN I–IV PAs — leave hrc_reference NULL
-- (tiles will show no restoration_gap_reference)

-- ── Recompute restoration_gap ─────────────────────────────────
UPDATE hrc_tiles
SET restoration_gap = GREATEST(hrc_reference - hrc_score, 0)
WHERE hrc_reference IS NOT NULL;

COMMIT;

-- Verify
SELECT
  ecoregion_name,
  COUNT(*)                                    AS tiles,
  ROUND(AVG(hrc_reference)::numeric, 3)       AS hrc_reference,
  ROUND(AVG(hrc_score)::numeric, 3)           AS avg_hrc_score,
  ROUND(AVG(restoration_gap)::numeric, 3)     AS avg_gap,
  COUNT(*) FILTER (WHERE hrc_reference IS NULL) AS no_reference
FROM hrc_tiles
GROUP BY ecoregion_name
ORDER BY ecoregion_name;
