#!/usr/bin/env python3
"""
validate_latent_heat_flux.py — Acceptance gate for the absolute latent
heat flux magnitude diagnostic (v1.0 of the HRC magnitude companion field).

Reads from Supabase via REST and confirms the post-import database matches
the predicted values from HRC_absolute_latent_heat_flux_handoff_v1_0.md.

Acceptance criteria (hard pass-fail on tower pixels; soft on regional means):

  Fontainebleau-Barbeau (FR-Fon) tower pixel : 30 to 45 W/m²   [HARD]
  K67 tower pixel                            : 88 to 100 W/m²  [HARD]
  Île-de-France regional mean                : 20 to 40 W/m²   [SOFT]
  Tapajós regional mean                      : 60 to 90 W/m²   [SOFT]

Usage:
    python3 scripts/validate_latent_heat_flux.py

Reads SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY)
from the .env file in the current working directory or process environment.

Exit codes:
    0 — all hard gates pass
    1 — at least one hard gate fails
    2 — connectivity or schema error
"""

import os
import sys
import math
from pathlib import Path

import requests

# ─────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────

# Tower pixel coordinates from the v2.1.1 case studies
FR_FON_LON, FR_FON_LAT = 2.780, 48.476     # Fontainebleau-Barbeau (ICOS Class 1)
K67_LON,    K67_LAT    = -54.959, -2.857   # Tapajós K67 (AmeriFlux BR-Sa1)

# Acceptance ranges
FR_FON_RANGE  = (30.0, 45.0)
K67_RANGE     = (88.0, 100.0)
IDF_MEAN_RANGE     = (20.0, 40.0)
TAPAJOS_MEAN_RANGE = (60.0, 90.0)

# Pixel-match tolerance — the 500m grid sample point will be within
# this many degrees of the tower coordinates.
PIXEL_MATCH_DEG = 0.003  # ~330 metres at the equator, half a pixel at 48° latitude

# Filter for the v2.1.2 methodology version that this work stream produces.
# Pre-v2.1.2 tiles do not have the new field populated.
METHODOLOGY_FILTER = 'v2.1.2_higher_fidelity'


# ─────────────────────────────────────────────────────────────────────
# Environment plumbing
# ─────────────────────────────────────────────────────────────────────

def load_env_file():
    """Read .env into os.environ if it exists in the current directory."""
    env_path = Path('.env')
    if not env_path.exists():
        return
    with env_path.open() as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def get_supabase_credentials():
    load_env_file()
    url = os.environ.get('SUPABASE_URL') or os.environ.get('VITE_SUPABASE_URL')
    key = (os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
           or os.environ.get('SUPABASE_SERVICE_KEY')
           or os.environ.get('SUPABASE_ANON_KEY')
           or os.environ.get('VITE_SUPABASE_ANON_KEY'))
    if not url or not key:
        print('ERROR: SUPABASE_URL and SUPABASE_ANON_KEY (or SERVICE_ROLE) '
              'must be set in .env or environment.', file=sys.stderr)
        sys.exit(2)
    return url.rstrip('/'), key


# ─────────────────────────────────────────────────────────────────────
# Database queries
# ─────────────────────────────────────────────────────────────────────

def query_tiles(url, key, params):
    """Hit Supabase REST and return parsed JSON, or exit on failure."""
    endpoint = f'{url}/rest/v1/hrc_tiles'
    headers = {
        'apikey': key,
        'Authorization': f'Bearer {key}',
        'Accept': 'application/json',
    }
    response = requests.get(endpoint, headers=headers, params=params, timeout=30)
    if response.status_code != 200:
        print(f'ERROR: Supabase returned {response.status_code}: {response.text}',
              file=sys.stderr)
        sys.exit(2)
    return response.json()


def nearest_tile_to_point(url, key, lon, lat, region_code):
    """
    Pull all v2.1.2 tiles in a small bounding box around the target point
    and return the one with the smallest Euclidean distance in degrees.
    """
    rows = query_tiles(url, key, {
        'select': 'longitude,latitude,latent_heat_flux_annual_wm2,hrc_score',
        'region_code': f'eq.{region_code}',
        'methodology_version': f'eq.{METHODOLOGY_FILTER}',
        'longitude': f'gte.{lon - PIXEL_MATCH_DEG}',
        'latitude': f'gte.{lat - PIXEL_MATCH_DEG}',
        'limit': '500',
    })
    # Server-side filter only handled two of four bounds; finish in Python.
    candidates = [r for r in rows
                  if r['longitude'] <= lon + PIXEL_MATCH_DEG
                  and r['latitude'] <= lat + PIXEL_MATCH_DEG]
    if not candidates:
        return None
    return min(candidates,
               key=lambda r: math.hypot(r['longitude'] - lon, r['latitude'] - lat))


def regional_stats(url, key, region_code):
    """
    Pull every v2.1.2 tile for the region and compute min, mean, max.
    """
    rows = query_tiles(url, key, {
        'select': 'latent_heat_flux_annual_wm2',
        'region_code': f'eq.{region_code}',
        'methodology_version': f'eq.{METHODOLOGY_FILTER}',
        'latent_heat_flux_annual_wm2': 'not.is.null',
        'limit': '100000',
    })
    values = [r['latent_heat_flux_annual_wm2'] for r in rows
              if r['latent_heat_flux_annual_wm2'] is not None]
    if not values:
        return None
    return {
        'count': len(values),
        'min':   min(values),
        'mean':  sum(values) / len(values),
        'max':   max(values),
    }


# ─────────────────────────────────────────────────────────────────────
# Reporting
# ─────────────────────────────────────────────────────────────────────

def check_range(label, value, value_range, hard=True):
    lo, hi = value_range
    if value is None:
        print(f'  [SKIP] {label}: no value returned')
        return None
    in_range = lo <= value <= hi
    status = 'PASS' if in_range else ('FAIL' if hard else 'WARN')
    print(f'  [{status}] {label}: {value:.2f} W/m²  (gate: {lo:.0f}–{hi:.0f})')
    return in_range if hard else True


def main():
    print('Heat Regulation Capacity — Absolute Latent Heat Flux Validation')
    print('=' * 70)
    url, key = get_supabase_credentials()

    print(f'\nUsing methodology filter: {METHODOLOGY_FILTER}')
    print('\n[1/2] Tower pixel acceptance gates (HARD)')
    print('-' * 70)

    fr_fon = nearest_tile_to_point(url, key, FR_FON_LON, FR_FON_LAT, 'idf')
    k67    = nearest_tile_to_point(url, key, K67_LON, K67_LAT, 'tapajos')

    fr_fon_value = fr_fon['latent_heat_flux_annual_wm2'] if fr_fon else None
    k67_value    = k67['latent_heat_flux_annual_wm2']    if k67    else None

    pass_fr_fon = check_range('Fontainebleau-Barbeau pixel', fr_fon_value,
                              FR_FON_RANGE, hard=True)
    pass_k67    = check_range('K67 Tapajós pixel',           k67_value,
                              K67_RANGE,    hard=True)

    if fr_fon:
        print(f'         matched tile at lon={fr_fon["longitude"]:.4f}, '
              f'lat={fr_fon["latitude"]:.4f}; '
              f'Heat Regulation Capacity={fr_fon["hrc_score"]:.2f}')
    if k67:
        print(f'         matched tile at lon={k67["longitude"]:.4f}, '
              f'lat={k67["latitude"]:.4f}; '
              f'Heat Regulation Capacity={k67["hrc_score"]:.2f}')

    print('\n[2/2] Regional mean checks (SOFT)')
    print('-' * 70)

    idf_stats     = regional_stats(url, key, 'idf')
    tapajos_stats = regional_stats(url, key, 'tapajos')

    if idf_stats:
        check_range(f'Île-de-France regional mean (n={idf_stats["count"]})',
                    idf_stats['mean'], IDF_MEAN_RANGE, hard=False)
        print(f'         range: {idf_stats["min"]:.2f} – {idf_stats["max"]:.2f} W/m²')
    else:
        print('  [SKIP] Île-de-France regional mean: no tiles found')

    if tapajos_stats:
        check_range(f'Tapajós regional mean (n={tapajos_stats["count"]})',
                    tapajos_stats['mean'], TAPAJOS_MEAN_RANGE, hard=False)
        print(f'         range: {tapajos_stats["min"]:.2f} – {tapajos_stats["max"]:.2f} W/m²')
    else:
        print('  [SKIP] Tapajós regional mean: no tiles found')

    print('\n' + '=' * 70)
    if pass_fr_fon and pass_k67:
        print('ACCEPTANCE GATE: PASS')
        sys.exit(0)
    else:
        print('ACCEPTANCE GATE: FAIL — investigate before flagging as methodology issue.')
        print('See HRC_absolute_latent_heat_flux_handoff_v1_0.md, "Acceptance gate" section.')
        sys.exit(1)


if __name__ == '__main__':
    main()
