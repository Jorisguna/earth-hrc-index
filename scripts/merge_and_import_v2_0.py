"""
merge_and_import_v2_0.py
HRC v2.0 — Merge tile CSV + reference CSV, compute restoration gaps,
then UPDATE existing Supabase tiles in-place.

What it does:
  1. Loads tile CSVs (from GEE scripts 25/26/27) and reference CSVs
     (from GEE scripts 28/29/30), matched by region name.
  2. Joins reference columns onto tiles by ecoregion_name.
  3. Computes restoration_gap = max(hrc_reference - hrc_score, 0).
  4. Drops reference rows where pa_centroid_count < 10 (insufficient).
  5. UPDATEs matching hrc_tiles rows by lon/lat coordinate match.
     Preserves hrc_historical_baseline and hrc_ceiling_reference.

Usage — single pair:
  python3 scripts/merge_and_import_v2_0.py <tiles_csv> <reference_csv>

Usage — whole directory (auto-pairs by region name):
  python3 scripts/merge_and_import_v2_0.py ~/Downloads/EarthHRC/

  Auto-pairing rule: for every file matching tiles_*_v2_0.csv it looks
  for a matching hrc_reference_*_v2_0.csv with the same region slug.
  e.g. tiles_wales_v2_0.csv  →  hrc_reference_wales_v2_0.csv
       tiles_la_v2_0.csv     →  hrc_reference_la_v2_0.csv

  Just download all six GEE exports into one folder and run one command.

Reference confidence thresholds:
  >= 50  → high
  20–49  → moderate
  10–19  → low
  < 10   → null reference (tile gets hrc_reference = NULL)
"""
import os, sys, csv, math, glob
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

if len(sys.argv) == 2 and os.path.isdir(sys.argv[1]):
    # Directory mode: auto-pair tiles_*_v2_0.csv with hrc_reference_*_v2_0.csv
    folder = os.path.expanduser(sys.argv[1])
    tile_files = sorted(glob.glob(os.path.join(folder, 'tiles_*_v2_0.csv')))
    if not tile_files:
        raise SystemExit(f'No tiles_*_v2_0.csv files found in {folder}')
    pairs = []
    for tf in tile_files:
        # Extract region slug: tiles_wales_v2_0.csv → wales
        basename = os.path.basename(tf)
        slug = basename.replace('tiles_', '').replace('_v2_0.csv', '')
        rf = os.path.join(folder, f'hrc_reference_{slug}_v2_0.csv')
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
    slug = os.path.basename(tiles_path).replace('tiles_', '').replace('_v2_0.csv', '')
    pairs = [(tiles_path, ref_path, slug)]
else:
    raise SystemExit(
        'Usage:\n'
        '  python3 scripts/merge_and_import_v2_0.py ~/Downloads/EarthHRC/\n'
        '  python3 scripts/merge_and_import_v2_0.py <tiles_csv> <reference_csv>'
    )

# ── Helpers ──────────────────────────────────────────────────
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

def load_reference(ref_path):
    ref = {}
    with open(ref_path) as f:
        for row in csv.DictReader(f):
            n = parse_int(row.get('pa_centroid_count', '0')) or 0
            eco = row.get('ecoregion_name', '').strip()
            if not eco:
                continue
            if n < 10:
                print(f'  [skip ref] {eco}: pa_centroid_count={n} < 10')
                continue
            hrc_ref = parse_float(row.get('hrc_reference'))
            if hrc_ref is None:
                print(f'  [skip ref] {eco}: hrc_reference is null')
                continue
            confidence = 'high' if n >= 50 else 'moderate' if n >= 20 else 'low'
            ref[eco] = {
                'hrc_reference':        hrc_ref,
                'hrc_reference_p75':    parse_float(row.get('hrc_reference_p75')),
                'hrc_reference_p95':    parse_float(row.get('hrc_reference_p95')),
                'pa_centroid_count':    n,
                'reference_filter':     row.get('reference_filter', 'IUCN_I-IV').strip(),
                'reference_confidence': confidence,
            }
    return ref

def process_region(tiles_path, ref_path, slug):
    print(f'\n── {slug.upper()} ──────────────────────────────')
    ref_by_eco = load_reference(ref_path)
    print(f'Loaded {len(ref_by_eco)} ecoregion references')

    with open(tiles_path) as f:
        tiles = list(csv.DictReader(f))
    print(f'Processing {len(tiles)} tiles...')

    updated = skipped = no_ref = 0
    warnings = []

    for row in tiles:
        lon = parse_float(row.get('longitude'))
        lat = parse_float(row.get('latitude'))
        if lon is None or lat is None:
            skipped += 1
            continue

        hrc_score = parse_float(row.get('HRC_score') or row.get('hrc_score'))
        if hrc_score is not None and not (0 <= hrc_score <= 10):
            warnings.append(f'  Out-of-range {hrc_score:.3f} at ({lon:.5f}, {lat:.5f})')

        eco_name = (row.get('ecoregion_name') or '').strip() or None
        ref = ref_by_eco.get(eco_name) if eco_name else None
        if ref is None and eco_name:
            no_ref += 1

        hrc_reference = ref['hrc_reference'] if ref else None
        restoration_gap = None
        if hrc_score is not None and hrc_reference is not None:
            restoration_gap = round(max(hrc_reference - hrc_score, 0.0), 4)

        insert_data = {
            'longitude':            lon,
            'latitude':             lat,
            'hrc_score':            round(hrc_score, 4) if hrc_score is not None else None,
            'ecoregion_name':       eco_name,
            'biome_name':           row.get('biome_name') or None,
            'methodology_version':  'v2.0',
            'hrc_formula':          row.get('hrc_formula') or 'ratio_of_annual_sums_v2.0',
            'computation_window':   row.get('computation_window') or '2025-01-01/2026-01-01',
            'hrc_window_start':     '2025-01-01',
            'hrc_window_end':       '2026-01-01',
            'confidence_tier':      row.get('confidence_tier') or 'C',
            'batch_id':             '2026-Q2-v2',
            'hrc_reference':        hrc_reference,
            'hrc_reference_p75':    ref['hrc_reference_p75']    if ref else None,
            'hrc_reference_p95':    ref['hrc_reference_p95']    if ref else None,
            'pa_centroid_count':    ref['pa_centroid_count']    if ref else None,
            'reference_filter':     ref['reference_filter']     if ref else None,
            'reference_confidence': ref['reference_confidence'] if ref else None,
            'restoration_gap':      restoration_gap,
        }

        result = (
            sb.table('hrc_tiles')
              .insert(insert_data)
              .execute()
        )

        if result.data:
            updated += 1
        else:
            skipped += 1

        total = updated + skipped
        if total % 50 == 0:
            print(f'  {total}/{len(tiles)} ({updated} updated, {skipped} no match, {no_ref} no ref)')

    print(f'  Done: {updated} updated, {skipped} no match, {no_ref} no reference')
    if warnings:
        print(f'  {len(warnings)} out-of-range warnings (first 5):')
        for w in warnings[:5]:
            print(w)
    if skipped > len(tiles) * 0.5:
        print(f'  WARNING: >50% failed to insert — check DB column names or permissions.')
    return updated, skipped

# ── Run all pairs ─────────────────────────────────────────────
total_updated = total_skipped = 0
for tiles_path, ref_path, slug in pairs:
    u, s = process_region(tiles_path, ref_path, slug)
    total_updated += u
    total_skipped += s

if len(pairs) > 1:
    print(f'\n── ALL REGIONS ──────────────────────────────')
    print(f'  {total_updated} tiles updated across {len(pairs)} regions')
    print(f'  {total_skipped} had no coordinate match')
