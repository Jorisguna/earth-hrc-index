# HRC Full Recompute Handoff v2
# Saved from user-provided document — April 21, 2026
# See project memory: project_intact_site_methodology.md for full context

Supersedes all previous handoff docs and v1.1 methodology.

## Key changes from v1.1 to v2.0

**Formula:** ratio of annual sums (not mean of monthly EFs)
  HRC = 10 × Σ|λE_monthly| / Σ(Rn_monthly)

**Dataset:** ERA5_LAND/MONTHLY_AGGR (not DAILY_AGGR)

**Time window:** Jan 2025 – Jan 2026 (not Apr 2025 – Mar 2026)

**Reference sampling:** centroid-based (not polygon reduceRegion — fails at scale)

**Active pilot regions:** Wales, Los Angeles, SF Bay

## GEE scripts in this repo

Tile recompute (v2.0):
  25_hrc_tiles_wales_v2_0.js
  26_hrc_tiles_la_v2_0.js
  27_hrc_tiles_sfbay_v2_0.js

Intact reference (v2.0, centroid sampling):
  28_hrc_reference_wales_v2_0.js
  29_hrc_reference_la_v2_0.js   (IUCN I–VI — sparse PAs in LA)
  30_hrc_reference_sfbay_v2_0.js

DB migration:
  migrations/003_v2_0_schema.sql

Import/merge:
  merge_and_import_v2_0.py

## Validated results (April 21, 2026)

Wales Celtic broadleaf: mean 8.82, p90 9.90, gap 1.07, n=1053
Wales English Lowlands beech: mean 8.31, p90 8.70, gap 0.39, n=97
LA coastal sage: mean 2.90, p90 3.10, gap 0.20, n=60
LA montane chaparral: mean 2.75, p90 3.07, gap 0.32, n=23
LA Mojave: mean 2.91, p90 null, gap null, n=0

## Reference confidence thresholds

>= 50 samples → high
20-49 → moderate
10-19 → low
< 10  → null (no reference stored)
