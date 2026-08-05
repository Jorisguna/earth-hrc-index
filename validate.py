"""
validate.py — Phase 3 gate: pipeline-vs-tower validation, D2 denominator
adjudication, and the D-J curve check.
HRC 30 m US test sites (docs/HRC_30m_test_sites_usa_phase3_handoff_v1_0.md).

WHAT THIS IS
------------
The Phase 3 deliverable: a pass/fail gate, not a report. It decides whether
the 30 m pipeline (scripts/pipeline.js) tracks the flux towers closely enough
to import, picks the D2 denominator winner (A vs B) on evidence, and — for
any tower that fails — diagnoses whether the failure traces to the pipeline's
denominator (fixable here) or to OpenET's own numerator floor (an external,
already-documented limitation this codebase cannot fix). Nothing gets
imported on the strength of this script failing.

THE D-H INTERSECTION (the load-bearing idea)
----------------------------------------------
The pipeline and the tower each compute their OWN per-month validity mask
(D-G), independently, for different reasons (the pipeline's ERA5 denominator
runs high in spring and low in Nov/Jan/Feb relative to the tower; the tower
drops months for its own record-completeness reasons). Comparing over either
side's mask alone reintroduces exactly the matched-methodology violation (C5)
that caused the v2.1.1 production failure. So every comparison here is over
the INTERSECTION: a month counts only if the pipeline's `masked` flag AND the
tower's `excluded` flag are BOTH false, for that specific tower.

AGGREGATION = RATIO OF THE INTERSECTION'S RAW SUMS (C1/D-F), NEVER A MEAN OF
MONTHLY RATIOS. The pipeline's footprint CSV carries le_j_month / avail_a_j_month
/ avail_b_j_month (raw sums, added to pipeline.js in the Phase 3 §3.1 patch
specifically so this script could do this correctly) and the tower CSV
carries sum_le / sum_netrad / sum_g (tower.py's own raw sums). Both sides are
summed over the intersection month set, then divided ONCE — mirroring
tower.py's own headline computation line for line, not reinventing it.

USAGE
-----
    python3 validate.py --data-dir <folder with hrc_30m_*_footprint.csv>
                         [--tower-dir <folder with tower_ef_*.csv, default: this script's directory>]
                         [--out <output CSV path, default: hrc_30m_phase3_validation.csv>]

Output: hrc_30m_phase3_validation.csv (schema below) + a printed D2 decision
record (§4.4) that is meant to be copy-pasted into a dated addendum, not left
implicit in a chat log.
"""
import argparse
import calendar
import csv
import os
import sys

YEAR = 2023
ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

# ── Tower manifest (D-C / D-E) — tolerance per D-E: Me2 gets the wider ──
# forest band; every other tower is the crop/grass ±0.06.
TOWERS = {
    'US-Ne1': {'region_code': 'mead_ne',        'regime': 'irrigated_continuous_maize',   'tolerance': 0.06},
    'US-Ne2': {'region_code': 'mead_ne',        'regime': 'irrigated_maize_soy_rotation', 'tolerance': 0.06},
    'US-Ne3': {'region_code': 'mead_ne',        'regime': 'rainfed_maize_soy_rotation',   'tolerance': 0.06},
    'US-Ton': {'region_code': 'tonzi_vaira_ca', 'regime': 'blue_oak_savanna',             'tolerance': 0.06},
    'US-Var': {'region_code': 'tonzi_vaira_ca', 'regime': 'annual_c3_grassland',          'tolerance': 0.06},
    # Gotcha #6 (handoff §7): regime label is a disputed, unresolved question —
    # AmeriFlux's own BADM record calls the 2023 footprint post-fire
    # "regenerating," not mature forest. Flagged in notes, not silently trusted.
    'US-Me2': {'region_code': 'metolius_or',    'regime': 'mature_ponderosa_pine (DISPUTED — see coordinate audit)', 'tolerance': 0.10},
}
REGION_TOWERS = {
    'mead_ne':        ['US-Ne1', 'US-Ne2', 'US-Ne3'],
    'tonzi_vaira_ca': ['US-Ton', 'US-Var'],
    'metolius_or':    ['US-Me2'],
}
DENOMINATORS = ['A', 'B']

SECONDS_IN_MONTH = {m: calendar.monthrange(YEAR, m)[1] * 86400 for m in ALL_MONTHS}


# ── Loaders ──────────────────────────────────────────────────────────

def load_tower_csvs(tower_dir):
    """tower_id -> month -> {sum_le, avail, ef_rn_g, excluded, closure,
    mean_avail_wm2, n_halfhours}. avail = sum_netrad - sum_g, tower.py's own
    raw denominator — mirrored here, not recomputed differently."""
    out = {}
    for tower_id in TOWERS:
        path = os.path.join(tower_dir, f'tower_ef_{tower_id}.csv')
        if not os.path.exists(path):
            raise SystemExit(f'Missing tower reference: {path}')
        months = {}
        with open(path) as f:
            for row in csv.DictReader(f):
                m = int(row['month'])
                if row.get('sum_le', '') == '' or row.get('sum_netrad', '') == '':
                    # 'no data' row (n_halfhours == 0) — treat as excluded.
                    months[m] = {'sum_le': None, 'avail': None, 'ef_rn_g': None,
                                 'excluded': True, 'closure': None,
                                 'mean_avail_wm2': None, 'n_halfhours': int(row.get('n_halfhours', 0) or 0)}
                    continue
                sum_le = float(row['sum_le'])
                sum_g = float(row['sum_g']) if row.get('sum_g', '') != '' else 0.0
                avail = float(row['sum_netrad']) - sum_g
                months[m] = {
                    'sum_le': sum_le,
                    'avail': avail,
                    'ef_rn_g': float(row['ef_rn_g']) if row.get('ef_rn_g', '') != '' else None,
                    'excluded': row['excluded'].strip() == 'True',
                    'closure': float(row['closure']) if row.get('closure', '') != '' else None,
                    'mean_avail_wm2': float(row['mean_avail_wm2']) if row.get('mean_avail_wm2', '') != '' else None,
                    'n_halfhours': int(row['n_halfhours']),
                }
        out[tower_id] = months
    return out


def load_footprint_csvs(data_dir):
    """tower_id -> month -> {masked, ef_A_month, ef_B_month, le_j_month,
    avail_a_j_month, avail_b_j_month, et_openet_mm_raw, le_openet_wm2_raw,
    n_landsat_scenes}. Raw sums are pipeline.js's own — never recomputed."""
    out = {}
    for region_code, tower_ids in REGION_TOWERS.items():
        path = os.path.join(data_dir, f'hrc_30m_{region_code}_footprint.csv')
        if not os.path.exists(path):
            raise SystemExit(f'Missing footprint export: {path}')
        with open(path) as f:
            for row in csv.DictReader(f):
                tower_id = row['tower_id']
                if tower_id not in tower_ids:
                    continue
                m = int(row['month'])
                out.setdefault(tower_id, {})[m] = {
                    'masked':           row['masked'].strip() == '1',
                    'ef_A_month':       float(row['ef_A_month']),
                    'ef_B_month':       float(row['ef_B_month']),
                    'le_j_month':       float(row['le_j_month']),
                    'avail_a_j_month':  float(row['avail_a_j_month']),
                    'avail_b_j_month':  float(row['avail_b_j_month']),
                    'et_openet_mm_raw': float(row['et_openet_mm_raw']),
                    'le_openet_wm2_raw': float(row['le_openet_wm2_raw']),
                    'n_landsat_scenes': int(row['n_landsat_scenes']),
                }
    return out


# ── D-H intersection + C1 ratio-of-sums ─────────────────────────────

def intersection_months(tower_id, tower_data, pipeline_data):
    """Months where BOTH pipeline.masked==False AND tower.excluded==False,
    for this specific tower (D-H, handoff §3.3). Never substitute either
    side's mask alone."""
    months = []
    for m in ALL_MONTHS:
        t = tower_data[tower_id].get(m)
        p = pipeline_data[tower_id].get(m)
        if t is None or p is None or t['excluded'] or p['masked']:
            continue
        months.append(m)
    return months


def ratio_of_sums(months, tower_id, tower_data, pipeline_data, denom):
    """C1/D-F: sum raw numerator and denominator over `months`, divide once.
    Returns (tower_ef, pipeline_ef); None if a side has nothing to sum."""
    t = tower_data[tower_id]
    p = pipeline_data[tower_id]
    avail_key = f'avail_{denom.lower()}_j_month'

    tower_le  = sum(t[m]['sum_le'] for m in months)
    tower_av  = sum(t[m]['avail']  for m in months)
    pipe_le   = sum(p[m]['le_j_month'] for m in months)
    pipe_av   = sum(p[m][avail_key]    for m in months)

    tower_ef   = tower_le / tower_av if tower_av else None
    pipeline_ef = pipe_le / pipe_av if pipe_av else None
    return tower_ef, pipeline_ef


# ── §4.1 magnitude gate + month-bias table ──────────────────────────

def month_bias_table(tower_id, months, tower_data, pipeline_data, denom):
    """Prints (month, pipeline_ef_month - tower_ef_month) for every
    intersection month — Gate P3's 'no month-bias trend,' operationalized as
    a visible tabulation (no hard statistical threshold was ever specified)."""
    t = tower_data[tower_id]
    p = pipeline_data[tower_id]
    ef_key = f'ef_{denom}_month'
    rows = []
    for m in months:
        tower_ef_m = t[m]['ef_rn_g']
        pipe_ef_m  = p[m][ef_key]
        rows.append((m, pipe_ef_m - tower_ef_m if tower_ef_m is not None else None))
    return rows


# ── §4.2 curve gate (D-J) — load-bearing, independent of magnitude ─────

def curve_gate_mead(tower_data, pipeline_data, denom):
    """Mead anchor: pipeline_ef(Ne1) > pipeline_ef(Ne3) and
    pipeline_ef(Ne2) > pipeline_ef(Ne3), over months common to ALL THREE
    towers' own D-H intersections (not just Ne1's or Ne3's alone) — a month
    is only comparable if every tower being compared is valid in it."""
    per_tower_months = {tid: set(intersection_months(tid, tower_data, pipeline_data))
                         for tid in ('US-Ne1', 'US-Ne2', 'US-Ne3')}
    common = sorted(per_tower_months['US-Ne1'] & per_tower_months['US-Ne2'] & per_tower_months['US-Ne3'])

    ef_key = f'ef_{denom}_month'
    def ef(tid, m): return pipeline_data[tid][m][ef_key]

    per_month = [(m, ef('US-Ne1', m) > ef('US-Ne3', m), ef('US-Ne2', m) > ef('US-Ne3', m)) for m in common]
    ann_ne1 = ratio_of_sums(common, 'US-Ne1', tower_data, pipeline_data, denom)[1] if common else None
    ann_ne2 = ratio_of_sums(common, 'US-Ne2', tower_data, pipeline_data, denom)[1] if common else None
    ann_ne3 = ratio_of_sums(common, 'US-Ne3', tower_data, pipeline_data, denom)[1] if common else None
    annual_ne1_gt_ne3 = ann_ne1 is not None and ann_ne3 is not None and ann_ne1 > ann_ne3
    annual_ne2_gt_ne3 = ann_ne2 is not None and ann_ne3 is not None and ann_ne2 > ann_ne3

    ne1_pass = annual_ne1_gt_ne3 and all(row[1] for row in per_month)
    ne2_pass = annual_ne2_gt_ne3 and all(row[2] for row in per_month)
    ne3_pass = ne1_pass and ne2_pass  # Ne3's role is "stayed lower than both" — same fact, its perspective.

    return {
        'common_months': common, 'per_month': per_month,
        'annual': {'US-Ne1': ann_ne1, 'US-Ne2': ann_ne2, 'US-Ne3': ann_ne3},
        'gate_pass': {'US-Ne1': ne1_pass, 'US-Ne2': ne2_pass, 'US-Ne3': ne3_pass},
    }


def curve_gate_tonzi(tower_data, pipeline_data, denom):
    """Tonzi/Vaira: pipeline_ef(Ton) > pipeline_ef(Var) over the derived
    overlap of each tower's own D-H intersection with the Jun-Sep candidate
    summer window (the historical divergence months per the tower reference
    tables) — the overlap is COMPUTED from the data, not assumed to be all
    four months just because they're nominally "summer.\""""
    candidate = [6, 7, 8, 9]
    ton_months = set(intersection_months('US-Ton', tower_data, pipeline_data))
    var_months = set(intersection_months('US-Var', tower_data, pipeline_data))
    common = sorted(set(candidate) & ton_months & var_months)

    ef_key = f'ef_{denom}_month'
    def ef(tid, m): return pipeline_data[tid][m][ef_key]

    per_month = [(m, ef('US-Ton', m) > ef('US-Var', m)) for m in common]
    ann_ton = ratio_of_sums(common, 'US-Ton', tower_data, pipeline_data, denom)[1] if common else None
    ann_var = ratio_of_sums(common, 'US-Var', tower_data, pipeline_data, denom)[1] if common else None
    annual_pass = ann_ton is not None and ann_var is not None and ann_ton > ann_var

    ton_pass = annual_pass and all(row[1] for row in per_month) and len(common) > 0
    var_pass = ton_pass  # same underlying fact, Var's perspective ("stayed lower").

    return {
        'common_months': common, 'per_month': per_month,
        'annual': {'US-Ton': ann_ton, 'US-Var': ann_var},
        'gate_pass': {'US-Ton': ton_pass, 'US-Var': var_pass},
    }


# ── §4.3 likely-cause split (diagnosis, not a pass/fail input) ───────

def likely_cause(tower_id, months, tower_data, pipeline_data, denom):
    """Distinguishes the numerator-floor signature (OpenET's raw, unmasked LE
    runs far hot specifically in the tower's OWN lowest-EF months — the
    external investigation's exact pattern at Tonzi/Vaira) from a
    denominator-error signature (available energy diverges from the tower's
    measured Rn-G, while raw LE roughly tracks). A transparent heuristic, not
    a statistical test — this is diagnosis, never a gate input (handoff §4.3)."""
    if not months:
        return 'unclear', 'no intersection months to diagnose'

    t = tower_data[tower_id]
    p = pipeline_data[tower_id]
    ef_key = f'ef_{denom}_month'

    # Tower's own lowest-EF kept months (up to 3) — where the floor, if
    # present, would bind hardest.
    ranked = sorted(months, key=lambda m: t[m]['ef_rn_g'])
    low_ef_months = ranked[:max(1, min(3, len(ranked)))]

    # sum_le / avail are SUMS OF W/m2 READINGS, not accumulated energy — the
    # mean flux is just sum/n_records, independent of read interval (verified
    # against mean_avail_wm2: avail/n reproduces it exactly; no duration
    # factor). Nebraska's hourly vs the others' half-hourly cadence (a
    # documented gotcha) is irrelevant here for exactly that reason.
    tower_le_wm2 = lambda m: t[m]['sum_le'] / t[m]['n_halfhours']
    openet_ratio = [p[m]['le_openet_wm2_raw'] / tower_le_wm2(m)
                    for m in low_ef_months if tower_le_wm2(m) > 1e-6]
    numerator_signature = bool(openet_ratio) and (sum(openet_ratio) / len(openet_ratio)) > 2.0

    # Denominator signature: months where the raw OpenET/tower LE ratio is
    # near 1 (numerator agrees) but ef_*_month still diverges from the
    # tower's ef_rn_g beyond tolerance — with the numerator agreeing, that
    # residual can only come from the denominator. Deliberately does NOT try
    # to reconstruct an absolute avail flux from avail_*_j_month: that column
    # is PIXEL-SUMMED across the ~35 30 m pixels in the 100 m footprint (by
    # design — that's what makes the C1 ratio-of-sums correct), not
    # pixel-averaged, so dividing it by seconds alone (as an earlier version
    # of this function did) inflates it by roughly the pixel count and isn't
    # comparable to the tower's single-point flux. ef_*_month and le_openet_
    # wm2_raw are both already validated, correctly-scaled ratios/means, so
    # staying inside that dimensionless-ratio space avoids the trap entirely.
    le_agrees_months = [m for m in months
                         if tower_le_wm2(m) > 1e-6
                         and 0.7 <= p[m]['le_openet_wm2_raw'] / tower_le_wm2(m) <= 1.3]
    ef_gaps = [abs(p[m][ef_key] - t[m]['ef_rn_g']) for m in le_agrees_months]
    denominator_signature = bool(ef_gaps) and (sum(ef_gaps) / len(ef_gaps)) > 0.10

    if numerator_signature and denominator_signature:
        cause = 'mixed'
    elif numerator_signature:
        cause = 'numerator'
    elif denominator_signature:
        cause = 'denominator'
    else:
        cause = 'unclear'

    note = (f'low-EF-month OpenET/tower LE ratio={sum(openet_ratio)/len(openet_ratio):.2f}x' if openet_ratio else 'low-EF ratio n/a')
    note += (f'; EF gap where LE agrees ({len(le_agrees_months)} mo)={sum(ef_gaps)/len(ef_gaps):.3f}' if ef_gaps
             else f'; LE never agrees within 30% in any of {len(months)} months')
    return cause, note


# ── Main ──────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--data-dir', required=True, help='Folder containing hrc_30m_<region>_footprint.csv (and _tiles.csv, unused here)')
    ap.add_argument('--tower-dir', default=os.path.dirname(os.path.abspath(__file__)),
                     help='Folder containing tower_ef_US-*.csv (default: this script\'s directory)')
    ap.add_argument('--out', default='hrc_30m_phase3_validation.csv')
    args = ap.parse_args()

    tower_data = load_tower_csvs(args.tower_dir)
    pipeline_data = load_footprint_csvs(args.data_dir)

    print('=' * 78)
    print('Phase 3 gate — pipeline vs tower, D-H intersection, C1 ratio-of-sums')
    print('=' * 78)

    curve = {}
    for denom in DENOMINATORS:
        mead = curve_gate_mead(tower_data, pipeline_data, denom)
        tonzi = curve_gate_tonzi(tower_data, pipeline_data, denom)
        mead['gate_pass']['US-Ton'] = tonzi['gate_pass']['US-Ton']
        mead['gate_pass']['US-Var'] = tonzi['gate_pass']['US-Var']
        mead['_tonzi'] = tonzi
        curve[denom] = mead

        print(f'\n── D-J curve gate, denominator {denom} ──')
        print(f'  Mead anchor common months (Ne1∩Ne2∩Ne3 D-H-valid): {mead["common_months"]}')
        for m, ne1_gt, ne2_gt in mead['per_month']:
            print(f'    m{m}: Ne1>Ne3={ne1_gt}  Ne2>Ne3={ne2_gt}')
        a = mead['annual']
        print(f'  annual over common months: Ne1={a["US-Ne1"]!r} Ne2={a["US-Ne2"]!r} Ne3={a["US-Ne3"]!r}')
        print(f'  Tonzi/Vaira summer overlap (Jun-Sep ∩ Ton ∩ Var D-H-valid): {tonzi["common_months"]}')
        for m, ton_gt in tonzi['per_month']:
            print(f'    m{m}: Ton>Var={ton_gt}')
        ta = tonzi['annual']
        print(f'  annual over overlap: Ton={ta["US-Ton"]!r} Var={ta["US-Var"]!r}')

    out_rows = []
    for tower_id, meta in TOWERS.items():
        months = intersection_months(tower_id, tower_data, pipeline_data)
        print(f'\n── {tower_id} [{meta["regime"]}] — {len(months)} intersection months: {months} ──')

        for denom in DENOMINATORS:
            tower_ef, pipeline_ef = ratio_of_sums(months, tower_id, tower_data, pipeline_data, denom)
            if tower_ef is None or pipeline_ef is None:
                diff = None
                gate_pass_magnitude = False
                note_extra = 'no valid intersection months'
            else:
                diff = pipeline_ef - tower_ef
                gate_pass_magnitude = abs(diff) <= meta['tolerance']
                note_extra = ''

            gate_pass_curve = curve[denom]['gate_pass'].get(tower_id)  # None for US-Me2

            cause, cause_note = (None, '')
            if tower_ef is not None and not gate_pass_magnitude:
                cause, cause_note = likely_cause(tower_id, months, tower_data, pipeline_data, denom)

            bias_rows = month_bias_table(tower_id, months, tower_data, pipeline_data, denom)
            trend_note = ''
            if len(bias_rows) >= 4:
                vals = [v for _, v in bias_rows if v is not None]
                if vals and (vals[-1] - vals[0]) * len(vals) > 0 and abs(vals[-1] - vals[0]) > meta['tolerance']:
                    trend_note = 'residual trends across the season, not a constant offset — see printed table'

            print(f'  denom {denom}: tower_ef={tower_ef!r:>8}  pipeline_ef={pipeline_ef!r:>8}  '
                  f'diff={diff!r:>8}  tol=±{meta["tolerance"]}  magnitude_pass={gate_pass_magnitude}  '
                  f'curve_pass={gate_pass_curve}')
            if bias_rows:
                print('    month-bias (pipeline - tower):', ', '.join(f'{m}:{v:+.3f}' if v is not None else f'{m}:n/a' for m, v in bias_rows))
            if cause:
                print(f'    FAILED — likely_cause={cause} ({cause_note})')

            notes = '; '.join(x for x in [note_extra, trend_note, cause_note if cause else ''] if x)
            out_rows.append({
                'tower_id': tower_id, 'region_code': meta['region_code'], 'regime': meta['regime'],
                'denominator': denom, 'n_intersection_months': len(months),
                'tower_ef': tower_ef, 'pipeline_ef': pipeline_ef, 'diff': diff,
                'tolerance': meta['tolerance'],
                'gate_pass_magnitude': gate_pass_magnitude,
                'gate_pass_curve': gate_pass_curve,
                'likely_cause': cause, 'notes': notes,
            })

    with open(args.out, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['tower_id', 'region_code', 'regime', 'denominator',
                                          'n_intersection_months', 'tower_ef', 'pipeline_ef', 'diff',
                                          'tolerance', 'gate_pass_magnitude', 'gate_pass_curve',
                                          'likely_cause', 'notes'])
        w.writeheader()
        w.writerows(out_rows)
    print(f'\nWrote {args.out} ({len(out_rows)} rows).')

    # ── §4.4 D2 decision record ──────────────────────────────────────
    print('\n' + '=' * 78)
    print('D2 DECISION RECORD — draft, review before treating as final')
    print('=' * 78)
    for denom in DENOMINATORS:
        rows = [r for r in out_rows if r['denominator'] == denom]
        both_pass = [r['tower_id'] for r in rows if r['gate_pass_magnitude'] and (r['gate_pass_curve'] in (True, None))]
        fails = [r for r in rows if not (r['gate_pass_magnitude'] and (r['gate_pass_curve'] in (True, None)))]
        print(f'\nDenominator {denom}: {len(both_pass)}/{len(rows)} towers pass (magnitude + curve).')
        print(f'  Pass: {both_pass}')
        for r in fails:
            reason = []
            if not r['gate_pass_magnitude']:
                reason.append(f"magnitude diff={r['diff']:+.3f}" if r['diff'] is not None else 'no data')
            if r['gate_pass_curve'] is False:
                reason.append('curve/ordering failed')
            cause = f", likely_cause={r['likely_cause']}" if r['likely_cause'] else ''
            print(f"  FAIL {r['tower_id']}: {', '.join(reason)}{cause}")

    print('\n' + '-' * 78)
    print('Fill in by hand before this becomes the recorded decision (handoff §4.4):')
    print('  Winner: ____   Evidence: the table above.')
    print('  Towers out of scope for Phase 4 import regardless of denominator, and why:')
    print('  (expected: US-Ton, on the externally-documented numerator-floor finding —')
    print('   confirm the likely_cause tag above says so before citing it as such.)')
    print('  Recorded by: ____   Date: ____')
    print('-' * 78)


if __name__ == '__main__':
    main()
