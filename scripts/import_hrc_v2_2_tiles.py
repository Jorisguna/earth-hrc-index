"""
import_hrc_v2_2_tiles.py — Phase 1 v2.2 tile import (handoff §7.2).

Resilience notes (2026-05-18):
  - Batches are 250 rows (not 1000) to stay below Supabase's HTTP/2
    stream-stall threshold; large batches were broken-piping mid-stream.
  - Each batch is retried up to MAX_BATCH_RETRIES times on exception
    with exponential backoff, so a single transient network blip no
    longer leaves a 1000-row gap in the import.

Loads the v2.2 IDF tile CSV exported by GEE script 31_..._v2_2.js into
Supabase. Follows the established DELETE-then-INSERT pattern documented
in docs/hrc_import_process.md.

The v2.2 tile CSV is self-contained — it carries every v2.1.x field
(hrc_score, hrc_raw_ratio, latent_heat_flux_annual_wm2) plus the eight
new v2.2 columns added by migration 008. The per-ecoregion albedo
reference is joined inside the GEE script, so there is no separate
v2.2 reference CSV.

The existing v2.1.x reference CSV (hrc_v2_1_1_idf_reference.csv from
script 33) is optional — pass --v211-reference <path> to populate
hrc_reference / hrc_reference_p75 / hrc_reference_p95 on the v2.2 rows
so the v2.1.1 toggle in the front-end has a restoration-gap value to
display. Without it those columns are left NULL and the v2.1.1 toggle
shows "—" for restoration gap.

PRE-FLIGHT (run once in Supabase SQL editor before this script):

    -- 1. Apply migration 008 if not already applied
    -- 2. Delete existing IDF tiles to make room (the bounding box
    --    matches the v2.1.2 import target).
    DELETE FROM hrc_tiles
    WHERE longitude BETWEEN 2.4 AND 3.2
      AND latitude  BETWEEN 48.3 AND 48.7;

Usage:
    python3 scripts/import_hrc_v2_2_tiles.py <tiles_csv>
    python3 scripts/import_hrc_v2_2_tiles.py <tiles_csv> --v211-reference <ref_csv>

The script tolerates being re-run after a partial failure: each row
inserts independently in batches of 1000, and SQL DELETE is the
operator's responsibility (per docs/hrc_import_process.md). Verify
afterward with the queries at the bottom of
scripts/migrations/008_albedo_modifier_v2_2.sql.
"""
import os, sys, csv, time, argparse
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

url = os.environ.get('SUPABASE_URL') or os.environ.get('VITE_SUPABASE_URL')
key = (os.environ.get('SUPABASE_SERVICE_KEY')
    or os.environ.get('SUPABASE_ANON_KEY')
    or os.environ.get('VITE_SUPABASE_ANON_KEY'))

if not url or not key:
    raise SystemExit('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in .env')

sb = create_client(url, key)

BATCH_SIZE = 250          # smaller batches → less chance of HTTP/2 stream stalls
MAX_BATCH_RETRIES = 3     # transient broken-pipe retries with backoff
RETRY_BACKOFF_SEC = 2     # 2s, 4s, 8s on consecutive retries
METHODOLOGY_VERSION = 'v2.2_higher_fidelity'
HRC_FORMULA = 'pml_v2_500m_v2.2_albedo_modifier_w0.20'
BATCH_ID = '2026-Q2-v2.2-albedo-modifier'


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


def load_v211_reference(path):
    """Optional helper: read script 33's v2.1.x reference CSV.

    Returns dict keyed by ecoregion_name with the per-ecoregion v2.1.x
    reference fields. Used to populate hrc_reference on the v2.2 rows so
    the v2.1.1 toggle in the front-end has a restoration-gap value.
    """
    ref = {}
    with open(path) as f:
        for row in csv.DictReader(f):
            eco = parse_str(row.get('ecoregion_name'))
            if not eco:
                continue
            hrc_ref = parse_float(row.get('hrc_reference'))
            if hrc_ref is None:
                continue
            ref[eco] = {
                'hrc_reference':        hrc_ref,
                'hrc_reference_p75':    parse_float(row.get('hrc_reference_p75')),
                'hrc_reference_p95':    parse_float(row.get('hrc_reference_p95')),
                'pa_centroid_count':    parse_int(row.get('pa_centroid_count')),
                'reference_filter':     parse_str(row.get('reference_filter')),
                'reference_method':     parse_str(row.get('reference_method')),
                'reference_confidence': parse_str(row.get('reference_confidence')),
            }
    return ref


def build_row(csv_row, v211_ref_by_eco):
    """Map one CSV row to one INSERT dict for hrc_tiles."""
    lon = parse_float(csv_row.get('longitude'))
    lat = parse_float(csv_row.get('latitude'))
    if lon is None or lat is None:
        return None

    eco_name = parse_str(csv_row.get('ecoregion_name'))
    eco_id   = parse_int(csv_row.get('ecoregion_id'))
    biome    = parse_str(csv_row.get('biome_name'))

    # v2.1.x carry-forward (identical to the v2.1.2 import semantics)
    hrc_score    = parse_float(csv_row.get('hrc_score'))
    hrc_raw      = parse_float(csv_row.get('hrc_raw_ratio'))
    lh_flux_wm2  = parse_float(csv_row.get('latent_heat_flux_annual_wm2'))

    # v2.2 new fields
    pixel_albedo = parse_float(csv_row.get('pixel_albedo'))
    albedo_p50   = parse_float(csv_row.get('albedo_ref_p50'))
    deficit_norm = parse_float(csv_row.get('albedo_deficit_norm'))
    status       = parse_str(csv_row.get('albedo_modifier_status'))
    reason       = parse_str(csv_row.get('albedo_modifier_disabled_reason'))
    hrc_v2_2     = parse_float(csv_row.get('hrc_score_v2_2'))
    albedo_src   = parse_str(csv_row.get('albedo_data_source'))
    ref_p90_v22  = parse_float(csv_row.get('reference_p90_v2_2'))

    # Optional v2.1.x reference (for the v2.1.1 front-end toggle)
    v211_ref = v211_ref_by_eco.get(eco_name) if eco_name else None

    return {
        'longitude':                  lon,
        'latitude':                   lat,

        # v2.1.x carry-forward
        'hrc_score':                  round(hrc_score, 4) if hrc_score is not None else None,
        'hrc_raw_ratio':              round(hrc_raw, 4) if hrc_raw is not None else None,
        'latent_heat_flux_annual_wm2': round(lh_flux_wm2, 4) if lh_flux_wm2 is not None else None,

        # v2.2 new columns (added by migration 008)
        'pixel_albedo':                    round(pixel_albedo, 6) if pixel_albedo is not None else None,
        'albedo_ref_p50':                  round(albedo_p50, 6) if albedo_p50 is not None else None,
        'albedo_deficit_norm':             round(deficit_norm, 6) if deficit_norm is not None else None,
        'albedo_modifier_status':          status,
        'albedo_modifier_disabled_reason': reason,
        'hrc_score_v2_2':                  round(hrc_v2_2, 4) if hrc_v2_2 is not None else None,
        'albedo_data_source':              albedo_src,
        'reference_p90_v2_2':              round(ref_p90_v22, 4) if ref_p90_v22 is not None else None,

        # Provenance / region tagging (matches v2.1.2 import)
        'ecoregion_name':             eco_name,
        'biome_name':                 biome,
        'methodology_version':        METHODOLOGY_VERSION,
        'hrc_formula':                HRC_FORMULA,
        'computation_window':         csv_row.get('source_window') or '2023-01-01/2024-01-01',
        'hrc_window_start':           '2023-01-01',
        'hrc_window_end':             '2024-01-01',
        'confidence_tier':            'B',
        'batch_id':                   BATCH_ID,
        'region_code':                csv_row.get('region_code') or 'idf',
        'data_source':                csv_row.get('data_source') or 'PML_V2_500m',
        'data_resolution_m':          parse_int(csv_row.get('data_resolution_m')) or 500,
        'source_window':              csv_row.get('source_window') or '2023-01-01/2024-01-01',
        'lst_source':                 csv_row.get('lst_source') or 'mixed_Terra_Aqua_day_night_equal_weight',

        # v2.1.x reference fields (populated only if --v211-reference was supplied)
        'hrc_reference':              (v211_ref or {}).get('hrc_reference'),
        'hrc_reference_p75':          (v211_ref or {}).get('hrc_reference_p75'),
        'hrc_reference_p95':          (v211_ref or {}).get('hrc_reference_p95'),
        'pa_centroid_count':          (v211_ref or {}).get('pa_centroid_count'),
        'reference_filter':           (v211_ref or {}).get('reference_filter'),
        'reference_method':           (v211_ref or {}).get('reference_method'),
        'reference_confidence':       (v211_ref or {}).get('reference_confidence'),
        'restoration_gap':            (
            round(max((v211_ref or {}).get('hrc_reference', 0) - hrc_score, 0.0), 4)
            if v211_ref and hrc_score is not None and (v211_ref.get('hrc_reference') is not None)
            else None
        ),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('tiles_csv', help='v2.2 tile CSV from GEE script 31_..._v2_2.js')
    parser.add_argument('--v211-reference', default=None,
        help='Optional v2.1.x reference CSV (script 33 output) for hrc_reference back-fill')
    args = parser.parse_args()

    tiles_path = os.path.expanduser(args.tiles_csv)
    if not os.path.exists(tiles_path):
        raise SystemExit(f'Tiles CSV not found: {tiles_path}')

    v211_ref_by_eco = {}
    if args.v211_reference:
        ref_path = os.path.expanduser(args.v211_reference)
        if not os.path.exists(ref_path):
            raise SystemExit(f'v2.1.x reference CSV not found: {ref_path}')
        v211_ref_by_eco = load_v211_reference(ref_path)
        print(f'Loaded v2.1.x reference for {len(v211_ref_by_eco)} ecoregion(s) '
              f'from {os.path.basename(ref_path)}')
    else:
        print('No --v211-reference supplied; v2.2 rows will have hrc_reference NULL. '
              'The v2.1.1 toggle in the front-end will show "—" for restoration gap.')

    print(f'\nLoading tile rows from {os.path.basename(tiles_path)}...')
    with open(tiles_path) as f:
        tiles = list(csv.DictReader(f))
    print(f'  {len(tiles)} CSV rows')

    # Reminder, not enforcement — the operator is expected to run the
    # DELETE from the docstring above before re-importing.
    print('\nReminder: the established import process (docs/hrc_import_process.md '
          'step 4) is to DELETE existing IDF rows in Supabase before running this '
          'script. If you have not done so, expect duplicate (lon, lat) entries.\n')

    inserted = failed = skipped_no_coords = 0
    out_of_range = []
    disabled_count = 0
    enabled_count  = 0
    batch = []

    def flush_batch():
        nonlocal inserted, failed, batch
        if not batch:
            return
        # Retry on transient network errors (broken pipe, timeout, etc.)
        # Supabase's REST endpoint occasionally drops mid-stream under
        # large IDF/Tapajos imports; one retry usually fixes it.
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
                    print(f'  [batch transient error at row {inserted+failed+1}+]: '
                          f'{e} — retrying in {wait}s '
                          f'(attempt {attempt + 2}/{MAX_BATCH_RETRIES})')
                    time.sleep(wait)
        print(f'  [batch insert failed after {MAX_BATCH_RETRIES} retries '
              f'at row {inserted+failed+1}+]: {last_err}')
        failed += len(batch)
        batch = []

    for raw in tiles:
        row = build_row(raw, v211_ref_by_eco)
        if row is None:
            skipped_no_coords += 1
            continue

        # Tally status counts for the summary
        if row['albedo_modifier_status'] == 'enabled':
            enabled_count += 1
        elif row['albedo_modifier_status'] == 'disabled':
            disabled_count += 1

        # Bounds-check v2.2 score
        v22 = row['hrc_score_v2_2']
        if v22 is not None and not (0 <= v22 <= 10):
            out_of_range.append((row['longitude'], row['latitude'], v22))

        batch.append(row)
        if len(batch) >= BATCH_SIZE:
            flush_batch()
            print(f'  {inserted + failed}/{len(tiles)} '
                  f'({inserted} inserted, {failed} failed)')

    flush_batch()

    # ── Summary ──────────────────────────────────────────────────────
    print('\n── Import summary ───────────────────────────────────')
    print(f'  Total CSV rows:         {len(tiles)}')
    print(f'  Skipped (no coords):    {skipped_no_coords}')
    print(f'  Inserted:               {inserted}')
    print(f'  Failed:                 {failed}')
    print(f'  Modifier enabled:       {enabled_count}')
    print(f'  Modifier disabled:      {disabled_count}')
    if out_of_range:
        print(f'  Out-of-range v2.2 scores: {len(out_of_range)} '
              f'(first 5: {out_of_range[:5]})')

    if failed > len(tiles) * 0.1:
        print('  WARNING: >10% of inserts failed — check that migration 008 '
              'has been applied and that .env uses SUPABASE_SERVICE_KEY.')

    print('\nNext step:')
    print('  Run the verification queries at the bottom of')
    print('  scripts/migrations/008_albedo_modifier_v2_2.sql in Supabase.')


if __name__ == '__main__':
    main()
