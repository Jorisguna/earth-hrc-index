-- =====================================================================
-- 009_openet_30m_tier.sql
-- Heat Regulation Capacity Index — OpenET 30 m demonstration tier
-- Version: v1.0
-- Date:    2026-08-06
--
-- Purpose: Add columns to hrc_tiles for the 30 m OpenET-driven demonstration
--          tier (US flux-tower test sites — Mead first). Closes gap G6 of
--          docs/HRC_30m_test_sites_usa_implementation_plan_v1_0.md §4 Phase 4.
--
-- Scope of the FIRST import this schema supports: US-Ne1 / US-Ne2 only
-- (irrigated Mead cropland). Per docs/HRC_30m_test_sites_usa_d2_decision_v1_0.md,
-- US-Ne3 is held on an unresolved finding and Tonzi/Vaira/Metolius are not
-- release-ready (external numerator floor; thin evidence + disputed regime
-- label, respectively) — this migration adds the schema for the tier, it
-- does not itself import any of those.
--
-- REUSE, NOT DUPLICATION: hrc_score and hrc_raw_ratio ALREADY exist
-- (base table / migration 005) with exactly the semantics this tier needs —
-- hrc_raw_ratio is documented as "unclipped λE/Rn before [0,10] clamp",
-- which is precisely Q1's capped/uncapped distinction
-- (docs/HRC_30m_test_sites_usa_release_blockers_v1_0.md, Q1). This tier's
-- import populates them exactly like every other tier:
--   hrc_score      = hrc_B_capped   from the pipeline tile CSV (published)
--   hrc_raw_ratio  = hrc_B_uncapped from the pipeline tile CSV (what it was
--                    capped FROM — never a bare flag with no evidence, per Q1)
-- No new columns needed for that pair. See import.py (next) for the mapping.
--
-- NEW columns this migration adds:
--   ef_annual              — 0-1 fraction form of hrc_score (hrc_score = ef_annual × 10)
--   net_rad_denominator    — which D2 denominator produced this row ('B_allsky_downscaled')
--   openet_member_spread   — D-E forest uncertainty band; NULL outside Metolius
--   annual_mean_le_wm2     — Cooling Work (§4.6), Q1-consistent (months-kept, uncapped magnitude)
--   temporal_qualifier     — drives the G7 label ('annual_winter_masked')
--   months_masked          — honest drop-count for the PUBLISHED variant (lowE/lowCov only —
--                            NOT the strict Phase-3 count, which also counts capped-not-dropped
--                            months; see pipeline.js months_masked_tile, added alongside Q1)
--   quality_state           — 'ok' | 'capped' | 'month_masked' | 'flagged'. Added now rather
--                            than as a second migration later, per the external Track B B5
--                            finding (impossible EF>1 scores found nationally, outside any
--                            existing caveat — the project's own screen already exists via
--                            D-G/Q1, this column is what lets the UI show it happened).
--                            Priority when multiple apply: capped > month_masked > ok.
--                            'flagged' is reserved (not populated by the Ne1/Ne2 import) —
--                            for a tile whose validation status is itself uncertain (e.g. a
--                            future Ne3 import, if ever accepted with its held caveat).
--
-- Apply against: Supabase. Additive columns only; existing tiles (Wales, LA,
--                SF Bay, Assam, Barbados, IDF, Tapajós) are untouched — all
--                new columns NULL for them, matching the pattern of every
--                prior migration in this sequence.
-- Reversibility: safe — DROP COLUMN to roll back, then re-run the view
--                refresh (same lesson as migrations 007/008: hrc_tiles_default
--                freezes its column list at creation and must be recreated).
--
-- Read-first: docs/HRC_30m_test_sites_usa_implementation_plan_v1_0.md §4 Phase 4,
--             docs/HRC_30m_test_sites_usa_d2_decision_v1_0.md,
--             docs/HRC_scoring_conventions_source_of_truth.md (C1-C8).
-- =====================================================================

-- ── Add 30 m tier columns ──────────────────────────────────────────────
ALTER TABLE hrc_tiles
  ADD COLUMN IF NOT EXISTS ef_annual            DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS net_rad_denominator  TEXT,
  ADD COLUMN IF NOT EXISTS openet_member_spread DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS annual_mean_le_wm2   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS temporal_qualifier   TEXT,
  ADD COLUMN IF NOT EXISTS months_masked        INT,
  ADD COLUMN IF NOT EXISTS months_capped        INT,
  ADD COLUMN IF NOT EXISTS quality_state        TEXT;

-- ── Column comments ───────────────────────────────────────────────────
COMMENT ON COLUMN hrc_tiles.ef_annual IS
  '30 m tier: annual evaporative fraction (0-1), ratio-of-annual-sums (C1/D-F) '
  'over the published (Q1 capped, months-kept) variant. hrc_score = ef_annual × 10, '
  'same relationship every other tier uses. NULL outside the 30 m tier.';

COMMENT ON COLUMN hrc_tiles.net_rad_denominator IS
  'D2 denominator that produced this row''s hrc_score/ef_annual. Valid values: '
  '''A_clearsky'' (clear-sky 30 m Landsat net radiation) or '
  '''B_allsky_downscaled'' (all-sky ERA5 net radiation, 30 m texture-downscaled). '
  'D2 decision (docs/HRC_30m_test_sites_usa_d2_decision_v1_0.md): B won '
  'unambiguously — every row imported under this tier should read '
  '''B_allsky_downscaled''. Column exists for provenance (a reader should not '
  'have to know the decision by convention) and in case a future site/denominator '
  'combination differs. NULL outside the 30 m tier.';

COMMENT ON COLUMN hrc_tiles.openet_member_spread IS
  'D-E forest uncertainty band: (max - min) × 10 across the six OpenET member '
  'models'' evaporative fraction at the tower footprint, HRC units. Populated '
  'only at forest sites (Metolius) per decision D-E — never a crisp single '
  'value there. NULL for every non-forest 30 m tile, and NULL for all other tiers.';

COMMENT ON COLUMN hrc_tiles.annual_mean_le_wm2 IS
  '30 m tier Cooling Work (§4.6): energy-weighted mean latent-heat flux, '
  'watts per square metre, over the PUBLISHED (Q1 capped, months-kept) month '
  'set — ratio-of-sums, ΣLE / Σseconds over kept months. Uses the UNCAPPED '
  'numerator on purpose: Q1''s capping bounds the EF ratio to keep hrc_score '
  'on a 0-10 scale, but this is a magnitude diagnostic (same relationship to '
  'hrc_score/ef_annual as the pre-existing latent_heat_flux_annual_wm2 has to '
  'that 500 m tier''s score) and has no such ceiling — the latent heat OpenET '
  'reports was really moved regardless of whether that month''s ratio to '
  'available energy exceeds 1. DISTINCT from latent_heat_flux_annual_wm2 '
  '(migration 006): that column is a true 12-month annual mean from the 500 m '
  'PML tier; this one is winter-masked and 30 m-tier-specific. Do not conflate '
  'the two in a cross-tier query.';

COMMENT ON COLUMN hrc_tiles.temporal_qualifier IS
  'Drives the G7 Cooling Work label (conditional, not the global "annual mean" '
  'used by IDF/Tapajós). Valid value for this tier: ''annual_winter_masked'' — '
  'full calendar year, D-D, with months_masked dropped months honestly disclosed '
  'via the months_masked column. NULL for tiers that predate this qualifier '
  '(read as the true-annual default for those).';

COMMENT ON COLUMN hrc_tiles.months_masked IS
  'Count of months excluded from the PUBLISHED (capped) 30 m composite — '
  'genuinely missing/undefined data only (available energy < 25 W/m² or clear- '
  'Landsat coverage < 0.50). Does NOT include months that were capped-and-kept '
  'under Q1 (a physically-too-high month is not "dropped," it is capped at '
  'EF=1.0 and still counted) — this is deliberately a DIFFERENT, smaller count '
  'than the Phase-3 validation script''s strict-variant exclusions, which also '
  'drop the capped months for the tower comparison. This column answers "how '
  'many months does the score on the card actually not include," which is '
  'what the G7 label needs to stay honest. Makes temporal_qualifier honest, '
  'same purpose migration 008''s no-silent-disables columns serve.';

COMMENT ON COLUMN hrc_tiles.months_capped IS
  'Count of months physically capped at EF=1.0 under Q1 (denominator B) rather '
  'than dropped — the months where OpenET reported more latent heat than the '
  'available-energy denominator that month (e.g. Mead Aug/Sep, mild advection). '
  'These months ARE included in hrc_score/ef_annual/annual_mean_le_wm2 (capped, '
  'not excluded) and are NOT counted in months_masked (which is missing-data '
  'only). 0 means quality_state is not ''capped''. NULL outside the 30 m tier.';

COMMENT ON COLUMN hrc_tiles.quality_state IS
  'Per-tile state, single value covering this project''s known ways a score '
  'should not be taken fully at face value. Valid values: '
  '''ok'' — no month was capped or dropped from the published composite. '
  '''capped'' — at least one month was physically capped at EF=1.0 (Q1) '
  'rather than dropped; hrc_raw_ratio shows the pre-cap value. '
  '''month_masked'' — no capping occurred, but months_masked > 0 (missing '
  'data, not a capping event). '
  '''flagged'' — reserved; not populated by the initial Ne1/Ne2 import. For a '
  'tile whose validation status is itself uncertain (see '
  'docs/HRC_30m_test_sites_usa_d2_decision_v1_0.md for the towers this '
  'currently describes, none of which are in the first import). '
  'Priority where more than one could apply: capped > month_masked > ok. '
  'NULL outside the 30 m tier.';

-- ── Refresh hrc_tiles_default to expose the new columns ───────────────
-- Same pattern as migrations 007/008: SELECT t.* freezes the column list at
-- view creation; must drop and recreate to pick up the seven new columns.
DROP VIEW IF EXISTS hrc_tiles_default;

CREATE VIEW hrc_tiles_default AS
WITH per_region AS (
  SELECT
    region_code,
    MIN(data_resolution_m) AS best_resolution
  FROM hrc_tiles
  WHERE region_code IS NOT NULL
    AND data_resolution_m IS NOT NULL
  GROUP BY region_code
)
SELECT t.*
FROM hrc_tiles t
INNER JOIN per_region p
  ON t.region_code = p.region_code
  AND t.data_resolution_m = p.best_resolution;

-- =====================================================================
-- Verification queries (run after migration, before any import)
-- =====================================================================

-- 1. Confirm all seven new columns exist on hrc_tiles:
--    Expected: 8 rows.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'hrc_tiles'
  AND column_name IN (
    'ef_annual', 'net_rad_denominator', 'openet_member_spread',
    'annual_mean_le_wm2', 'temporal_qualifier', 'months_masked', 'months_capped', 'quality_state'
  )
ORDER BY column_name;

-- 2. Confirm the columns are exposed by hrc_tiles_default after the view refresh:
--    Expected: 8 rows.
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'hrc_tiles_default'
  AND column_name IN (
    'ef_annual', 'net_rad_denominator', 'openet_member_spread',
    'annual_mean_le_wm2', 'temporal_qualifier', 'months_masked', 'months_capped', 'quality_state'
  )
ORDER BY column_name;

-- 3. Pre-existing tiles untouched — all new columns NULL:
--    Expected: total_rows == null_in_each_new_column.
SELECT COUNT(*)                                              AS total_rows,
       COUNT(*) FILTER (WHERE ef_annual IS NOT NULL)         AS non_null_ef_annual,
       COUNT(*) FILTER (WHERE quality_state IS NOT NULL)     AS non_null_quality_state
FROM hrc_tiles;
-- Expected: non_null_ef_annual = 0, non_null_quality_state = 0 (nothing imported yet).

-- 4. Confirm 'mead_ne' is not already a used region_code (must be distinct — G2,
--    resolution isolation is keyed on region_code):
--    Expected: 0 rows.
SELECT DISTINCT region_code FROM hrc_tiles WHERE region_code = 'mead_ne';

-- 5. (Run AFTER the Ne1/Ne2 import) net_rad_denominator is always 'B_allsky_downscaled'
--    for this tier, and quality_state is always populated:
--    Expected: 0 rows.
SELECT COUNT(*) AS bad_rows
FROM hrc_tiles
WHERE region_code = 'mead_ne'
  AND (net_rad_denominator IS DISTINCT FROM 'B_allsky_downscaled'
       OR quality_state IS NULL);

-- 6. (Run AFTER the Ne1/Ne2 import) hrc_score is within bounds [0, 10]
--    (the whole point of Q1's cap — this must never fail):
--    Expected: 0 rows.
SELECT COUNT(*) AS out_of_range_scores
FROM hrc_tiles
WHERE region_code = 'mead_ne'
  AND (hrc_score < 0 OR hrc_score > 10);

-- 7. (Run AFTER the Ne1/Ne2 import) months_masked is never larger than the
--    strict Phase-3 exclusion count would suggest is impossible (sanity bound,
--    full calendar year):
--    Expected: 0 rows.
SELECT COUNT(*) AS bad_months_masked
FROM hrc_tiles
WHERE region_code = 'mead_ne'
  AND (months_masked < 0 OR months_masked > 12);
