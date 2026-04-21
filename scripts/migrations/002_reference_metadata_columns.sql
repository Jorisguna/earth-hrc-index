-- 002_reference_metadata_columns.sql
-- Adds reference metadata columns per handoff guidance.
-- Safe to run multiple times (IF NOT EXISTS throughout).

ALTER TABLE hrc_tiles ADD COLUMN IF NOT EXISTS reference_filter     text;
ALTER TABLE hrc_tiles ADD COLUMN IF NOT EXISTS reference_confidence text;
ALTER TABLE hrc_tiles ADD COLUMN IF NOT EXISTS computation_window   text;

-- Back-fill computation_window for existing v1.1 tiles
UPDATE hrc_tiles
SET computation_window = '2025-04-01/2026-03-31'
WHERE methodology_version = 'v1.1';

-- Back-fill reference_filter for tiles where hrc_reference is set
-- Wales + SF Bay used IUCN I–IV; LA used IUCN I–VI
UPDATE hrc_tiles
SET reference_filter = 'IUCN_I-IV'
WHERE hrc_reference IS NOT NULL
  AND ecoregion_name IN (
    'Celtic broadleaf forests',
    'English Lowlands beech forests',
    'Northern California coastal forests',
    'California Central Valley grasslands',
    'California interior chaparral and woodlands'
  );

UPDATE hrc_tiles
SET reference_filter = 'IUCN_I-VI'
WHERE hrc_reference IS NOT NULL
  AND ecoregion_name IN (
    'California coastal sage and chaparral',
    'California montane chaparral and woodlands'
  );

-- Back-fill reference_confidence based on pa_pixel_count thresholds
-- (values from intact reference CSVs)
-- Celtic broadleaf: 266 px → high
UPDATE hrc_tiles SET reference_confidence = 'high'
WHERE ecoregion_name = 'Celtic broadleaf forests';

-- All others: < 20 px → low
UPDATE hrc_tiles SET reference_confidence = 'low'
WHERE hrc_reference IS NOT NULL
  AND ecoregion_name != 'Celtic broadleaf forests';

-- Verify
SELECT
  ecoregion_name,
  reference_filter,
  reference_confidence,
  computation_window,
  COUNT(*) AS tiles
FROM hrc_tiles
WHERE methodology_version = 'v1.1'
GROUP BY ecoregion_name, reference_filter, reference_confidence, computation_window
ORDER BY ecoregion_name;
