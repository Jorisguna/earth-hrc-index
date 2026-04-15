#!/usr/bin/env python3
"""
update_trend_scores.py
Earth HRC Index — update trend_score_60m in Supabase from GEE export CSVs.

Usage:
  python3 scripts/update_trend_scores.py path/to/HRC_Wales_Trend_60months.csv

What it does:
  1. Reads the CSV exported from Google Earth Engine
  2. Generates SQL UPDATE statements matching tiles by rounded coordinates
  3. Writes values into the trend_score_60m column (original trend_score preserved)
  4. Saves a .sql file you paste into the Supabase SQL Editor

Output file: scripts/update_trend_<filename>.sql
"""

import csv
import sys
from pathlib import Path

def csv_to_sql(csv_path: str) -> str:
    csv_path = Path(csv_path)
    if not csv_path.exists():
        print(f"Error: file not found: {csv_path}")
        sys.exit(1)

    region_label = csv_path.stem
    output_path = Path(__file__).parent / f"update_trend_{region_label}.sql"

    rows = []
    with open(csv_path, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                lon   = float(row['longitude'])
                lat   = float(row['latitude'])
                trend = row['trend_score'].strip()

                if trend in ('', 'null', 'NULL', 'None'):
                    continue
                trend_val = float(trend)
                rows.append((lon, lat, trend_val))
            except (KeyError, ValueError) as e:
                print(f"Skipping row (parse error: {e}): {row}")
                continue

    if not rows:
        print("No valid rows found in CSV. Check the file and column names.")
        sys.exit(1)

    print(f"  Parsed {len(rows)} rows from {csv_path.name}")

    lines = [
        "-- ============================================================",
        f"-- HRC Index — update trend_score_60m from: {csv_path.name}",
        f"-- 60-month deseasonalised trend (June 2018 – May 2023)",
        f"-- Original trend_score (24-month) is preserved unchanged",
        f"-- Tiles matched by coordinates rounded to 4 decimal places",
        "-- Paste this entire block into Supabase SQL Editor and click Run",
        "-- ============================================================",
        "",
        "BEGIN;",
        "",
    ]

    for lon, lat, trend in rows:
        lon_r = round(lon, 4)
        lat_r = round(lat, 4)
        lines.append(
            f"UPDATE hrc_tiles"
            f" SET trend_score_60m = {trend}"
            f" WHERE ROUND(longitude::numeric, 4) = {lon_r}"
            f" AND ROUND(latitude::numeric, 4) = {lat_r};"
        )

    lines += [
        "",
        "COMMIT;",
        "",
        f"-- {len(rows)} UPDATE statements generated",
        f"-- After running, verify with:",
        f"-- SELECT COUNT(*), AVG(trend_score), AVG(trend_score_60m)",
        f"-- FROM hrc_tiles;",
    ]

    output_path.write_text("\n".join(lines), encoding='utf-8')
    print(f"  SQL file written: {output_path}")
    return str(output_path)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        print("\nError: please provide the path to the CSV file.")
        print("Example: python3 scripts/update_trend_scores.py ~/Downloads/HRC_Wales_Trend_60months.csv")
        sys.exit(1)

    csv_path = sys.argv[1]
    print(f"\nProcessing: {csv_path}")
    output = csv_to_sql(csv_path)

    print(f"\nDone. Next steps:")
    print(f"  1. Open your Supabase dashboard: https://supabase.com/dashboard")
    print(f"  2. Select project earth-hrc-index → SQL Editor")
    print(f"  3. Open {output}, copy all, paste into SQL Editor, click Run")
    print(f"  4. You should see 'Success. X rows affected'")


if __name__ == '__main__':
    main()
