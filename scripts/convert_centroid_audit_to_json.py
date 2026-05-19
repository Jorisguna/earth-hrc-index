"""
convert_centroid_audit_to_json.py

Convert the script 38 audit CSV (per-centroid trust-filter trail) into a
JSON file the web app loads as a Deck.gl ScatterplotLayer overlay.

The output is a minimal JSON list (no wrapping object) so the app's loader
stays trivial. Each entry has the seven fields the overlay reads:
  longitude, latitude, pa_name, iucn_cat, ecoregion_id, keep, reject_reason

Numeric provenance fields (albedo, ef, hrc_v2_1_1, lc_type1) are also
carried so the hover tooltip can show them.

Usage:
    python3 scripts/convert_centroid_audit_to_json.py \\
        ~/Downloads/hrc_albedo_centroid_audit_idf_v2_2.csv

Writes to public/idf_reference_centroids.json (overwrites). Restart the
dev server (or wait for HMR) for the change to load.
"""
import csv
import json
import os
import sys


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(REPO_ROOT, 'public', 'idf_reference_centroids.json')


def parse_float(v):
    if v in ('', 'null', None):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def parse_int(v):
    f = parse_float(v)
    return int(f) if f is not None else None


def main():
    if len(sys.argv) != 2:
        raise SystemExit(
            'Usage: python3 scripts/convert_centroid_audit_to_json.py '
            '<audit_csv_path>'
        )
    csv_path = os.path.expanduser(sys.argv[1])
    if not os.path.exists(csv_path):
        raise SystemExit(f'Audit CSV not found: {csv_path}')

    rows = []
    with open(csv_path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            lon = parse_float(row.get('longitude'))
            lat = parse_float(row.get('latitude'))
            if lon is None or lat is None:
                continue
            rows.append({
                'longitude':            lon,
                'latitude':             lat,
                'pa_name':              (row.get('pa_name') or '').strip() or None,
                'iucn_cat':             (row.get('iucn_cat') or '').strip() or None,
                'albedo':               parse_float(row.get('albedo')),
                'ef':                   parse_float(row.get('ef')),
                'hrc_v2_1_1':           parse_float(row.get('hrc_v2_1_1')),
                'lc_type1':             parse_int(row.get('lc_type1')),
                'wetland_buffer_frac':  parse_float(row.get('wetland_buffer_frac')),
                'cropland_buffer_frac': parse_float(row.get('cropland_buffer_frac')),
                'ecoregion_id':         parse_int(row.get('ecoregion_id')),
                'ecoregion_name':       (row.get('ecoregion_name') or '').strip() or None,
                'keep':                 (row.get('keep') or '').strip().lower() == 'true',
                'reject_reason':        (row.get('reject_reason') or '').strip() or None,
            })

    kept    = sum(1 for r in rows if r['keep'])
    rejected = len(rows) - kept

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w') as f:
        json.dump(rows, f, indent=2)

    print(f'Wrote {len(rows)} centroids ({kept} kept, {rejected} rejected) to')
    print(f'  {OUT_PATH}')
    print('Restart the dev server (or wait for HMR) to see them in the app.')


if __name__ == '__main__':
    main()
