#!/usr/bin/env python3
"""
insert_new_tiles.py
Earth HRC Index — insert new region tiles from GEE export CSVs.

Usage:
  python3 scripts/insert_new_tiles.py path/to/HRC_Assam_Tiles.csv
  python3 scripts/insert_new_tiles.py path/to/HRC_SFBay_Tiles.csv

What it does:
  1. Reads a CSV exported from Google Earth Engine
  2. Generates SQL INSERT statements for new hrc_tiles rows
  3. Uses ON CONFLICT DO NOTHING — safe to re-run without duplicates
  4. Saves a .sql file to paste into the Supabase SQL Editor

Columns populated from CSV:
  longitude, latitude, hrc_score, trend_score (24m), trend_score_60m,
  ecoregion_name, biome_name, confidence_tier (always 'C')

Columns left NULL (to be computed later):
  restoration_gap  — requires ecoregion reference calculation
  evaporative_fraction — derived from hrc_score / 10

Output file: scripts/insert_<filename>.sql
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
    output_path = Path(__file__).parent / f"insert_{region_label}.sql"

    rows = []
    with open(csv_path, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                lon           = float(row['longitude'])
                lat           = float(row['latitude'])
                hrc           = float(row['hrc_score'])
                trend_24      = row.get('trend_score', '').strip()
                trend_60      = row.get('trend_score_60m', '').strip()
                ecoregion     = row.get('ecoregion_name', '').strip()
                biome         = row.get('biome_name', '').strip()

                trend_24_val = float(trend_24) if trend_24 not in ('', 'null', 'NULL', 'None') else None
                trend_60_val = float(trend_60) if trend_60 not in ('', 'null', 'NULL', 'None') else None
                ecoregion_val = ecoregion if ecoregion not in ('', 'null', 'NULL', 'None') else None
                biome_val     = biome if biome not in ('', 'null', 'NULL', 'None') else None

                rows.append((lon, lat, hrc, trend_24_val, trend_60_val, ecoregion_val, biome_val))
            except (KeyError, ValueError) as e:
                print(f"Skipping row (parse error: {e}): {row}")
                continue

    if not rows:
        print("No valid rows found. Check file and column names.")
        sys.exit(1)

    print(f"  Parsed {len(rows)} rows from {csv_path.name}")

    def sql_val(v):
        if v is None:
            return 'NULL'
        if isinstance(v, str):
            return "'" + v.replace("'", "''") + "'"
        return str(v)

    lines = [
        "-- ============================================================",
        f"-- HRC Index — insert new tiles from: {csv_path.name}",
        f"-- Confidence tier: C (ERA5 reanalysis)",
        f"-- restoration_gap left NULL — compute separately once",
        f"--   ecoregion reference percentiles are known for these regions",
        f"-- ON CONFLICT DO NOTHING — safe to re-run",
        "-- Paste this entire block into Supabase SQL Editor and click Run",
        "-- ============================================================",
        "",
        "BEGIN;",
        "",
    ]

    for lon, lat, hrc, t24, t60, eco, biome in rows:
        ef = round(hrc / 10, 6)
        lines.append(
            f"INSERT INTO hrc_tiles "
            f"(longitude, latitude, hrc_score, trend_score, trend_score_60m, "
            f"ecoregion_name, biome_name, confidence_tier, evaporative_fraction) VALUES "
            f"({lon}, {lat}, {hrc}, {sql_val(t24)}, {sql_val(t60)}, "
            f"{sql_val(eco)}, {sql_val(biome)}, 'C', {ef}) "
            f"ON CONFLICT DO NOTHING;"
        )

    lines += [
        "",
        "COMMIT;",
        "",
        f"-- {len(rows)} INSERT statements generated",
        f"-- After running, verify with:",
        f"-- SELECT COUNT(*), AVG(hrc_score), AVG(trend_score_60m)",
        f"-- FROM hrc_tiles",
        f"-- WHERE ecoregion_name IS NOT NULL",
        f"-- ORDER BY latitude;",
        "",
        "-- NOTE: restoration_gap is NULL for these tiles.",
        "-- To populate it, compute the 90th percentile HRC of protected-area",
        "-- tiles per ecoregion and run an UPDATE pass.",
    ]

    output_path.write_text("\n".join(lines), encoding='utf-8')
    print(f"  SQL file written: {output_path}")
    return str(output_path)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        print("\nError: please provide the path to the CSV file.")
        print("Example: python3 scripts/insert_new_tiles.py ~/Downloads/HRC_Assam_Tiles.csv")
        sys.exit(1)

    csv_path = sys.argv[1]
    print(f"\nProcessing: {csv_path}")
    output = csv_to_sql(csv_path)

    print(f"\nDone. Next steps:")
    print(f"  1. Open your Supabase dashboard: https://supabase.com/dashboard")
    print(f"  2. Select project earth-hrc-index → SQL Editor")
    print(f"  3. Open {output}, copy all, paste into SQL Editor, click Run")
    print(f"  4. Verify row count with the SELECT at the bottom of the SQL file")
    print(f"  5. restoration_gap will be NULL — compute separately when ready")


if __name__ == '__main__':
    main()
