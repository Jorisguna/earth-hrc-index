-- =====================================================================
-- delete_idf_for_v2_2_import.sql
-- Pre-import cleanup for v2.2 IDF deployment (handoff §7.2).
--
-- Run this in the Supabase SQL editor BEFORE running
-- scripts/import_hrc_v2_2_tiles.py. The import script INSERTs new rows;
-- without deleting the existing v2.1.2 IDF tiles first, you would end
-- up with two rows per (longitude, latitude) location and the front-end
-- H3 deduplication would silently keep whichever appears first.
--
-- This follows the established DELETE-then-INSERT pattern documented in
-- docs/hrc_import_process.md §4. The bounding box matches the IDF
-- showcase region used in scripts 31_..._v2_1_2.js and 31_..._v2_2.js.
-- =====================================================================

-- ── Step 1 — Pre-delete count (sanity check; nothing is deleted yet) ──
-- Inspect this before running the DELETE. Expected on a healthy v2.1.2
-- deployment: ~16,000 rows tagged methodology_version='v2.1.2_higher_fidelity'.
-- If you see far more than that, the bounding box is selecting rows you
-- did not intend to delete — stop and check before continuing.
SELECT methodology_version,
       data_resolution_m,
       COUNT(*) AS rows_to_be_deleted
FROM hrc_tiles
WHERE longitude BETWEEN 2.4 AND 3.2
  AND latitude  BETWEEN 48.3 AND 48.7
GROUP BY methodology_version, data_resolution_m
ORDER BY methodology_version;

-- ── Step 2 — DELETE ──────────────────────────────────────────────────
-- Same bounding box as the v2.0 / v2.1.x import scripts. Wrap in a
-- transaction so you can ROLLBACK if Step 3 shows anything unexpected.
BEGIN;

DELETE FROM hrc_tiles
WHERE longitude BETWEEN 2.4 AND 3.2
  AND latitude  BETWEEN 48.3 AND 48.7;

-- ── Step 3 — Post-delete verification ────────────────────────────────
-- Expected: 0 rows. If non-zero, do NOT commit — investigate which rows
-- survived the WHERE and rerun the delete (or ROLLBACK to abort).
SELECT COUNT(*) AS rows_remaining_in_idf_bbox
FROM hrc_tiles
WHERE longitude BETWEEN 2.4 AND 3.2
  AND latitude  BETWEEN 48.3 AND 48.7;

-- ── Step 4 — Commit or rollback ──────────────────────────────────────
-- If Step 3 returned 0, commit. Otherwise replace with ROLLBACK.
COMMIT;
-- ROLLBACK;
