"""
merge_and_import_v2_1_higher_fidelity.py
HRC v2.1 higher-fidelity showcase — merge tile CSV + reference CSV, compute
restoration gaps, INSERT v2.1 tile rows into Supabase.

Two showcase regions:
  - Île-de-France (idf):  Path A intact reference (centroid sampling, IUCN I-IV)
                          Path C fallback: FR-Fon flux-tower reference 5.04
  - Tapajós (tapajos):    Path B intact reference (Hansen image masking)
                          Path C fallback: K67 flux-tower reference 7.89

What it does:
  1. Loads tile CSVs (from GEE 31/32) and reference CSVs (from GEE 33/34),
     matched by region name.
  2. Joins reference columns onto tiles by ecoregion_name.
  3. For ecoregions where the reference CSV's confidence is 'insufficient'
     (Path A < 10 centroids, Path B < 500 intact pixels), falls back to the
     flux-tower-derived reference for that region.
  4. Computes restoration_gap = max(hrc_reference - hrc_score, 0).
  5. INSERTs new rows into hrc_tiles with all v2.1 fields populated.

Usage — single pair:
  python3 scripts/merge_and_import_v2_1_higher_fidelity.py <tiles_csv> <reference_csv>

Usage — whole directory (auto-pairs by region name):
  python3 scripts/merge_and_import_v2_1_higher_fidelity.py ~/Downloads/

  Auto-pairing rule: for every file matching hrc_v2_1_*_tiles.csv it looks
  for hrc_v2_1_*_reference.csv with the same region slug.
    e.g. hrc_v2_1_idf_tiles.csv     →  hrc_v2_1_idf_reference.csv
         hrc_v2_1_tapajos_tiles.csv →  hrc_v2_1_tapajos_reference.csv

After this completes, run scripts/validate_satellite_vs_tower.py to verify
the acceptance gate (FR-Fon ±0.5 of 5.04, K67 ±0.5 of 7.89).
"""
import os, sys, csv, glob
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

# Path C flux-tower fallbacks per region. Used when an ecoregion has
# insufficient PA centroids (Path A) or intact pixels (Path B).
# References derived from validation_artefacts/{frfon,k67}/.
PATH_C_FALLBACK = {
    'idf': {
        'hrc_reference':        5.04,
        'reference_method':     'flux_tower_published',
        'reference_confidence': 'medium',
        'reference_filter':     'FR-Fon_2020-2025_LE_CORR',
        'pa_centroid_count':    None,
        'hrc_reference_p75':    None,
        'hrc_reference_p95':    None,
    },
    'tapajos': {
        'hrc_reference':        7.89,
        'reference_method':     'flux_tower_published',
        'reference_confidence': 'medium',
        'reference_filter':     'K67_2002-2011_EBC1.18',
        'pa_centroid_count':    None,
        'hrc_reference_p75':    None,
        'hrc_reference_p95':    None,
    },
}

# ── Argument parsing ─────────────────────────────────────────────────
if len(sys.argv) == 2 and os.path.isdir(sys.argv[1]):
    folder = os.path.expanduser(sys.argv[1])
    # v2.1.1 has mixed export naming:
    #   - Tiles use suffix convention:  hrc_v2_1_<region>_tiles_v2_1_1.csv
    #   - References use inline:        hrc_v2_1_1_<region>_reference.csv
    tile_files = sorted(glob.glob(os.path.join(folder, 'hrc_v2_1_*_tiles_v2_1_1.csv')))
    if not tile_files:
        raise SystemExit(f'No hrc_v2_1_*_tiles_v2_1_1.csv files found in {folder}')
    pairs = []
    for tf in tile_files:
        basename = os.path.basename(tf)
        # hrc_v2_1_idf_tiles_v2_1_1.csv → idf
        slug = basename.replace('hrc_v2_1_', '').replace('_tiles_v2_1_1.csv', '')
        rf = os.path.join(folder, f'hrc_v2_1_1_{slug}_reference.csv')
        if not os.path.exists(rf):
            print(f'  [skip] No reference file for region "{slug}" (expected {rf})')
            continue
        pairs.append((tf, rf, slug))
    if not pairs:
        raise SystemExit('No valid tile+reference pairs found.')
    print(f'Found {len(pairs)} region pair(s): {", ".join(s for _, _, s in pairs)}')
elif len(sys.argv) == 3:
    tiles_path = os.path.expanduser(sys.argv[1])
    ref_path   = os.path.expanduser(sys.argv[2])
    for p in [tiles_path, ref_path]:
        if not os.path.exists(p):
            raise SystemExit(f'File not found: {p}')
    basename = os.path.basename(tiles_path)
    slug = basename.replace('hrc_v2_1_', '').replace('_tiles_v2_1_1.csv', '')
    pairs = [(tiles_path, ref_path, slug)]
else:
    raise SystemExit(
        'Usage:\n'
        '  python3 scripts/merge_and_import_v2_1_higher_fidelity.py ~/Downloads/\n'
        '  python3 scripts/merge_and_import_v2_1_higher_fidelity.py <tiles_csv> <reference_csv>'
    )

# ── Helpers ──────────────────────────────────────────────────────────
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

def load_reference(ref_path, slug):
    """Load reference CSV, return dict keyed by ecoregion_name.
    Falls back to Path C for ecoregions with 'insufficient' confidence.
    """
    ref = {}
    fallback = PATH_C_FALLBACK.get(slug, {})
    with open(ref_path) as f:
        for row in csv.DictReader(f):
            eco = (row.get('ecoregion_name') or '').strip()
            if not eco:
                continue
            confidence = (row.get('reference_confidence') or '').strip()
            hrc_ref = parse_float(row.get('hrc_reference'))

            if confidence == 'insufficient' or hrc_ref is None:
                if fallback:
                    print(f'  [path C] {eco}: confidence={confidence!r}, '
                          f'using flux-tower fallback {fallback["hrc_reference"]}')
                    ref[eco] = dict(fallback)
                else:
                    print(f'  [skip] {eco}: insufficient samples and no fallback')
                continue

            # Path B (Hansen) uses intact_pixel_count instead of pa_centroid_count;
            # store whichever is present in the same DB column for downstream simplicity.
            sample_count = (parse_int(row.get('pa_centroid_count'))
                          or parse_int(row.get('intact_pixel_count')))

            ref[eco] = {
                'hrc_reference':        hrc_ref,
                'hrc_reference_p75':    parse_float(row.get('hrc_reference_p75')),
                'hrc_reference_p95':    parse_float(row.get('hrc_reference_p95')),
                'pa_centroid_count':    sample_count,
                'reference_filter':     (row.get('reference_filter') or '').strip() or None,
                'reference_method':     (row.get('reference_method') or '').strip() or None,
                'reference_confidence': confidence,
            }
    return ref

def process_region(tiles_path, ref_path, slug):
    print(f'\n── {slug.upper()} ──────────────────────────────')
    ref_by_eco = load_reference(ref_path, slug)
    print(f'Loaded {len(ref_by_eco)} ecoregion references (incl. Path C fallbacks)')
    fallback = PATH_C_FALLBACK.get(slug, {})

    with open(tiles_path) as f:
        tiles = list(csv.DictReader(f))
    print(f'Processing {len(tiles)} tiles...')

    inserted = skipped = no_ref_used_fallback = 0
    warnings = []
    BATCH_SIZE = 1000   # rows per HTTP request — keeps total under HTTP/2 stream cap
    batch = []

    def flush_batch():
        """Send the current batch via one HTTP call."""
        nonlocal inserted, skipped, batch
        if not batch:
            return
        try:
            result = sb.table('hrc_tiles').insert(batch).execute()
            if result.data:
                inserted += len(result.data)
            else:
                skipped += len(batch)
        except Exception as e:
            print(f'  [batch insert failed at row {inserted+skipped}+]: {e}')
            skipped += len(batch)
        batch = []

    for row in tiles:
        lon = parse_float(row.get('longitude'))
        lat = parse_float(row.get('latitude'))
        if lon is None or lat is None:
            skipped += 1
            continue

        hrc_score    = parse_float(row.get('hrc_score') or row.get('HRC_score'))
        hrc_raw      = parse_float(row.get('hrc_raw_ratio'))
        if hrc_score is not None and not (0 <= hrc_score <= 10):
            warnings.append(f'  Out-of-range hrc {hrc_score:.3f} at ({lon:.5f}, {lat:.5f})')

        eco_name = (row.get('ecoregion_name') or '').strip() or None
        eco_id   = parse_int(row.get('ecoregion_id'))
        biome    = (row.get('biome_name') or '').strip() or None

        # Look up reference. If the tile's ecoregion has no entry (e.g. it
        # falls in an ecoregion with insufficient samples that wasn't
        # catalogued in the reference CSV), use the region's Path C fallback.
        ref = ref_by_eco.get(eco_name) if eco_name else None
        if ref is None:
            if fallback:
                ref = dict(fallback)
                no_ref_used_fallback += 1
            else:
                ref = {}

        hrc_reference = ref.get('hrc_reference')
        restoration_gap = None
        if hrc_score is not None and hrc_reference is not None:
            restoration_gap = round(max(hrc_reference - hrc_score, 0.0), 4)

        insert_data = {
            'longitude':                  lon,
            'latitude':                   lat,
            'hrc_score':                  round(hrc_score, 4) if hrc_score is not None else None,
            'hrc_raw_ratio':              round(hrc_raw, 4) if hrc_raw is not None else None,
            'ecoregion_name':             eco_name,
            'biome_name':                 biome,
            'methodology_version':        'v2.1.1_higher_fidelity',
            'hrc_formula':                'pml_v2_500m_v2.1.1',
            'computation_window':         row.get('source_window') or '2023-01-01/2024-01-01',
            'hrc_window_start':           '2023-01-01',
            'hrc_window_end':             '2024-01-01',
            'confidence_tier':            'B',
            'batch_id':                   '2026-Q2-v2.1.1-higher-fidelity',
            'region_code':                row.get('region_code') or slug,
            'data_source':                row.get('data_source') or 'PML_V2_500m',
            'data_resolution_m':          parse_int(row.get('data_resolution_m')) or 500,
            'source_window':              row.get('source_window') or '2023-01-01/2024-01-01',
            'lst_source':                 row.get('lst_source') or 'mixed_Terra_Aqua_day_night_equal_weight',
            'hrc_reference':              hrc_reference,
            'hrc_reference_p75':          ref.get('hrc_reference_p75'),
            'hrc_reference_p95':          ref.get('hrc_reference_p95'),
            'pa_centroid_count':          ref.get('pa_centroid_count'),
            'reference_filter':           ref.get('reference_filter'),
            'reference_confidence':       ref.get('reference_confidence'),
            'reference_method':           ref.get('reference_method'),
            'restoration_gap':            restoration_gap,
            # Historical, ceiling, trend not computed for v2.1 showcase regions
            'hrc_historical_reference':   None,
            'historical_change':          None,
            'restoration_gap_historical': None,
            'historical_confidence':      None,
            'historical_method_version':  None,
            'historical_window':          None,
            'hrc_ceiling_reference':      None,
            'restoration_gap_ceiling':    None,
            'trend_score_60m':            None,
        }

        batch.append(insert_data)

        if len(batch) >= BATCH_SIZE:
            flush_batch()
            print(f'  {inserted + skipped}/{len(tiles)} '
                  f'({inserted} inserted, {skipped} failed, '
                  f'{no_ref_used_fallback} fell back to flux-tower ref)')

    # Final flush for any leftover rows
    flush_batch()
    print(f'  Done: {inserted} inserted, {skipped} failed, '
          f'{no_ref_used_fallback} tiles used flux-tower fallback')
    if warnings:
        print(f'  {len(warnings)} out-of-range warnings (first 5):')
        for w in warnings[:5]:
            print(w)
    if skipped > len(tiles) * 0.1:
        print(f'  WARNING: >10% of inserts failed — check DB column names or permissions.')
    return inserted, skipped

# ── Run all pairs ────────────────────────────────────────────────────
total_inserted = total_skipped = 0
for tiles_path, ref_path, slug in pairs:
    i, s = process_region(tiles_path, ref_path, slug)
    total_inserted += i
    total_skipped += s

if len(pairs) > 1:
    print(f'\n── ALL REGIONS ──────────────────────────────')
    print(f'  {total_inserted} tiles inserted across {len(pairs)} regions')
    print(f'  {total_skipped} failed inserts')

print('\nNext step:')
print('  Run the satellite-vs-tower acceptance gate:')
print('    python3 scripts/validate_satellite_vs_tower.py')
