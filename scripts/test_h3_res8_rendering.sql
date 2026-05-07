-- ============================================================
-- test_h3_res8_rendering.sql
-- Phase 0 step 5.4 — verify deck.gl renders H3 res 8 hexes correctly
--
-- Inserts 3 test rows near central London at ~530m spacing (the H3 res 8
-- edge length). Each row has data_resolution_m = 500 so the updated
-- App.jsx code routes them through the H3 res 8 indexing path.
--
-- Coordinates chosen near Hyde Park / Marble Arch:
--   - 51.5074°N, -0.1278°E (Hyde Park Corner)
--   - 51.5074°N, -0.1356°E (~530m west)
--   - 51.5121°N, -0.1278°E (~530m north)
--
-- HRC scores 5.0 / 6.0 / 7.0 so the three hexes render in different colours.
-- restoration_gap = 1.0 so they're visible in default Gap view too.
--
-- After the test, run the cleanup at the bottom to remove these rows.
-- ============================================================

INSERT INTO hrc_tiles (
  longitude, latitude, hrc_score,
  ecoregion_name, biome_name,
  region_code, data_source, data_resolution_m, source_window,
  methodology_version, hrc_formula, computation_window,
  hrc_window_start, hrc_window_end,
  confidence_tier, batch_id,
  hrc_reference, restoration_gap, reference_method
) VALUES
  (-0.1278, 51.5074, 5.0,
   'TEST — H3 res 8 rendering check', 'TEST',
   'test_h3_res_8', 'PML_V2_500m', 500, 'TEST',
   'v2.0', 'test_h3_res_8', 'TEST',
   '2023-01-01', '2024-01-01',
   'B', '2026-Q2-test',
   6.5, 1.5, 'flux_tower_published'),
  (-0.1356, 51.5074, 6.0,
   'TEST — H3 res 8 rendering check', 'TEST',
   'test_h3_res_8', 'PML_V2_500m', 500, 'TEST',
   'v2.0', 'test_h3_res_8', 'TEST',
   '2023-01-01', '2024-01-01',
   'B', '2026-Q2-test',
   6.5, 0.5, 'flux_tower_published'),
  (-0.1278, 51.5121, 7.0,
   'TEST — H3 res 8 rendering check', 'TEST',
   'test_h3_res_8', 'PML_V2_500m', 500, 'TEST',
   'v2.0', 'test_h3_res_8', 'TEST',
   '2023-01-01', '2024-01-01',
   'B', '2026-Q2-test',
   7.5, 0.5, 'flux_tower_published');

-- Verify
SELECT longitude, latitude, hrc_score, region_code, data_resolution_m
FROM hrc_tiles
WHERE region_code = 'test_h3_res_8'
ORDER BY latitude, longitude;
