-- ============================================================
-- test_h3_res8_cleanup.sql
-- Removes the 3 test rows inserted by test_h3_res8_rendering.sql.
-- Run this AFTER verifying H3 res 8 renders correctly in the app.
-- ============================================================

DELETE FROM hrc_tiles WHERE region_code = 'test_h3_res_8';

-- Verify cleanup
SELECT COUNT(*) AS remaining_test_rows
FROM hrc_tiles
WHERE region_code = 'test_h3_res_8';
-- Expected: 0
