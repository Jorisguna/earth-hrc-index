"""
albedo_modifier_phase0_analysis.py — Albedo modifier Phase 0 analysis.

Reads the four CSVs produced by the Phase 0 GEE scripts (35 / 36 / 37),
joins panel pixels to their ecoregion albedo references, computes the
proposed v2.2 score at three weights (w = 0.10 / 0.15 / 0.20), and
emits the human-readable acceptance table plus a markdown report.

Phase 0 of HRC_albedo_modifier_claude_code_handoff_v1_1.md (multiplicative
form, per v1.0 → v1.1 patch). Diagnostic only — does NOT touch production
tiles or schema.

Formula (v1.1):
  HRC_v2_2 = 10 × EF × (1 − w × Albedo_deficit_norm)
  Disabled ecoregions: HRC_v2_2 = 10 × EF (identical to v2.1.1).

Inputs (defaults to ~/Downloads/, override with --input-dir):
  hrc_albedo_reference_idf_phase0.csv               (script 35)
  hrc_albedo_reference_tapajos_phase0.csv           (script 36)
  hrc_albedo_panel_pixels_phase0.csv                (script 37)
  hrc_albedo_panel_ecoregion_centroids_phase0.csv   (script 37)

Outputs (written to validation_artefacts/albedo_modifier_phase0/):
  diagnostic_panel_scores_v1.csv
  ecoregion_reference_summary_v1.csv
  albedo_modifier_phase0_report_v1.md

Usage:
  python3 scripts/albedo_modifier_phase0_analysis.py
  python3 scripts/albedo_modifier_phase0_analysis.py --input-dir ~/Downloads/

Acceptance gates (from handoff v1.2 §6.3):
  HARD:  FR-Fon v2.2 within ±0.10 of v2.1.1 (5.70)
  HARD:  K67 v2.2 within ±0.10 of v2.1.1 (5.62) — identity under Path A fallback
  HARD:  BR-163 clearance pixel v2.2 within ±0.10 of v2.1.1 (Path A fallback;
           reverts to "drop ≥ 0.20" once Tapajós Path B reference is in place)
  HARD:  Beauce cropland pixel v2.2 ≤ v2.1.1 − 0.15
  HARD:  Paris urban pixel v2.2 ≤ v2.1.1 − 0.02
  SOFT:  At least one ecoregion in panel fails the trust gate
  SOFT:  Per-pixel change distribution reported (not just means)
  SOFT:  Sensitivity sweep at w = 0.10 / 0.15 / 0.20 reported

Pre-flight: scripts/albedo_modifier_phase0_smoke_test.py must pass
before running this script on real GEE outputs.

Exit codes:
  0 — analysis ran (does NOT mean Phase 0 passed; see report)
  2 — input files missing or malformed
"""
import argparse
import csv
import os
import sys
from pathlib import Path

# ── Constants — locked by the handoff ────────────────────────────────
WEIGHTS         = [0.10, 0.15, 0.20]
DEFAULT_WEIGHT  = 0.15

# v2.1.1 satellite-derived scores at flux-tower pixels (handoff §11).
# These are the BASELINES the v2.2 score is compared against — not the
# matched-methodology tower references (those are 6.18 / 7.65, see
# validate_satellite_vs_tower.py).
V21_BASELINE = {
    'p1_frfon': 5.70,
    'p3_k67':   5.62,
}

INPUT_FILES = {
    'idf_ref':       'hrc_albedo_reference_idf_phase0.csv',
    'tapajos_ref':   'hrc_albedo_reference_tapajos_phase0.csv',
    'panel':         'hrc_albedo_panel_pixels_phase0.csv',
    'eco_centroids': 'hrc_albedo_panel_ecoregion_centroids_phase0.csv',
    'idf_audit':     'hrc_albedo_centroid_audit_idf_phase0.csv',
    'tapajos_audit': 'hrc_albedo_centroid_audit_tapajos_phase0.csv',
}

# Known v2.1.1 reference p90 values from script 33 / 34 (per project memory
# and validation case studies). Used in the markdown report to flag any
# discrepancy with the v1.1 audit-CSV-derived p90 (apples-to-apples sanity
# check that the per-centroid HRC pipeline added in v1.1 produces values
# consistent with the existing script 33 reference).
KNOWN_V211_REFERENCES = {
    # ecoregion_id (str) → expected p90 hrc_v2_1_1 (anchored in handoff v1.1 §11)
    # RESOLVE 2017 ECO_ID for European Atlantic mixed forests = 664
    # (confirmed against the first Phase 0 GEE output, May 2026).
    #
    # CAVEAT: 6.47 was computed by script 33 using IUCN I–IV centroids
    # (39 surviving). The v1.1 Phase 0 IDF reference (script 35) now uses
    # IUCN I–VI to clear the 5 % PA-coverage gate for France. The
    # expanded centroid set means anchor mismatch is EXPECTED and
    # informational, not a divergence in the radiation pipeline.
    '664': 6.47,   # European Atlantic mixed forests
}

OUTPUT_DIR = Path(__file__).resolve().parent.parent / 'validation_artefacts' / 'albedo_modifier_phase0'


# ── Helpers ──────────────────────────────────────────────────────────
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


def clip01(x):
    if x is None:
        return None
    return max(0.0, min(1.0, x))


def truthy(v):
    """GEE serializes booleans as 'true'/'false'; some CSVs write 1/0."""
    return str(v).strip().lower() in ('true', '1', 'yes', 't', 'y')


def read_csv(path):
    """Return list of dict rows."""
    with open(path, newline='') as f:
        return list(csv.DictReader(f))


REQUIRED_KEYS = ('idf_ref', 'tapajos_ref', 'panel', 'eco_centroids')
OPTIONAL_KEYS = ('idf_audit', 'tapajos_audit')  # v1.1 — for reference_p90_v2_2


def load_inputs(input_dir):
    paths = {key: Path(input_dir) / fname for key, fname in INPUT_FILES.items()}
    missing_required = [str(paths[k]) for k in REQUIRED_KEYS if not paths[k].exists()]
    if missing_required:
        print('Missing required input files:', file=sys.stderr)
        for m in missing_required:
            print(f'  {m}', file=sys.stderr)
        sys.exit(2)

    out = {key: read_csv(paths[key]) for key in REQUIRED_KEYS}
    for key in OPTIONAL_KEYS:
        out[key] = read_csv(paths[key]) if paths[key].exists() else None
    return out


def build_eco_reference_index(idf_rows, tapajos_rows):
    """
    Combined ecoregion → reference dict, keyed by (region_code, ecoregion_id).
    Each value contains the trust-gate fields needed downstream.
    """
    index = {}
    for row in idf_rows + tapajos_rows:
        key = (row['region_code'], row['ecoregion_id'])
        # v1.1 (PA-coverage fix) renamed ecoregion_area_km2 to two columns
        # (_local and _full); pre-fix CSVs only have the original.
        eco_area_local = parse_float(row.get('ecoregion_area_km2_local',
                                              row.get('ecoregion_area_km2', '')))
        eco_area_full  = parse_float(row.get('ecoregion_area_km2_full',
                                              row.get('ecoregion_area_km2', '')))
        index[key] = {
            'ecoregion_name': row['ecoregion_name'],
            'biome_name':     row['biome_name'],
            'biome_num':      parse_int(row['biome_num']),
            'albedo_ref_p25': parse_float(row['albedo_ref_p25']),
            'albedo_ref_p50': parse_float(row['albedo_ref_p50']),
            'albedo_ref_p75': parse_float(row['albedo_ref_p75']),
            'albedo_ref_iqr': parse_float(row['albedo_ref_iqr']),
            'centroid_count_kept':            parse_int(row['centroid_count_kept']),
            'pa_coverage_frac':               parse_float(row['pa_coverage_frac']),
            'ecoregion_area_km2_local':       eco_area_local,
            'ecoregion_area_km2_full':        eco_area_full,
            'albedo_modifier_status':         row['albedo_modifier_status'],
            'albedo_modifier_disabled_reason': row['albedo_modifier_disabled_reason'] or None,
        }
    return index


# ── Core: v2.2 score computation ─────────────────────────────────────
def albedo_deficit_norm(pixel_albedo, albedo_ref_p50):
    if pixel_albedo is None or albedo_ref_p50 is None or albedo_ref_p50 == 0:
        return None
    raw = (pixel_albedo - albedo_ref_p50) / albedo_ref_p50
    return clip01(raw)


def hrc_v22(ef, deficit_norm, w, status):
    """
    Apply handoff v1.1 §2 multiplicative formula:
      enabled  → 10 × EF × (1 − w × deficit_norm)
      disabled → 10 × EF                    (identical to v2.1.1)
    Returns None if EF is missing.

    By construction, a pixel with deficit_norm = 0 scores exactly 10×EF
    (unchanged from v2.1.1). A pixel with deficit_norm = 1 scores
    10×EF×(1−w), a maximum w·100% reduction.
    """
    if ef is None:
        return None
    if status != 'enabled' or deficit_norm is None:
        return 10.0 * clip01(ef)
    return 10.0 * clip01(ef) * (1.0 - w * deficit_norm)


def percentile(values, q):
    """Linear-interpolation percentile, matching numpy default. q in [0,100]."""
    vs = sorted(v for v in values if v is not None)
    if not vs:
        return None
    if len(vs) == 1:
        return vs[0]
    pos = (q / 100.0) * (len(vs) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(vs) - 1)
    frac = pos - lo
    return vs[lo] * (1.0 - frac) + vs[hi] * frac


def compute_v22_reference_per_ecoregion(audit_rows, eco_ref_index, region, w):
    """
    Per handoff v1.1 §7.5: recompute the per-ecoregion p90 of HRC scores
    under the v2.2 formula using each centroid's hrc_v2_1_1 + pixel albedo,
    joined to the ecoregion's albedo_ref_p50.

    Uses ALL centroids (not just those passing the trust-filter) so the
    output is apples-to-apples comparable to the existing v2.1.1
    reference computed by script 33/34 from the same WDPA filter.

    Returns dict keyed by ecoregion_id with:
      n_centroids, hrc_v2_1_1_p90, hrc_v2_2_p90, shift
    """
    if not audit_rows:
        return {}

    # Group centroids by ecoregion_id
    by_eco = {}
    for row in audit_rows:
        eco_id = row.get('ecoregion_id', '') or None
        if eco_id is None or eco_id == '':
            continue
        by_eco.setdefault(eco_id, []).append(row)

    out = {}
    for eco_id, rows in by_eco.items():
        ref = eco_ref_index.get((region, eco_id), {})
        ref_p50 = ref.get('albedo_ref_p50')
        status  = ref.get('albedo_modifier_status', 'no_reference')

        v211_scores = []
        v22_scores  = []
        for r in rows:
            h_v211 = parse_float(r.get('hrc_v2_1_1'))
            albedo = parse_float(r.get('albedo'))
            if h_v211 is None:
                continue
            v211_scores.append(h_v211)

            # Recompute v2.2 score using the formula's inputs.
            # h_v211 / 10 = EF (since v2.1.1 = 10 × EF clipped).
            ef = h_v211 / 10.0
            deficit = albedo_deficit_norm(albedo, ref_p50)
            v22_scores.append(hrc_v22(ef, deficit, w, status))

        p90_v211 = percentile(v211_scores, 90)
        p90_v22  = percentile([v for v in v22_scores if v is not None], 90)
        shift = None if (p90_v211 is None or p90_v22 is None) else (p90_v22 - p90_v211)

        out[eco_id] = {
            'ecoregion_name': rows[0].get('ecoregion_name', ''),
            'n_centroids':    len(v211_scores),
            'hrc_v2_1_1_p90': p90_v211,
            'hrc_v2_2_p90':   p90_v22,
            'shift':          shift,
            'albedo_modifier_status': status,
        }
    return out


# ── Pixel selection logic (handoff §6.2) ─────────────────────────────
def pick_panel_representatives(panel_rows):
    """
    For each named pixel id (#1, #2, #3, #4, #5):
      - Use the primary candidate if its lc_type1 matches expected_lc_class.
      - Otherwise, use the first alternate whose lc_type1 matches.
      - Otherwise, fall back to the primary and flag.

    Returns (primary_pixels, candidates_by_id).
    """
    by_id_root = {}
    for row in panel_rows:
        pid = row['pixel_id']
        # Strip _alt<N> or _grid_<i>_<j> suffix to find the root id
        if '_alt' in pid:
            root = pid.split('_alt')[0]
        elif '_grid' in pid:
            root = pid.split('_grid')[0]
        else:
            root = pid
        by_id_root.setdefault(root, []).append(row)

    primaries = {}
    for root, rows in by_id_root.items():
        rows_sorted = sorted(rows, key=lambda r: (truthy(r.get('is_alternate', '')), r['pixel_id']))
        primary = rows_sorted[0]
        expected = parse_int(primary['expected_lc_class'])
        actual_primary = parse_int(primary['lc_type1'])

        chosen = primary
        flag = None
        primary_outside_bbox = (
            actual_primary is None
            and parse_float(primary.get('ef')) is None
            and parse_float(primary.get('pixel_albedo')) is None
        )
        if primary_outside_bbox:
            # Primary coord landed outside the regional bbox (sampled
            # image returns None). Fall back to first alternate with
            # any valid lc_type1 sample; prefer one that matches expected.
            preferred = next((r for r in rows_sorted[1:]
                              if parse_int(r['lc_type1']) == expected), None) if expected is not None else None
            fallback = preferred or next((r for r in rows_sorted[1:]
                                          if parse_int(r['lc_type1']) is not None), None)
            if fallback:
                chosen = dict(fallback)
                flag = (f'switched_from_{primary["pixel_id"]}_to_{fallback["pixel_id"]} '
                        f'(primary outside bbox, no sampled values)')
            else:
                flag = f'primary_outside_bbox_and_no_alternate_with_valid_sample'
        elif expected is not None and actual_primary is not None and actual_primary != expected:
            # Primary in-bbox but wrong LC class; look for an alternate
            # whose LC class matches expected.
            match = next((r for r in rows_sorted[1:]
                          if parse_int(r['lc_type1']) == expected), None)
            if match:
                chosen = dict(match)
                flag = f'switched_from_{primary["pixel_id"]}_to_{match["pixel_id"]}_for_lc_match'
            else:
                flag = (f'no_alternate_matches_lc_class_{expected};'
                        f'using_primary_with_actual_class_{actual_primary}')
        # Stamp the canonical root id on the chosen row so downstream
        # lookups (acceptance gates) match by stable id regardless of
        # whether an alternate was substituted.
        chosen = dict(chosen)
        chosen['pixel_id'] = root
        primaries[root] = (chosen, flag)
    return primaries, by_id_root


def pick_disabled_control(eco_centroid_rows, eco_ref_index):
    """
    Find the first disabled ecoregion in either region (preferring IDF
    for proximity), and return the ecoregion-centroid sample for it.
    Returns (row, finding_message). row may be None if no disabled
    ecoregion exists in IDF or Tapajós.
    """
    # Determine disabled ecoregion ids per region.
    disabled = [
        (region, eco_id, ref)
        for (region, eco_id), ref in eco_ref_index.items()
        if ref['albedo_modifier_status'] == 'disabled'
    ]
    if not disabled:
        return None, ('no_disabled_ecoregion_in_idf_or_tapajos — '
                      'trust gate did not fire on either region; this is itself a Phase 0 finding')

    # Sort: IDF first (we want the panel pixel near the other panel pixels)
    disabled.sort(key=lambda x: (x[0] != 'idf', x[1]))
    region, eco_id, ref = disabled[0]

    candidates = [r for r in eco_centroid_rows
                  if r['region_code'] == region and r['ecoregion_id'] == eco_id]
    if not candidates:
        return None, (f'disabled_ecoregion_{eco_id}_in_{region}_has_no_centroid_sample — '
                      'check script 37 ecoregion centroid coverage')

    chosen = candidates[0]
    chosen = dict(chosen)  # mutable copy
    chosen['pixel_id'] = 'p6_disabled_control'
    chosen['regime']   = 'disabled_ecoregion_control'
    chosen['expected_lc_class'] = ''
    return chosen, f'selected_disabled_ecoregion_{ref["ecoregion_name"]}_reason_{ref["albedo_modifier_disabled_reason"]}'


# ── Score table builder ──────────────────────────────────────────────
def score_panel(panel_rows, eco_ref_index):
    """Returns list of dicts ready for CSV / markdown output."""
    out = []
    for row in panel_rows:
        ef           = parse_float(row['ef'])
        pixel_albedo = parse_float(row['pixel_albedo'])
        eco_id       = row['ecoregion_id']
        region       = row['region_code']

        ref = eco_ref_index.get((region, eco_id), {})
        ref_p50 = ref.get('albedo_ref_p50')
        status  = ref.get('albedo_modifier_status', 'no_reference')
        reason  = ref.get('albedo_modifier_disabled_reason')

        deficit = albedo_deficit_norm(pixel_albedo, ref_p50)
        v211    = (10.0 * clip01(ef)) if ef is not None else None

        scores  = {f'hrc_v2_2_w{int(w*100):02d}': hrc_v22(ef, deficit, w, status) for w in WEIGHTS}
        deltas  = {
            f'delta_w{int(w*100):02d}': (
                None if (scores[f'hrc_v2_2_w{int(w*100):02d}'] is None or v211 is None)
                else scores[f'hrc_v2_2_w{int(w*100):02d}'] - v211
            )
            for w in WEIGHTS
        }

        out.append({
            'pixel_id':      row['pixel_id'],
            'regime':        row['regime'],
            'region_code':   region,
            'longitude':     row.get('longitude', ''),
            'latitude':      row.get('latitude', ''),
            'lc_type1':      row.get('lc_type1', ''),
            'expected_lc_class': row.get('expected_lc_class', ''),
            'ecoregion_name': row.get('ecoregion_name', ''),
            'biome_name':    row.get('biome_name', ''),
            'ef':            ef,
            'pixel_albedo':  pixel_albedo,
            'albedo_ref_p50': ref_p50,
            'albedo_deficit_norm': deficit,
            'albedo_modifier_status': status,
            'albedo_modifier_disabled_reason': reason,
            'hrc_v2_1_1':    v211,
            **scores,
            **deltas,
        })
    return out


# ── Acceptance evaluation (handoff §6.3) ─────────────────────────────
def evaluate_acceptance(panel_scores):
    """
    Returns list of (severity, gate_name, pass_bool, detail_str).

    Hard gates are evaluated only at the default weight (w=0.15) per
    handoff v1.1 §6.2; w=0.10 / 0.20 results are sensitivity-sweep
    only, reported in the panel-scores table without a pass/fail
    judgement. The 1e-9 epsilon absorbs floating-point loss at the
    edge of a threshold (e.g. 1.0 − 0.9 = 0.09999...).
    """
    EPS = 1e-9
    w_key = f'hrc_v2_2_w{int(DEFAULT_WEIGHT*100):02d}'
    by_id = {p['pixel_id']: p for p in panel_scores}
    results = []

    def hard_within(pid, baseline, tol):
        p = by_id.get(pid)
        if not p:
            return (f'{pid} present in panel', False, 'pixel missing from panel — pipeline incomplete')
        score = p[w_key]
        if score is None:
            return (f'{pid} v2.2(w={DEFAULT_WEIGHT}) within ±{tol} of {baseline}',
                    False, 'score is None — EF or reference missing')
        ok = abs(score - baseline) <= tol + EPS
        return (f'{pid} v2.2(w={DEFAULT_WEIGHT:.2f}) within ±{tol} of v2.1.1 baseline {baseline}',
                ok, f'v2.2={score:.2f}, |Δ|={abs(score-baseline):.2f}')

    def hard_drop(pid, min_drop):
        p = by_id.get(pid)
        if not p:
            return (f'{pid} present in panel', False, 'pixel missing from panel — pipeline incomplete')
        score = p[w_key]
        v211  = p['hrc_v2_1_1']
        if score is None or v211 is None:
            return (f'{pid} v2.2(w={DEFAULT_WEIGHT}) drops by ≥ {min_drop}',
                    False, 'score is None — EF or reference missing')
        drop = v211 - score
        ok = drop >= min_drop - EPS
        return (f'{pid} v2.2(w={DEFAULT_WEIGHT:.2f}) drops by ≥ {min_drop} vs v2.1.1',
                ok, f'v2.1.1={v211:.2f}, v2.2={score:.2f}, drop={drop:.2f}')

    # Hard gates from handoff v1.2 §6.3.
    # K67 and BR-163 use ±0.10 identity-bound while Tapajós is on Path A
    # fallback (v2.2 = v2.1.1 by construction when ecoregion is disabled).
    # When Tapajós Path B reference lands in Phase 1, BR-163 should revert
    # to "drop ≥ 0.20".
    results.append(('HARD', *hard_within('p1_frfon', 5.70, 0.10)))
    results.append(('HARD', *hard_within('p3_k67',   5.62, 0.10)))
    results.append(('HARD', *hard_within('p4_br163', 5.64, 0.10)))
    results.append(('HARD', *hard_drop  ('p2_beauce',      0.15)))
    results.append(('HARD', *hard_drop  ('p5_paris',       0.02)))

    return results


# ── Trust-gate-fire summary ──────────────────────────────────────────
def summarise_trust_gate(eco_ref_index):
    by_region = {}
    for (region, eco_id), ref in eco_ref_index.items():
        by_region.setdefault(region, {'enabled': 0, 'disabled': 0, 'reasons': {}})
        status = ref['albedo_modifier_status']
        by_region[region][status] = by_region[region].get(status, 0) + 1
        if status == 'disabled':
            r = ref['albedo_modifier_disabled_reason'] or 'unknown'
            by_region[region]['reasons'][r] = by_region[region]['reasons'].get(r, 0) + 1
    return by_region


# ── CSV + markdown writers ───────────────────────────────────────────
def write_panel_csv(rows, path):
    if not rows:
        return
    fieldnames = list(rows[0].keys())
    with open(path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: ('' if v is None else v) for k, v in row.items()})


def write_eco_ref_csv(eco_ref_index, path):
    if not eco_ref_index:
        return
    fieldnames = ['region_code', 'ecoregion_id', 'ecoregion_name', 'biome_num', 'biome_name',
                  'albedo_ref_p25', 'albedo_ref_p50', 'albedo_ref_p75', 'albedo_ref_iqr',
                  'centroid_count_kept', 'pa_coverage_frac',
                  'ecoregion_area_km2_local', 'ecoregion_area_km2_full',
                  'albedo_modifier_status', 'albedo_modifier_disabled_reason']
    with open(path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for (region, eco_id), ref in sorted(eco_ref_index.items()):
            writer.writerow({
                'region_code':   region,
                'ecoregion_id':  eco_id,
                **{k: ('' if ref.get(k) is None else ref.get(k)) for k in fieldnames if k not in ('region_code', 'ecoregion_id')}
            })


def fmt(v, precision=3):
    if v is None or v == '':
        return '—'
    if isinstance(v, float):
        return f'{v:.{precision}f}'
    return str(v)


def render_markdown(panel_scores, acceptance, trust_summary, pixel_picks_log,
                    disabled_control_finding, v22_reference=None,
                    w_default=DEFAULT_WEIGHT):
    lines = []
    lines.append('# Albedo modifier — Phase 0 diagnostic report\n')
    lines.append('Auto-generated by `scripts/albedo_modifier_phase0_analysis.py`. '
                 'See `docs/HRC_albedo_modifier_claude_code_handoff_v1_1.md` for context.\n')

    # ── Acceptance gates ─────────────────────────────────────────────
    lines.append('## Acceptance gates\n')
    lines.append('| Severity | Gate | Pass | Detail |')
    lines.append('|---|---|---|---|')
    for severity, name, ok, detail in acceptance:
        mark = 'PASS' if ok else 'FAIL'
        lines.append(f'| {severity} | {name} | {mark} | {detail} |')
    lines.append('')

    # ── Panel scores table ───────────────────────────────────────────
    lines.append('## Panel pixel scores\n')
    lines.append('Per-pixel v2.1.1 baseline vs v2.2 at three weights. '
                 '`Δ` is `v2.2 − v2.1.1`. Negative Δ = v2.2 penalises the pixel.\n')
    lines.append('| Pixel | Regime | EF | α_pixel | α_ref_p50 | deficit | status | v2.1.1 | v2.2(0.10) | Δ | v2.2(0.15) | Δ | v2.2(0.20) | Δ |')
    lines.append('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for p in panel_scores:
        lines.append(
            f'| {p["pixel_id"]} | {p["regime"]} | '
            f'{fmt(p["ef"])} | {fmt(p["pixel_albedo"])} | {fmt(p["albedo_ref_p50"])} | '
            f'{fmt(p["albedo_deficit_norm"])} | {p["albedo_modifier_status"]} | '
            f'{fmt(p["hrc_v2_1_1"], 2)} | '
            f'{fmt(p["hrc_v2_2_w10"], 2)} | {fmt(p["delta_w10"], 2)} | '
            f'{fmt(p["hrc_v2_2_w15"], 2)} | {fmt(p["delta_w15"], 2)} | '
            f'{fmt(p["hrc_v2_2_w20"], 2)} | {fmt(p["delta_w20"], 2)} |'
        )
    lines.append('')

    # ── Per-pixel change distribution ────────────────────────────────
    lines.append('## Change distribution at default weight (w = 0.15)\n')
    deltas = [p['delta_w15'] for p in panel_scores if p['delta_w15'] is not None]
    if deltas:
        lines.append(f'- N pixels with computed Δ: {len(deltas)}')
        lines.append(f'- Min Δ: {min(deltas):.2f}')
        lines.append(f'- Max Δ: {max(deltas):.2f}')
        lines.append(f'- Mean Δ: {sum(deltas)/len(deltas):+.2f}')
        # Per-pixel listing (matches handoff "report per-pixel, not just means")
        lines.append('\nPer-pixel deltas:')
        for p in panel_scores:
            if p['delta_w15'] is not None:
                lines.append(f'  - `{p["pixel_id"]}` ({p["regime"]}): Δ = {p["delta_w15"]:+.2f}')
    else:
        lines.append('No deltas computable — every panel pixel has a missing input.')
    lines.append('')

    # ── Trust gate fire rate ─────────────────────────────────────────
    lines.append('## Trust-the-data gate fire rate\n')
    lines.append('Per region, count of ecoregions enabled vs disabled by the gate. '
                 'Disabled-reason breakdown shows why the gate fired.\n')
    lines.append('| Region | Enabled | Disabled | Disabled reasons |')
    lines.append('|---|---|---|---|')
    for region, summary in sorted(trust_summary.items()):
        reasons = '; '.join(f'{r} ({c})' for r, c in summary.get('reasons', {}).items()) or '—'
        lines.append(f'| {region} | {summary.get("enabled", 0)} | {summary.get("disabled", 0)} | {reasons} |')
    lines.append('')

    # ── v2.2 reference shift (handoff v1.1 §7.5) ─────────────────────
    lines.append('## Reference shift under v2.2 (per ecoregion)\n')
    if not v22_reference:
        lines.append('No per-centroid audit CSVs provided (`hrc_albedo_centroid_audit_*_phase0.csv`). '
                     'Skipping `reference_p90_v2_2` calculation. Re-run scripts 35 and 36 to produce '
                     'these audit files; they are mandatory per handoff v1.1 §6.3 (new row) and §7.5.')
    else:
        lines.append(f'Per-ecoregion p90 of HRC scores, v2.1.1 vs v2.2 (at default w={w_default}). '
                     'Uses every WDPA centroid for the ecoregion (matches script 33 / 34 selection); '
                     'no trust filter, so this is apples-to-apples comparable to the existing '
                     '`hrc_reference` column. `shift` = v2.2 − v2.1.1; a negative shift means the '
                     'v2.2 reference is lower than v2.1.1 (degraded centroids penalised by the '
                     'albedo modifier).\n')
        lines.append('A handoff-flagged threshold: if shift exceeds ±0.30 for any ecoregion, '
                     'investigate before Phase 1 — the median-centroid assumption may not be holding.\n')
        lines.append('| Region | Ecoregion | N | v2.1.1 p90 | v2.2 p90 | Shift | Anchor (v2.1.1) | Anchor Δ | Status |')
        lines.append('|---|---|---|---|---|---|---|---|---|')
        for (region, eco_id), ref in sorted(v22_reference.items()):
            anchor = KNOWN_V211_REFERENCES.get(eco_id)
            anchor_delta = None if (anchor is None or ref['hrc_v2_1_1_p90'] is None) else (ref['hrc_v2_1_1_p90'] - anchor)
            lines.append(
                f'| {region} | {ref["ecoregion_name"]} ({eco_id}) | {ref["n_centroids"]} | '
                f'{fmt(ref["hrc_v2_1_1_p90"], 2)} | {fmt(ref["hrc_v2_2_p90"], 2)} | '
                f'{fmt(ref["shift"], 2)} | {fmt(anchor, 2)} | {fmt(anchor_delta, 2)} | '
                f'{ref["albedo_modifier_status"]} |'
            )
        # Quick-eye threshold check
        flagged = [
            (region, eco_id, ref) for (region, eco_id), ref in v22_reference.items()
            if ref['shift'] is not None and abs(ref['shift']) > 0.30
        ]
        if flagged:
            lines.append('')
            lines.append('**Flagged for review (|shift| > 0.30):**')
            for region, eco_id, ref in flagged:
                lines.append(f'  - `{region}` ecoregion {eco_id} ({ref["ecoregion_name"]}): '
                             f'shift = {ref["shift"]:+.2f}')
        # Anchor sanity check
        anchored_off = [
            (region, eco_id, ref, KNOWN_V211_REFERENCES.get(eco_id))
            for (region, eco_id), ref in v22_reference.items()
            if eco_id in KNOWN_V211_REFERENCES
            and ref['hrc_v2_1_1_p90'] is not None
            and abs(ref['hrc_v2_1_1_p90'] - KNOWN_V211_REFERENCES[eco_id]) > 0.30
        ]
        if anchored_off:
            lines.append('')
            lines.append('**Anchor mismatch (v1.1 pipeline diverges from script 33 / 34 baseline by > 0.30):**')
            for region, eco_id, ref, anchor in anchored_off:
                lines.append(f'  - `{region}` ecoregion {eco_id}: v1.1 p90 = '
                             f'{ref["hrc_v2_1_1_p90"]:.2f} vs anchor {anchor:.2f} '
                             f'(Δ = {ref["hrc_v2_1_1_p90"] - anchor:+.2f}). '
                             'Investigate the centroid set or pipeline divergence.')
    lines.append('')

    # ── Pixel selection audit ────────────────────────────────────────
    lines.append('## Pixel selection audit\n')
    lines.append('Records cases where the illustrative coordinate from the handoff was substituted '
                 'with an alternate that better matches the regime\'s expected MCD12Q1 LC class.\n')
    if pixel_picks_log:
        for root, flag in sorted(pixel_picks_log.items()):
            if flag:
                lines.append(f'- `{root}`: {flag}')
            else:
                lines.append(f'- `{root}`: primary coord matched expected LC class')
    if disabled_control_finding:
        lines.append(f'- `p6_disabled_control`: {disabled_control_finding}')
    lines.append('')

    # ── Recommendation skeleton ──────────────────────────────────────
    lines.append('## Recommendation (to be reviewed and finalised in HRC_albedo_modifier_phase0_findings_v1.md)\n')
    lines.append(f'- Default weight `w` carried forward into Phase 1: **{w_default}** '
                 '(swept at 0.10 / 0.15 / 0.20 above; project owner picks).')
    lines.append('- See acceptance-gate table above. If hard gates fail, Phase 1 must not start until '
                 'the formula or expected-outcome thresholds are revised.')
    lines.append('- Trust-gate fire rate within IDF + Tapajós is a leading indicator for global Phase 1 impact; '
                 'if the gate disables most ecoregions in this small sample, the modifier\'s headline impact '
                 'on a global rollout will be small.')
    lines.append('')

    return '\n'.join(lines)


# ── Main ─────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--input-dir', default='~/Downloads/',
                    help='Directory containing the four Phase 0 CSVs (default ~/Downloads/)')
    ap.add_argument('--output-dir', default=str(OUTPUT_DIR),
                    help=f'Directory for analysis outputs (default {OUTPUT_DIR})')
    args = ap.parse_args()

    input_dir  = os.path.expanduser(args.input_dir)
    output_dir = Path(os.path.expanduser(args.output_dir))
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f'Reading inputs from {input_dir}')
    inputs = load_inputs(input_dir)

    eco_ref_index = build_eco_reference_index(inputs['idf_ref'], inputs['tapajos_ref'])
    print(f'Ecoregion references: {len(eco_ref_index)} '
          f'(IDF {len(inputs["idf_ref"])}, Tapajós {len(inputs["tapajos_ref"])})')

    # Pick representative panel pixels (#1–#5) and disabled control (#6)
    primaries, _ = pick_panel_representatives(inputs['panel'])
    pixel_picks_log = {root: flag for root, (chosen, flag) in primaries.items()}
    panel_chosen = [chosen for (chosen, _flag) in primaries.values()]

    disabled_control, disabled_finding = pick_disabled_control(inputs['eco_centroids'], eco_ref_index)
    if disabled_control:
        panel_chosen.append(disabled_control)

    panel_scores = score_panel(panel_chosen, eco_ref_index)
    acceptance   = evaluate_acceptance(panel_scores)
    trust_summary = summarise_trust_gate(eco_ref_index)

    # v1.1 — reference_p90_v2_2 per ecoregion (handoff §7.5)
    v22_ref_idf     = compute_v22_reference_per_ecoregion(
        inputs['idf_audit'],     eco_ref_index, 'idf',     DEFAULT_WEIGHT)
    v22_ref_tapajos = compute_v22_reference_per_ecoregion(
        inputs['tapajos_audit'], eco_ref_index, 'tapajos', DEFAULT_WEIGHT)
    v22_ref_combined = {('idf',     k): v for k, v in v22_ref_idf.items()}
    v22_ref_combined.update({('tapajos', k): v for k, v in v22_ref_tapajos.items()})

    # Console summary
    print('\n=== Acceptance gates ===')
    for severity, name, ok, detail in acceptance:
        mark = 'PASS' if ok else 'FAIL'
        print(f'  [{severity}] [{mark}] {name}  ({detail})')

    print('\n=== Trust-gate fire rate ===')
    for region, summary in sorted(trust_summary.items()):
        print(f'  {region}: enabled={summary.get("enabled", 0)} disabled={summary.get("disabled", 0)}')

    # Outputs
    panel_csv_path  = output_dir / 'diagnostic_panel_scores_v1.csv'
    eco_ref_path    = output_dir / 'ecoregion_reference_summary_v1.csv'
    md_path         = output_dir / 'albedo_modifier_phase0_report_v1.md'

    write_panel_csv(panel_scores, panel_csv_path)
    write_eco_ref_csv(eco_ref_index, eco_ref_path)
    md_path.write_text(render_markdown(
        panel_scores, acceptance, trust_summary, pixel_picks_log, disabled_finding,
        v22_ref_combined,
    ))

    print(f'\nWrote: {panel_csv_path}')
    print(f'Wrote: {eco_ref_path}')
    print(f'Wrote: {md_path}')


if __name__ == '__main__':
    main()
