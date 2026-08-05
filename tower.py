"""
tower.py — Phase 1 tower-reference monthly evaporative fraction.
HRC 30 m US test sites (HRC_30m_test_sites_usa_implementation_plan_v1_0.md).

WHAT THIS IS
------------
The Phase 1 deliverable: the tower-measured MONTHLY evaporative fraction
that Phase 3 adjudicates the 30 m pipeline against (Gate P3, the D2
decision point). It generalizes test_c_frfon.py from the ICOS FLUXNET
column set (LE_F_MDS / LE_CORR / NETRAD) to the AmeriFlux BASE column set
(LE / H / NETRAD / G) — gap G8 in the implementation plan.

Two evaporative fractions per tower-month, matching the pipeline's two
target quantities:

    EF_rn_g      = sum(LE) / (sum(NETRAD) - sum(G))     # production denominator (D1)
    EF_turbulent = sum(LE) / (sum(LE) + sum(H))         # Formula 3 (Mead only, D-B)

Both are ratio-of-sums over ALL half-hours in the month (day + night, all
conditions) — the same all-hour aggregation the satellite pipeline does,
so the tower number is methodologically apples-to-apples with the 30 m
product. This is the deliberate choice test_c_frfon.py established: no
strict daytime/quality mask, because the satellite side has none either.

ANNUAL AGGREGATION = RATIO-OF-ANNUAL-SUMS (decision D-F)
-------------------------------------------------------
The HEADLINE annual reference is ratio-of-annual-sums over unmasked months:

    HRC = 10 × ( Σ_m sum(LE)_m ) / ( Σ_m [sum(NETRAD) − sum(G)]_m )

NOT mean-of-monthly-ratios. This matches the production score and the 500 m
ecoregion reference the 30 m tile sits beside (D-A), and it energy-weights
the months correctly. Mean-of-monthly-ratios over-weights low-energy months
and biases biomes in OPPOSITE directions (it inflated the anti-correlated
Mediterranean sites and deflated positively-correlated cropland in the
first Phase-1 pass — compressing the very contrast the index measures).
Mean-of-monthly-ratios is still printed, but only as a labelled SENSITIVITY.
See docs/HRC_scoring_conventions_source_of_truth.md (D-F).

ENERGY-BALANCE CLOSURE IS RECORDED, NOT CORRECTED
-------------------------------------------------
Per the project plan Phase 1 gate, closure is reported so Phase 3 can
reason about it — it is never silently applied. Closure ratio per month:

    closure = (sum(LE) + sum(H)) / (sum(NETRAD) - sum(G))

A value < 1 is the usual eddy-covariance non-closure. EF_rn_g inherits
that non-closure (it divides by available energy); EF_turbulent does not
(it divides by turbulent flux only). Reporting both lets Phase 3 see how
much of any tower-vs-satellite gap is closure asymmetry rather than
biology — exactly the diagnosis test_c_frfon.py was built to make.

INPUT — AmeriFlux BASE half-hourly CSV
--------------------------------------
Download per tower from https://ameriflux.lbl.gov (BASE-BADM product),
e.g. AMF_US-Ne1_BASE_HH_<ver>.csv. BASE files carry a variable number of
'#'-comment header lines followed by the TIMESTAMP_START header row; this
script finds that row dynamically, so no manual skiprows tuning. Missing
values are -9999. AmeriFlux variables can carry position qualifiers
(LE_1_1_1, G_1_1_1, ...); resolve_col() matches the base name or the
first qualified variant.

USAGE
-----
    python3 tower.py <base_hh_csv> --tower US-Ne1 [--year 2023]

--tower must be one of the ids in the TOWER manifest below (it supplies
the site_code and land-cover regime). --year defaults to 2023 to match
the pipeline radiation window. Output: tower_ef_<tower>.csv, one row per
calendar month (Jan–Dec), plus a console summary with the HEADLINE
ratio-of-annual-sums HRC (D-F) and the mean-of-ratios sensitivity.
"""
import argparse
import os
import re
import sys

import pandas as pd

# ── Tower manifest — mirror of feasibility.js SITES (single source of ──
# truth for site_code + regime). Keep in sync with scripts/feasibility.js.
TOWERS = {
    'US-Ne1': {'site_code': 'mead_ne',        'regime': 'irrigated_continuous_maize'},
    'US-Ne2': {'site_code': 'mead_ne',        'regime': 'irrigated_maize_soy_rotation'},
    'US-Ne3': {'site_code': 'mead_ne',        'regime': 'rainfed_maize_soy_rotation'},
    'US-Ton': {'site_code': 'tonzi_vaira_ca', 'regime': 'blue_oak_savanna'},
    'US-Var': {'site_code': 'tonzi_vaira_ca', 'regime': 'annual_c3_grassland'},
    'US-Me2': {'site_code': 'metolius_or',    'regime': 'mature_ponderosa_pine'},
}

# Full calendar year (decision D-D — annual composite, not growing-season).
# The tower has in-situ data every month regardless of cloud, so all 12 are
# computed; Phase 3 compares the pipeline's annual composite against the
# tower mean over the SAME unmasked-month subset (the pipeline masks winter
# months where clear Landsat = 0 or Rn is too low — feasibility.js §F3).
ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

# ── Uniform month-exclusion mask (decision D-G) ─────────────────────
# ONE rule, applied identically to every tower AND (in Phase 2) to the
# pipeline — NO per-tower exceptions. A month is excluded from the annual
# reference if ANY of:
#   - EF_rn_g outside [0 − EF_TOL, 1 + EF_TOL]: EF is bounded [0,1] by
#     definition; far outside is the low-Rn winter denominator blowing up
#     (e.g. US-Me2 January EF ≈ 17), not real.
#   - Monthly mean available energy (Rn − G) < RN_MIN_WM2: too little energy
#     to define a stable ratio regardless of the EF value.
#   - Valid-record coverage < COVERAGE_MIN: too little of the month measured.
#     A FRACTION (robust to HH vs HR files), applied uniformly — this
#     replaces the old per-tower absolute "sparse" count that produced
#     non-comparable references (US-Ne2 dropped Apr+May ad hoc).
# The mask deliberately does NOT use energy-balance closure: closure is
# RECORDED, not corrected (project plan Phase 1); a site can close poorly
# year-round yet have valid physical EF (US-Me2 ~0.5 closure all year is an
# R2 caveat, not a reason to drop months). It is a FLAG, never a silent
# drop — excluded months and reasons are listed. Borderline cases (near a
# threshold) are disclosed as sensitivities.
EF_TOL = 0.05          # tolerance on the [0,1] physical bound for noise
RN_MIN_WM2 = 25.0      # monthly-mean available energy floor (W/m2)
COVERAGE_MIN = 0.50    # min fraction of the month with a valid EF record


def find_header_row(path):
    """AmeriFlux BASE files have a variable number of leading '#' comment
    lines before the real header. Return the 0-based index of the line
    that starts with TIMESTAMP_START so pandas skiprows lands exactly."""
    with open(path) as f:
        for i, line in enumerate(f):
            if line.lstrip().startswith('TIMESTAMP_START'):
                return i
    raise SystemExit(
        f'Could not find a TIMESTAMP_START header row in {path}. '
        f'Is this an AmeriFlux BASE half-hourly CSV?')


def resolve_col(df, base):
    """Resolve an AmeriFlux variable to the column that actually carries
    data. A variable may appear bare (`NETRAD`), position-qualified
    (`NETRAD_2_1_1`, the `_H_V_R` sensor position), and/or PI-gap-filled
    (`NETRAD_PI_F`, `NETRAD_PI_F_1_1_2`). Critically, the bare column can
    exist but be ALL-NULL for a given year while a qualified variant holds
    the real measurements (observed at US-Me2 / US-Var 2023) — so we cannot
    just take the first name match. Among all candidate columns we pick the
    one with the most non-null rows in `df` (already filtered to the target
    year), breaking ties toward the MEASURED variant over the `_PI_F`
    gap-filled one (the project wants measured BASE data). Returns None if
    no candidate has any data."""
    pat = re.compile(rf'^{re.escape(base)}(_PI)?(_F)?(_\d+_\d+_\d+)?$')
    cands = [c for c in df.columns if pat.match(c) and int(df[c].notna().sum()) > 0]
    if not cands:
        return None

    def rank(c):
        # 1) measured (non-PI_F) beats gap-filled.
        measured = 0 if '_PI_F' in c else 1
        # 2) primary sensor beats secondary: the bare name (no _H_V_R) is
        #    the PI-designated primary; otherwise the lowest position tuple
        #    (_1_1_1 before _1_2_1). AmeriFlux _H_V_R = horizontal, vertical,
        #    replicate; level 1 is the primary/top sensor. Lower = better,
        #    so negate for a max()-friendly key. Bare → (0,0,0) ranks highest.
        m = re.search(r'_(\d+)_(\d+)_(\d+)$', c)
        pos = tuple(int(x) for x in m.groups()) if m else (0, 0, 0)
        primacy = tuple(-p for p in pos)
        return (measured, primacy)

    return max(cands, key=rank)


def candidate_report(df, base):
    """All columns for `base` with 2023 data + non-null counts, for the
    transparency print — so the sensor/variant choice is auditable."""
    pat = re.compile(rf'^{re.escape(base)}(_PI)?(_F)?(_\d+_\d+_\d+)?$')
    return {c: int(df[c].notna().sum())
            for c in df.columns if pat.match(c) and int(df[c].notna().sum()) > 0}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('base_csv', help='AmeriFlux BASE half-hourly CSV')
    ap.add_argument('--tower', required=True, choices=sorted(TOWERS),
                    help='AmeriFlux tower id (sets site_code + regime)')
    ap.add_argument('--year', type=int, default=2023,
                    help='Calendar year to compute (default 2023)')
    args = ap.parse_args()

    path = os.path.expanduser(args.base_csv)
    if not os.path.exists(path):
        raise SystemExit(f'File not found: {path}')

    meta = TOWERS[args.tower]
    print(f'Tower {args.tower} — {meta["site_code"]} [{meta["regime"]}], year {args.year}')

    hdr = find_header_row(path)
    df = pd.read_csv(path, skiprows=hdr, na_values=[-9999, '-9999', -9999.0])
    print(f'Loaded {len(df):,} records (header at line {hdr + 1})')

    # Timestamp → year, month, then filter to the target year FIRST — so
    # column resolution scores non-null counts within the year we actually
    # compute (a variant can be populated in one year and empty in another).
    ts = df['TIMESTAMP_START'].astype('Int64').astype(str)
    df['year']  = ts.str[:4].astype(int)
    df['month'] = ts.str[4:6].astype(int)
    df = df[df['year'] == args.year]
    if df.empty:
        raise SystemExit(f'No rows for year {args.year} in this file.')

    # Resolve the four flux columns against the target-year data. LE and
    # NETRAD are mandatory; H is needed only for EF_turbulent; G is
    # subtracted if present.
    col_le  = resolve_col(df, 'LE')
    col_h   = resolve_col(df, 'H')
    col_net = resolve_col(df, 'NETRAD')
    col_g   = resolve_col(df, 'G')

    if col_le is None or col_net is None:
        raise SystemExit(
            f'Missing mandatory column(s) with data in {args.year}: '
            f'{"LE " if col_le is None else ""}{"NETRAD" if col_net is None else ""}. '
            f'Found columns: {sorted(df.columns)[:20]}...')

    print(f'Columns resolved — LE={col_le}, H={col_h}, NETRAD={col_net}, '
          f'G={col_g if col_g else "(absent → G treated as 0)"}')
    # Transparency: show every candidate variant with data so the primary-
    # sensor choice is auditable (AmeriFlux towers carry multiple positions).
    for base in ('LE', 'H', 'NETRAD', 'G'):
        rep = candidate_report(df, base)
        if len(rep) > 1:
            print(f'  {base} candidates (non-null in {args.year}): {rep}')
    gapfilled = [c for c in (col_le, col_h, col_net, col_g) if c and '_PI_F' in c]
    if gapfilled:
        print(f'  NOTE: no measured variant in {args.year} for {gapfilled} — '
              f'using PI gap-filled data (flagged for provenance).')
    if col_g is None:
        print('  NOTE: no ground-heat-flux column; EF_rn_g uses Rn only. '
              'At monthly scale G is small (D1), but this is recorded.')
    if col_h is None:
        print('  NOTE: no sensible-heat column; EF_turbulent will be null.')

    rows = []
    for m in ALL_MONTHS:
        mdf = df[df['month'] == m]

        # All-hour, ratio-of-sums. A half-hour counts toward a sum only
        # when every term that sum needs is present, so numerator and
        # denominator are formed over consistent half-hour sets.
        rn_g_mask = mdf[col_le].notna() & mdf[col_net].notna() & (
            mdf[col_g].notna() if col_g else True)
        m_rn_g = mdf[rn_g_mask]
        n = len(m_rn_g)

        if n == 0:
            rows.append({'month': m, 'n_halfhours': 0, 'coverage': 0.0,
                         'excluded': True, 'note': 'no_data'})
            continue

        sum_le  = m_rn_g[col_le].sum()
        sum_net = m_rn_g[col_net].sum()
        sum_g   = m_rn_g[col_g].sum() if col_g else 0.0
        avail   = sum_net - sum_g
        ef_rn_g = sum_le / avail if avail != 0 else None
        # Monthly mean available-energy flux (W/m2) — the winter denominator.
        mean_avail = avail / n if n else None

        # EF_turbulent over half-hours with LE and H both present.
        ef_turb = None
        sum_h = None
        if col_h is not None:
            turb = mdf[mdf[col_le].notna() & mdf[col_h].notna()]
            if len(turb):
                sum_le_t = turb[col_le].sum()
                sum_h    = turb[col_h].sum()
                denom    = sum_le_t + sum_h
                ef_turb  = sum_le_t / denom if denom != 0 else None

        closure = ((sum_le + sum_h) / avail
                   if (sum_h is not None and avail != 0) else None)

        # Valid-record coverage: fraction of the month's timestamp rows that
        # yielded a usable EF record. AmeriFlux BASE files carry a complete
        # timestamp grid (gaps as -9999), so len(mdf) is the month's full
        # record count and n/len is a clean coverage fraction.
        coverage = n / len(mdf) if len(mdf) else 0.0

        # Uniform exclusion mask (D-G): EF nonphysical OR low available
        # energy OR low coverage. Same rule for every tower and the pipeline.
        reasons = []
        if ef_rn_g is None or ef_rn_g < -EF_TOL or ef_rn_g > 1 + EF_TOL:
            reasons.append('ef_nonphysical')
        if mean_avail is not None and mean_avail < RN_MIN_WM2:
            reasons.append('low_energy')
        if coverage < COVERAGE_MIN:
            reasons.append('low_coverage')
        excluded = bool(reasons)

        rows.append({
            'month':          m,
            'n_halfhours':    n,
            'coverage':       round(coverage, 3),
            'sum_le':         round(sum_le, 1),
            'sum_netrad':     round(sum_net, 1),
            'sum_g':          round(sum_g, 1),
            'sum_h':          round(sum_h, 1) if sum_h is not None else None,
            'avail':          avail,
            'mean_avail_wm2': round(mean_avail, 1) if mean_avail is not None else None,
            'ef_rn_g':        round(ef_rn_g, 4) if ef_rn_g is not None else None,
            'ef_turbulent':   round(ef_turb, 4) if ef_turb is not None else None,
            'closure':        round(closure, 4) if closure is not None else None,
            'excluded':       excluded,
            'note':           ';'.join(reasons),
        })

    # ── Console summary ─────────────────────────────────────────────
    print()
    print('=' * 78)
    print(f'{args.tower} monthly evaporative fraction ({args.year})')
    print('=' * 78)
    print(f'{"month":>5} {"n":>6} {"cov":>5} {"Rn_wm2":>8} {"EF_rn_g":>9} '
          f'{"EF_turb":>9} {"closure":>9}  excl_reason')
    for r in rows:
        f = lambda k: (f'{r[k]:.4f}' if r.get(k) is not None else '—')
        rn = f'{r["mean_avail_wm2"]:.1f}' if r.get('mean_avail_wm2') is not None else '—'
        cov = f'{r["coverage"]:.2f}' if r.get('coverage') is not None else '—'
        print(f'{r["month"]:>5} {r.get("n_halfhours", 0):>6} {cov:>5} {rn:>8} '
              f'{f("ef_rn_g"):>9} {f("ef_turbulent"):>9} {f("closure"):>9}  '
              f'{r.get("note", "")}')

    # Excluded months (uniform D-G mask). This is the same month subset the
    # Phase 2 pipeline masks; Phase 3 compares over the intersection (D-H).
    excl = [r for r in rows if r.get('excluded')]
    if excl:
        print(f'\nExcluded months (D-G uniform mask): '
              f'{[(r["month"], r["note"]) for r in excl]}')

    # Kept months = not excluded and with a usable EF.
    kept = [r for r in rows if not r.get('excluded') and r.get('ef_rn_g') is not None]
    if kept:
        # HEADLINE — ratio-of-annual-sums (D-F): Σ LE / Σ available energy.
        sum_le_yr    = sum(r['sum_le'] for r in kept)
        sum_avail_yr = sum(r['avail'] for r in kept)
        ef_ros = sum_le_yr / sum_avail_yr if sum_avail_yr else None
        # SENSITIVITY — mean-of-monthly-ratios (deprecated as headline).
        ef_mor = sum(r['ef_rn_g'] for r in kept) / len(kept)

        print()
        print(f'HEADLINE  HRC (ratio-of-annual-sums, D-F, n={len(kept)} months): '
              f'{ef_ros:.4f} → {ef_ros * 10:.2f}')
        print(f'sensitivity  mean-of-monthly-ratios (NOT the headline):       '
              f'{ef_mor:.4f} → {ef_mor * 10:.2f}')

        # Turbulent EF (Mead, D-B) and closure — also ratio-of-annual-sums.
        turb_rows = [r for r in kept if r.get('sum_h') is not None]
        if turb_rows:
            sum_leh = sum(r['sum_le'] + r['sum_h'] for r in turb_rows)
            sum_le_t = sum(r['sum_le'] for r in turb_rows)
            print(f'EF_turbulent (ratio-of-annual-sums):                         '
                  f'{sum_le_t / sum_leh:.4f}')
            print(f'closure (ratio-of-annual-sums, recorded not applied):        '
                  f'{sum_leh / sum(r["avail"] for r in turb_rows):.4f}')
    else:
        print('\nNo kept months — cannot form an annual reference. '
              'Check the input year and column resolution.')

    # ── Write per-month CSV for the Phase 3 archive ─────────────────
    out = f'tower_ef_{args.tower}.csv'
    for r in rows:
        r['tower_id']  = args.tower
        r['site_code'] = meta['site_code']
        r['regime']    = meta['regime']
        r['year']      = args.year
    cols = ['site_code', 'tower_id', 'regime', 'year', 'month', 'n_halfhours',
            'coverage', 'sum_le', 'sum_netrad', 'sum_g', 'sum_h', 'mean_avail_wm2',
            'ef_rn_g', 'ef_turbulent', 'closure', 'excluded', 'note']
    pd.DataFrame(rows).reindex(columns=cols).to_csv(out, index=False)
    print(f'\nSaved per-month detail to {out}')
    print('Gate P1: monthly tower EF computed for every site-month; closure recorded.')


if __name__ == '__main__':
    main()
