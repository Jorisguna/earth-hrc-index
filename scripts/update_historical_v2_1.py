#!/usr/bin/env python3
"""
update_historical_v2_1.py
Generate UPDATE SQL from a v2.1 historical baseline CSV (GEE export).

Usage — single file:
  python3 scripts/update_historical_v2_1.py path/to/hrc_historical_v2_1_wales.csv

Usage — all three regions in one folder:
  python3 scripts/update_historical_v2_1.py ~/Downloads/

What it does:
  1. Reads the CSV exported from Google Earth Engine (script 10/12/13)
  2. Generates SQL UPDATE statements matching tiles by lat/lon at 5dp
  3. Sets hrc_historical_reference, historical_method_version='v2.1',
     historical_window='2001-01-01/2011-01-01', and historical_confidence
     per region.
  4. Writes scripts/<region>_historical_update_v2_1.sql

After running this, run the SQL files in Supabase, then run
scripts/compute_historical_change_v2_1.sql to derive the gap and
signed-change columns.
"""
import csv, sys, glob, os
from pathlib import Path

# Per-region confidence per methodology doc §3.7
CONFIDENCE_MAP = {
    'wales': 'medium',
    'sfbay': 'medium',
    'la':    'medium-low',
}

def parse_csv(csv_path):
    rows = []
    with open(csv_path, newline='', encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            try:
                lon = float(row['longitude'])
                lat = float(row['latitude'])
                val = row['hrc_historical_reference'].strip()
                if val in ('', 'null', 'None'):
                    continue
                rows.append((lon, lat, float(val)))
            except (KeyError, ValueError) as e:
                print(f'  Skipping row (parse error: {e}): {row}')
                continue
    return rows

def csv_to_sql(csv_path):
    csv_path = Path(csv_path)
    region = csv_path.stem.replace('hrc_historical_v2_1_', '')
    if region not in CONFIDENCE_MAP:
        print(f'  WARNING: unknown region "{region}", defaulting confidence to "medium"')
    confidence = CONFIDENCE_MAP.get(region, 'medium')

    rows = parse_csv(csv_path)
    if not rows:
        print(f'  No valid rows in {csv_path.name}')
        return None

    output = Path(__file__).parent / f'{region}_historical_update_v2_1.sql'

    lines = [
        f'-- {region}_historical_update_v2_1.sql',
        f'-- Generated from {csv_path.name}',
        f'-- Methodology: v2.1 (annual ratio-of-sums, 2001–2010, full annual cycle)',
        f'-- Match convention: longitude + latitude rounded to 5 decimal places',
        f'-- Confidence: {confidence}',
        f'-- {len(rows)} rows',
        '',
        'BEGIN;',
        '',
    ]

    for lon, lat, val in rows:
        lines.append(
            f'UPDATE hrc_tiles SET hrc_historical_reference = {val}, '
            f"historical_method_version = 'v2.1', "
            f"historical_window = '2001-01-01/2011-01-01', "
            f"historical_confidence = '{confidence}' "
            f'WHERE ROUND(longitude::numeric, 5) = ROUND({lon}::numeric, 5) '
            f'AND ROUND(latitude::numeric, 5) = ROUND({lat}::numeric, 5);'
        )

    lines += ['', 'COMMIT;', '']
    output.write_text('\n'.join(lines))
    print(f'  Wrote {output} ({len(rows)} UPDATE statements, confidence={confidence})')
    return output

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    arg = os.path.expanduser(sys.argv[1])

    if os.path.isdir(arg):
        # Directory mode — find all hrc_historical_v2_1_*.csv
        csvs = sorted(glob.glob(os.path.join(arg, 'hrc_historical_v2_1_*.csv')))
        if not csvs:
            print(f'No hrc_historical_v2_1_*.csv files in {arg}')
            sys.exit(1)
        print(f'Found {len(csvs)} CSV file(s)')
        for csv_path in csvs:
            print(f'\nProcessing: {csv_path}')
            csv_to_sql(csv_path)
    else:
        if not os.path.exists(arg):
            print(f'File not found: {arg}')
            sys.exit(1)
        print(f'Processing: {arg}')
        csv_to_sql(arg)

    print('\nNext steps:')
    print('  1. Open Supabase SQL Editor')
    print('  2. Run each <region>_historical_update_v2_1.sql in order')
    print('  3. Run scripts/compute_historical_change_v2_1.sql')
    print('  4. Run the verification queries from docs/historical_v2_1_implementation_plan.md §3.7')

if __name__ == '__main__':
    main()
