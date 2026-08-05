"""
import.py — Phase 4 import for the 30 m OpenET demonstration tier.
HRC 30 m US test sites (docs/HRC_30m_test_sites_usa_implementation_plan_v1_0.md
§4 Phase 4, docs/HRC_30m_test_sites_usa_d2_decision_v1_0.md).

SCOPE OF THIS IMPORT — narrower than the whole Mead tile export
-----------------------------------------------------------------
Phase 3 validated the pipeline at TOWER POINTS: US-Ne1 and US-Ne2 passed both
gates; US-Ne3 was held on an unresolved finding (see the D2 decision record).
But `pipeline.js`'s tile export is a spatial grid over the WHOLE Mead bbox —
one uniform method, no per-field switch — so "Ne1/Ne2 cleared" does not by
itself say which of the ~99,000 tile-grid pixels are safe to import.

Land classification (distinguishing irrigated from rainfed cropland
pixel-by-pixel, so unvalidated-regime tiles could be excluded on their own
merits) is real, useful, and explicitly OUT of scope here — see
docs/HRC_land_classification_layer_backlog_v1_0.md. Absent that, this import
uses the only defensible boundary available: the SAME 100 m radius
(FOOTPRINT_RADIUS_M in pipeline.js) that Phase 3 itself validated against the
tower data. Nothing wider — this is deliberately a small release (two small
patches, not a regional layer), not an accident of an unfinished filter.

REQUIRED CSV COLUMNS — will refuse to run without them
---------------------------------------------------------
`annual_mean_le_wm2_tile` and `months_masked_tile` were added to pipeline.js
AFTER the current Mead tile export was generated (2026-08-06, alongside the
Q1 capped/uncapped fix). Falling back to the old `annual_mean_le_wm2` /
`months_masked` columns would silently import the STRICT (months-dropped)
Cooling Work figure and an overcounted drop-count next to a CAPPED
(months-kept) hrc_score — an internally inconsistent row, and exactly the
kind of silent regression this project's whole D-G/Q1/Track-B history exists
to prevent. This script checks for the new columns and refuses to run if
they are missing, rather than falling back quietly. Re-run pipeline.js in
GEE and re-export if you hit this.

PRE-FLIGHT (run once in Supabase SQL editor before this script)
-------------------------------------------------------------------
    -- 1. Apply migration 009 if not already applied.
    -- 2. Confirm region_code='mead_ne' is not already in use (migration 009
    --    verification query 4) — this is a brand-new region, first import.
    -- 3. If re-running after a prior partial import:
    DELETE FROM hrc_tiles WHERE region_code = 'mead_ne';

Usage:
    python3 scripts/import.py <mead_tiles_csv>

Verify afterward with the queries at the bottom of
scripts/migrations/009_openet_30m_tier.sql.
"""
import argparse
import csv
import math
import os
import sys
import time

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

url = os.environ.get('SUPABASE_URL') or os.environ.get('VITE_SUPABASE_URL')
key = (os.environ.get('SUPABASE_SERVICE_KEY')
    or os.environ.get('SUPABASE_ANON_KEY')
    or os.environ.get('VITE_SUPABASE_ANON_KEY'))

if not url or not key:
    raise SystemExit('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in .env')

sb = create_client(url, key)

BATCH_SIZE = 250          # same as import_hrc_v2_2_tiles.py — stays below
MAX_BATCH_RETRIES = 3     # Supabase's HTTP/2 stream-stall threshold; smaller
RETRY_BACKOFF_SEC = 2     # batches + retry/backoff is hard-won resilience (G5).

METHODOLOGY_VERSION = 'v1.0_openet_30m_demonstration'
HRC_FORMULA = 'openet_ensemble_30m_era5_texture_downscaled_v2.0_denomB'
BATCH_ID = '2026-Q3-30m-mead-ne1-ne2'
NET_RAD_DENOMINATOR = 'B_allsky_downscaled'   # D2 decision — the only winner this tier ships
LST_SOURCE = 'Landsat_C2_L2_ST_B10'           # provenance: this tier does not use MODIS LST mixing

# ── Import scope: cleared towers only (D2 decision §7), 100 m radius = the
# same FOOTPRINT_RADIUS_M Phase 3 validated against. Add a tower here only
# once its own D2 disposition says "cleared" — do not widen ad hoc.
FOOTPRINT_RADIUS_M = 100
CLEARED_TOWERS = [
    {'id': 'US-Ne1', 'lon': -96.4766, 'lat': 41.1651},
    {'id': 'US-Ne2', 'lon': -96.4701, 'lat': 41.1649},
]
REQUIRED_NEW_COLUMNS = ['annual_mean_le_wm2_tile', 'months_masked_tile']


def parse_float(val):
    if val in ('', 'null', 'None', None):
        return None
    try:
        return float(val)
    except ValueError:
        return None


def parse_int(val):
    if val in ('', 'null', 'None', None):
        return None
    try:
        return int(float(val))
    except ValueError:
        return None


def parse_str(val):
    if val in ('', 'null', 'None', None):
        return None
    s = str(val).strip()
    return s or None


def haversine_m(lat1, lon1, lat2, lon2):
    """Great-circle distance in metres. Exact, not an equirectangular
    shortcut — cheap enough at this row count and removes any doubt about
    approximation error at the 100 m scale this filter operates on."""
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def nearest_cleared_tower(lon, lat):
    """Returns (tower_id, distance_m) for the closest cleared tower, or
    (None, None) if outside every tower's radius — this row is out of scope."""
    best_id, best_dist = None, None
    for t in CLEARED_TOWERS:
        d = haversine_m(lat, lon, t['lat'], t['lon'])
        if d <= FOOTPRINT_RADIUS_M and (best_dist is None or d < best_dist):
            best_id, best_dist = t['id'], d
    return best_id, best_dist


def quality_state_for(months_capped, months_masked):
    # Priority order per migration 009: capped > month_masked > ok.
    if months_capped and months_capped > 0:
        return 'capped'
    if months_masked and months_masked > 0:
        return 'month_masked'
    return 'ok'


def build_row(csv_row):
    lon = parse_float(csv_row.get('longitude'))
    lat = parse_float(csv_row.get('latitude'))
    if lon is None or lat is None:
        return None, None, None

    tower_id, dist_m = nearest_cleared_tower(lon, lat)
    if tower_id is None:
        return None, None, None  # outside the import scope — not an error, just excluded

    hrc_score      = parse_float(csv_row.get('hrc_B_capped'))
    hrc_raw_ratio  = parse_float(csv_row.get('hrc_B_uncapped'))
    ef_annual      = parse_float(csv_row.get('ef_annual_B_capped'))
    le_wm2         = parse_float(csv_row.get('annual_mean_le_wm2_tile'))
    months_masked  = parse_int(csv_row.get('months_masked_tile'))
    months_capped  = parse_int(csv_row.get('months_capped_B'))

    row = {
        'longitude': lon,
        'latitude':  lat,

        'hrc_score':     round(hrc_score, 4) if hrc_score is not None else None,
        'hrc_raw_ratio': round(hrc_raw_ratio, 4) if hrc_raw_ratio is not None else None,
        'ef_annual':     round(ef_annual, 6) if ef_annual is not None else None,

        'net_rad_denominator':  NET_RAD_DENOMINATOR,
        'openet_member_spread': parse_float(csv_row.get('openet_member_spread')),  # NULL — not forest
        'annual_mean_le_wm2':   round(le_wm2, 4) if le_wm2 is not None else None,
        'temporal_qualifier':   'annual_winter_masked',
        'months_masked':        months_masked,
        'months_capped':        months_capped,
        'quality_state':        quality_state_for(months_capped, months_masked),

        'region_code':       csv_row.get('region_code') or 'mead_ne',
        'data_source':       csv_row.get('data_source'),
        'data_resolution_m': parse_int(csv_row.get('data_resolution_m')) or 30,
        'source_window':     csv_row.get('source_window') or '2023-01-01/2024-01-01',
        'lst_source':        LST_SOURCE,
        'methodology_version': METHODOLOGY_VERSION,
        'hrc_formula':        HRC_FORMULA,
        'computation_window': csv_row.get('source_window') or '2023-01-01/2024-01-01',
        'hrc_window_start':   '2023-01-01',
        'hrc_window_end':     '2024-01-01',
        'batch_id':           BATCH_ID,
    }
    return row, tower_id, dist_m


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('tiles_csv', help='hrc_30m_mead_ne_tiles.csv from scripts/pipeline.js')
    args = parser.parse_args()

    tiles_path = os.path.expanduser(args.tiles_csv)
    if not os.path.exists(tiles_path):
        raise SystemExit(f'Tiles CSV not found: {tiles_path}')

    with open(tiles_path) as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames or []
        tiles = list(reader)

    missing = [c for c in REQUIRED_NEW_COLUMNS if c not in header]
    if missing:
        raise SystemExit(
            f'Refusing to import: {tiles_path} is missing {missing}.\n'
            f'These columns were added to pipeline.js on 2026-08-06 (the Q1 Cooling-Work/'
            f'months_masked fix) — this CSV predates that patch. Re-run pipeline.js in the '
            f'GEE Code Editor, re-run the mead_ne _tiles export task, and re-download before '
            f'importing. Falling back to the old annual_mean_le_wm2/months_masked columns '
            f'would silently pair a CAPPED (months-kept) hrc_score with a STRICT '
            f'(months-dropped) Cooling Work figure — an internally inconsistent row.'
        )

    print(f'Loaded {len(tiles)} rows from {os.path.basename(tiles_path)}')
    print(f'Import scope: within {FOOTPRINT_RADIUS_M} m of '
          + ', '.join(f"{t['id']} ({t['lat']:.4f},{t['lon']:.4f})" for t in CLEARED_TOWERS))
    print('Reminder: run `DELETE FROM hrc_tiles WHERE region_code = \'mead_ne\';` in Supabase '
          'first if this is a re-run (docs/hrc_import_process.md pattern).\n')

    inserted = failed = skipped_out_of_scope = skipped_no_coords = 0
    out_of_range = []
    quality_counts = {'ok': 0, 'capped': 0, 'month_masked': 0, 'flagged': 0}
    by_tower = {t['id']: 0 for t in CLEARED_TOWERS}
    batch = []

    def flush_batch():
        nonlocal inserted, failed, batch
        if not batch:
            return
        last_err = None
        for attempt in range(MAX_BATCH_RETRIES):
            try:
                result = sb.table('hrc_tiles').insert(batch).execute()
                if result.data:
                    inserted += len(result.data)
                else:
                    failed += len(batch)
                batch = []
                return
            except Exception as e:
                last_err = e
                if attempt < MAX_BATCH_RETRIES - 1:
                    wait = RETRY_BACKOFF_SEC * (2 ** attempt)
                    print(f'  [batch transient error at row {inserted + failed + 1}+]: '
                          f'{e} — retrying in {wait}s (attempt {attempt + 2}/{MAX_BATCH_RETRIES})')
                    time.sleep(wait)
        print(f'  [batch insert failed after {MAX_BATCH_RETRIES} retries '
              f'at row {inserted + failed + 1}+]: {last_err}')
        failed += len(batch)
        batch = []

    for raw in tiles:
        lon, lat = parse_float(raw.get('longitude')), parse_float(raw.get('latitude'))
        if lon is None or lat is None:
            skipped_no_coords += 1
            continue

        row, tower_id, dist_m = build_row(raw)
        if row is None:
            skipped_out_of_scope += 1
            continue

        by_tower[tower_id] += 1
        quality_counts[row['quality_state']] = quality_counts.get(row['quality_state'], 0) + 1

        if row['hrc_score'] is not None and not (0 <= row['hrc_score'] <= 10):
            out_of_range.append((row['longitude'], row['latitude'], row['hrc_score']))

        batch.append(row)
        if len(batch) >= BATCH_SIZE:
            flush_batch()
            print(f'  {inserted + failed}/{skipped_out_of_scope + inserted + failed} in-scope rows processed '
                  f'({inserted} inserted, {failed} failed)')

    flush_batch()

    print('\n── Import summary ───────────────────────────────────')
    print(f'  Total CSV rows:          {len(tiles)}')
    print(f'  Skipped (no coords):     {skipped_no_coords}')
    print(f'  Skipped (out of scope):  {skipped_out_of_scope}  '
          f'(outside {FOOTPRINT_RADIUS_M} m of any cleared tower)')
    print(f'  In scope, inserted:      {inserted}')
    print(f'  In scope, failed:        {failed}')
    print(f'  By tower: {by_tower}')
    print(f'  quality_state: {quality_counts}')
    if out_of_range:
        print(f'  WARNING out-of-range hrc_score: {len(out_of_range)} rows '
              f'(first 5: {out_of_range[:5]}) — Q1 capping should make this impossible; '
              f'investigate before trusting the import.')

    if inserted == 0:
        print('\n  WARNING: nothing was inserted. Check the CSV covers the Mead bbox and '
              f'that {FOOTPRINT_RADIUS_M} m actually intersects grid pixels at native 30 m '
              'resolution (it should — ~35 pixels per tower).')
    elif failed > (inserted + failed) * 0.1:
        print('  WARNING: >10% of in-scope inserts failed — check migration 009 is applied '
              'and .env uses SUPABASE_SERVICE_KEY.')

    print('\nNext step:')
    print('  Run the verification queries at the bottom of')
    print('  scripts/migrations/009_openet_30m_tier.sql in Supabase.')


if __name__ == '__main__':
    main()
