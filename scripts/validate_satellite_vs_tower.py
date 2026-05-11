"""
validate_satellite_vs_tower.py — v2.1.1 acceptance gate.

Compares the satellite-derived HRC at the FR-Fon and K67 flux-tower pixel
coordinates against the MATCHED-METHODOLOGY tower references (not the
operational references — see methodology paper v2.1.1 §7.1 and §7.7).

Two modes:
  - FR-Fon: pass-fail acceptance gate within ±0.5 of 6.18
  - K67:    calibration measurement of MOD11A1 cold bias in dense humid
            tropical evergreen forest. Documented finding per §7.8.
            Expected within ±2.0 of 7.65; not a pass-fail gate.

Run AFTER merge_and_import_v2_1_higher_fidelity.py has imported the
v2.1.1 tiles into Supabase.

Exit codes:
  0 — FR-Fon gate passed
  1 — FR-Fon gate failed
  2 — pipeline incomplete (no tiles found at FR-Fon)
"""
import os
import sys
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

url = os.environ.get('SUPABASE_URL') or os.environ.get('VITE_SUPABASE_URL')
key = (os.environ.get('SUPABASE_SERVICE_KEY')
    or os.environ.get('SUPABASE_ANON_KEY')
    or os.environ.get('VITE_SUPABASE_ANON_KEY'))

if not url or not key:
    raise SystemExit('Missing SUPABASE_URL / SUPABASE_KEY in .env')

sb = create_client(url, key)

# Matched-methodology references locked in methodology paper v2.1.1 §7.7.
# Operational references (5.04 FR-Fon, 7.89 K67) are partner-facing only;
# they used a strict-mask + closure-corrected computation that measures
# a different quantity from the pipeline's all-hour ratio-of-annual-sums.
TOWERS = [
    {
        'name':        'FR-Fon',
        'region_code': 'idf',
        'lat':         48.476,
        'lon':         2.780,
        'reference':   6.18,
        'tolerance':   0.5,
        'mode':        'gate',
        'note':        'matched-methodology reference; pass-fail acceptance gate',
    },
    {
        'name':        'K67',
        'region_code': 'tapajos',
        'lat':         -2.857,
        'lon':         -54.959,
        'reference':   7.65,
        'tolerance':   2.0,
        'mode':        'calibration',
        'note':        'MOD11A1 cold-bias range in dense humid tropical evergreen forest (per §7.8)',
    },
]

METHODOLOGY_VERSION = 'v2.1.1_higher_fidelity'
MATCH_RADIUS_DEG = 0.003  # ~333 m at the equator, half a 500 m hex


def find_nearest_tile(tower):
    """Find the v2.1.1 tile containing the tower coordinates."""
    lat, lon = tower['lat'], tower['lon']
    response = (
        sb.table('hrc_tiles')
          .select('latitude, longitude, hrc_score, hrc_raw_ratio, '
                  'ecoregion_name, reference_method, region_code, '
                  'methodology_version, lst_source')
          .eq('data_resolution_m', 500)
          .eq('region_code', tower['region_code'])
          .eq('methodology_version', METHODOLOGY_VERSION)
          .gte('latitude',  lat - MATCH_RADIUS_DEG)
          .lte('latitude',  lat + MATCH_RADIUS_DEG)
          .gte('longitude', lon - MATCH_RADIUS_DEG)
          .lte('longitude', lon + MATCH_RADIUS_DEG)
          .execute()
    )
    rows = response.data
    if not rows:
        return None
    return min(rows, key=lambda r:
               (r['latitude'] - lat) ** 2 + (r['longitude'] - lon) ** 2)


def main():
    print('=' * 70)
    print('v2.1.1 Higher-Fidelity Acceptance Gate')
    print('Satellite HRC vs matched-methodology tower reference')
    print(f'Methodology version filter: {METHODOLOGY_VERSION}')
    print('=' * 70)

    gate_failures = []
    no_data = []

    for tower in TOWERS:
        print(f'\n{tower["name"]} ({tower["region_code"]}, mode={tower["mode"]}):')
        print(f'  Coordinates:           ({tower["lat"]:.4f}°N, {tower["lon"]:.4f}°E)')
        print(f'  Matched-method ref:    {tower["reference"]}')
        print(f'  Tolerance:             ±{tower["tolerance"]}')
        print(f'  Note:                  {tower["note"]}')

        tile = find_nearest_tile(tower)
        if tile is None:
            print(f'  Result:                NO TILE FOUND — pipeline incomplete')
            no_data.append(tower['name'])
            continue

        observed = tile['hrc_score']
        diff = observed - tower['reference']
        within_tol = abs(diff) <= tower['tolerance']

        if tower['mode'] == 'gate':
            status = 'PASS' if within_tol else 'FAIL'
        else:
            status = ('WITHIN_DOCUMENTED_BIOME_LIMITATION'
                      if within_tol else 'OUT_OF_EXPECTED_RANGE')

        print(f'  Tile location:         ({tile["latitude"]:.5f}°N, {tile["longitude"]:.5f}°E)')
        print(f'  Tile ecoregion:        {tile.get("ecoregion_name") or "(none)"}')
        print(f'  Reference method:      {tile.get("reference_method") or "(none)"}')
        print(f'  LST source:            {tile.get("lst_source") or "(none)"}')
        print(f'  Satellite HRC:         {observed:.3f}  (diff {diff:+.3f})')
        if tile.get('hrc_raw_ratio') is not None:
            print(f'  Unclipped ratio:       {tile["hrc_raw_ratio"]:.3f}'
                  + ('  (energy-balance closure violation)'
                     if tile['hrc_raw_ratio'] > 10 else ''))
        print(f'  Status:                {status}')

        if tower['mode'] == 'gate' and not within_tol:
            gate_failures.append(tower['name'])

    print()
    print('=' * 70)
    if no_data:
        print(f'GATE INCOMPLETE — no v2.1.1 tiles found at: {", ".join(no_data)}')
        print('Run merge_and_import_v2_1_higher_fidelity.py first.')
        if 'FR-Fon' in no_data:
            sys.exit(2)
    if gate_failures:
        print(f'GATE FAILED at: {", ".join(gate_failures)}')
        print()
        print('Troubleshooting (per handoff §3):')
        print('  1. Verify LST day/night equal-weight aggregation is applied')
        print('     (scripts 31_v2_1_1 and 32_v2_1_1, not the pre-fix 31/32).')
        print('  2. Confirm Terra + Aqua + day + night MOD11A1 sampling.')
        print('  3. Compute σ × ε × T^4 per scene then time-average; never')
        print('     average T then raise to 4.')
        print('  4. Confirm time window is calendar year 2023 across all components.')
        print('  5. If still failing — escalate. Methodology paper may need revision.')
        sys.exit(1)

    print('FR-Fon ACCEPTANCE GATE PASSED.')
    print('K67 reading is a calibration measurement within the documented')
    print('MOD11A1 cold-bias range for dense humid tropical evergreen forest.')
    print('Proceed to Phase 3 (app updates).')
    sys.exit(0)


if __name__ == '__main__':
    main()
