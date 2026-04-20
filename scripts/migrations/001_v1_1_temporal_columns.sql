-- 001_v1_1_temporal_columns.sql
-- Adds methodology tracking columns for HRC v1.1.
-- Safe to run multiple times (IF NOT EXISTS throughout).

ALTER TABLE hrc_tiles ADD COLUMN IF NOT EXISTS hrc_window_start    date;
ALTER TABLE hrc_tiles ADD COLUMN IF NOT EXISTS hrc_window_end      date;
ALTER TABLE hrc_tiles ADD COLUMN IF NOT EXISTS methodology_version text DEFAULT 'v1.0';
ALTER TABLE hrc_tiles ADD COLUMN IF NOT EXISTS batch_id            text;

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'hrc_tiles'
  AND column_name IN ('hrc_window_start','hrc_window_end','methodology_version','batch_id')
ORDER BY column_name;
