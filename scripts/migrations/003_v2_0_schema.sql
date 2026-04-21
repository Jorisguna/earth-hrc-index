-- 003_v2_0_schema.sql
-- HRC v2.0 schema additions.
-- Adds new columns for v2.0 methodology tracking and reference percentiles.
-- Safe to run multiple times (IF NOT EXISTS throughout).
--
-- v2.0 changes:
--   hrc_formula:        'ratio_of_annual_sums_v2.0' (was mean of monthly EFs)
--   computation_window: '2025-01-01/2026-01-01'    (was '2025-04-01/2026-03-31')
--   hrc_reference_p75:  25th percentile of PA reference distribution
--   hrc_reference_p95:  95th percentile of PA reference distribution
--   pa_centroid_count:  number of PA centroids used for reference (centroid method)
-- ─────────────────────────────────────────────────────────────────────────────

-- New methodology tracking column
ALTER TABLE hrc_tiles ADD COLUMN IF NOT EXISTS hrc_formula text;

-- Reference percentile range columns (complement existing hrc_reference = p90)
ALTER TABLE hrc_tiles ADD COLUMN IF NOT EXISTS hrc_reference_p75  numeric;
ALTER TABLE hrc_tiles ADD COLUMN IF NOT EXISTS hrc_reference_p95  numeric;

-- Replaces pa_pixel_count from v1.1 centroid approach
ALTER TABLE hrc_tiles ADD COLUMN IF NOT EXISTS pa_centroid_count  integer;

-- Already added in 002 but guard in case 002 wasn't run
ALTER TABLE hrc_tiles ADD COLUMN IF NOT EXISTS reference_filter     text;
ALTER TABLE hrc_tiles ADD COLUMN IF NOT EXISTS reference_confidence text;
ALTER TABLE hrc_tiles ADD COLUMN IF NOT EXISTS computation_window   text;

-- ── Verify columns exist ─────────────────────────────────────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'hrc_tiles'
  AND column_name IN (
    'hrc_formula',
    'hrc_reference_p75', 'hrc_reference_p95',
    'pa_centroid_count',
    'reference_filter', 'reference_confidence',
    'computation_window', 'methodology_version'
  )
ORDER BY column_name;
