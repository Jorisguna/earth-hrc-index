-- ============================================================
-- 004_v2_1_historical.sql
-- v2.1 historical baseline columns
--
-- Adds:
--   - historical_change          DOUBLE PRECISION  (signed: positive = recovery)
--   - historical_confidence      TEXT              ('medium' | 'medium-low' | ...)
--   - historical_method_version  TEXT              (default 'v2.1')
--   - historical_window          TEXT              (default '2001-01-01/2011-01-01')
--
-- Confirms (already present from v2.0 prototype):
--   - hrc_historical_reference   DOUBLE PRECISION
--   - restoration_gap_historical DOUBLE PRECISION
--
-- Pre-flight diagnostic confirmed (May 2026):
--   hrc_historical_reference and restoration_gap_historical exist as
--   double precision. New columns are added with double precision to
--   keep the schema consistent. Methodology doc §3.1.1 generically
--   specifies NUMERIC, but DOUBLE PRECISION is functionally adequate
--   for HRC's 0–10 value range and matches the existing v2.0 schema.
-- ============================================================

ALTER TABLE hrc_tiles
  ADD COLUMN IF NOT EXISTS hrc_historical_reference   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS historical_change          DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS restoration_gap_historical DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS historical_confidence      TEXT,
  ADD COLUMN IF NOT EXISTS historical_method_version  TEXT DEFAULT 'v2.1',
  ADD COLUMN IF NOT EXISTS historical_window          TEXT DEFAULT '2001-01-01/2011-01-01';

-- Drop any v2.0 prototype data so it does not contaminate v2.1 verification.
-- Idempotent given current production state (all historical fields already NULL).
UPDATE hrc_tiles
SET hrc_historical_reference   = NULL,
    historical_change          = NULL,
    restoration_gap_historical = NULL,
    historical_confidence      = NULL
WHERE historical_method_version IS NULL OR historical_method_version != 'v2.1';
