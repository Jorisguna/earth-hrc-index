-- schema_add_gap_columns.sql
-- Adds three new columns for the three-way gap reference system.
-- Run this BEFORE compute_historical_gap.sql.

ALTER TABLE hrc_tiles
  ADD COLUMN IF NOT EXISTS restoration_gap_historical double precision,
  ADD COLUMN IF NOT EXISTS hrc_ceiling_reference      double precision,
  ADD COLUMN IF NOT EXISTS restoration_gap_ceiling    double precision;
