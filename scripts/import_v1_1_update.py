"""
import_v1_1_update.py
Updates hrc_score, trend_score, trend_score_60m, ecoregion_name, biome_name
for existing tiles in Supabase using a v1.1 GEE CSV export.

Uses UPDATE (matched by longitude/latitude) — does NOT truncate the table,
so historical baseline and ceiling reference data is preserved.

Usage:
  python3 scripts/import_v1_1_update.py <path_to_csv>

Example:
  python3 scripts/import_v1_1_update.py ~/Downloads/HRC_Wales_v1_1.csv
  python3 scripts/import_v1_1_update.py ~/Downloads/HRC_SFBay_v1_1.csv
"""
import os, sys, csv
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

url = os.environ.get('SUPABASE_URL') or os.environ.get('VITE_SUPABASE_URL')
key = os.environ.get('SUPABASE_ANON_KEY') or os.environ.get('VITE_SUPABASE_ANON_KEY')

if not url or not key:
    raise SystemExit('Missing SUPABASE_URL / SUPABASE_ANON_KEY in .env')

sb = create_client(url, key)

if len(sys.argv) != 2:
    raise SystemExit('Usage: python3 scripts/import_v1_1_update.py <csv_path>')

csv_path = sys.argv[1]
if not os.path.exists(csv_path):
    raise SystemExit(f'File not found: {csv_path}')

updated = 0
skipped = 0
warnings = []

with open(csv_path) as f:
    reader = csv.DictReader(f)
    rows = list(reader)

print(f'Processing {len(rows)} rows from {csv_path}...')

for row in rows:
    lon = float(row['longitude'])
    lat = float(row['latitude'])
    hrc = float(row['hrc_score']) if row.get('hrc_score') else None

    if hrc is not None and not (0 <= hrc <= 10):
        warnings.append(f'  Out-of-range hrc_score {hrc:.3f} at ({lon:.5f}, {lat:.5f})')

    update_data = {
        'hrc_score':         hrc,
        'trend_score':       float(row['trend_score'])    if row.get('trend_score')    else None,
        'trend_score_60m':   float(row['trend_score_60m']) if row.get('trend_score_60m') else None,
        'ecoregion_name':    row.get('ecoregion_name') or None,
        'biome_name':        row.get('biome_name')     or None,
        'methodology_version': 'v1.1',
        'hrc_window_start':  '2025-04-01',
        'hrc_window_end':    '2026-03-31',
        'batch_id':          '2026-Q2',
    }

    # Match by rounded coordinates (5 decimal places)
    result = (
        sb.table('hrc_tiles')
          .update(update_data)
          .filter('longitude', 'gte', lon - 0.000005)
          .filter('longitude', 'lte', lon + 0.000005)
          .filter('latitude',  'gte', lat - 0.000005)
          .filter('latitude',  'lte', lat + 0.000005)
          .execute()
    )

    if result.data:
        updated += 1
    else:
        skipped += 1

    if (updated + skipped) % 50 == 0:
        print(f'  {updated + skipped}/{len(rows)} processed ({updated} updated, {skipped} no match)')

print(f'\nDone. {updated} tiles updated, {skipped} had no matching tile in DB.')

if warnings:
    print(f'\n{len(warnings)} warnings:')
    for w in warnings[:10]:
        print(w)
    if len(warnings) > 10:
        print(f'  ... and {len(warnings) - 10} more')

if skipped > 0:
    print(f'\nNOTE: {skipped} rows had no coordinate match. This can happen if the GEE')
    print('sample grid shifted slightly. The unmatched rows were not inserted.')
