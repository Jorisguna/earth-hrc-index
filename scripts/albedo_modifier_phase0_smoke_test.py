"""
albedo_modifier_phase0_smoke_test.py — Phase −1 synthetic smoke test.

MANDATORY pre-flight gate before any Earth Engine compute is spent
on the Phase 0 diagnostic. Per HRC_albedo_modifier_claude_code_handoff_v1_2.md
§6.6 — this exists because the v1.0 additive formula bug was caught
by exactly this test before it consumed GEE quota.

The test:
  1. Hard-codes the five (EF, deficit) priors from handoff
     v1.2 §6.2 (panel pixels 1 through 5). v1.2 priors are MEASURED
     values from the first Phase 0 run, not synthetic estimates.
  2. Computes v2.2 under the multiplicative form at w ∈ {0.10, 0.15, 0.20}.
  3. Checks every per-pixel acceptance condition from v1.2 §6.3.
  4. Exits non-zero on any failure with a clear error message.

If this test fails after a formula change, do NOT proceed to GEE. Either
the formula is wrong or the priors / acceptance bounds in v1.2 §6.2 / §6.3
need to be revised — either way it is a documentation update before any
compute is spent.

Usage:
  python3 scripts/albedo_modifier_phase0_smoke_test.py

Exit codes:
  0 — all checks passed; safe to proceed to Phase 0 GEE exports
  1 — at least one check failed
"""
import sys

# ── Formula (v1.1 multiplicative form) ──────────────────────────────
# HRC_v2_2 = 10 × EF × (1 − w × deficit_norm)
# When deficit_norm = 0: HRC_v2_2 = 10 × EF (identical to v2.1.1)
def hrc_v22(ef, deficit_norm, w):
    return 10.0 * ef * (1.0 - w * deficit_norm)


def hrc_v211(ef):
    return 10.0 * ef


# ── Priors from handoff v1.2 §6.2 ───────────────────────────────────
# Each entry: (pixel_id, EF, deficit, v2.1.1 baseline, gate fn).
# v1.2: priors are MEASURED values from the first Phase 0 GEE run, not
# synthetic estimates. K67 and BR-163 use deficit=0 because Tapajós
# centroid sampling (Path A) cannot meet N≥20; v2.2 = v2.1.1 by identity
# under Path A fallback. They will be re-evaluated under Path B in
# Phase 1.

# 1e-9 epsilon absorbs floating-point loss at the edge of a threshold
# (e.g. 1.0 - 0.9 = 0.09999...9 in IEEE 754, which would spuriously
# fail a `>= 0.10` gate).
EPS = 1e-9


def gate_within(tol):
    def check(v22, v211):
        d = abs(v22 - v211)
        return (d <= tol + EPS, f'|Δ|={d:.3f} vs ±{tol} tolerance')
    return check


def gate_drop_at_least(min_drop):
    def check(v22, v211):
        drop = v211 - v22
        return (drop >= min_drop - EPS, f'drop={drop:+.3f} vs ≥{min_drop} required')
    return check


PRIORS = [
    # (pixel_id, EF, deficit, v2.1.1 baseline, gate function, gate label)
    # v1.2: measured values from first Phase 0 run.
    ('p1_frfon',  0.570, 0.05, 5.70, gate_within(0.10),        'within ±0.10 of v2.1.1'),
    ('p2_beauce', 0.607, 0.18, 6.07, gate_drop_at_least(0.15), 'drop ≥ 0.15 vs v2.1.1'),
    # K67 and BR-163: Path A fallback (identity) until Path B reference
    # is added in Phase 1. Hard gates pass by construction (drop = 0
    # within ±0.10, drop = 0 satisfies "no fallback drop required").
    ('p3_k67',    0.562, 0.00, 5.62, gate_within(0.10),        'within ±0.10 of v2.1.1 (Path A fallback)'),
    ('p4_br163',  0.564, 0.00, 5.64, gate_within(0.10),        'within ±0.10 of v2.1.1 (Path A fallback; Path B test deferred)'),
    ('p5_paris',  0.565, 0.03, 5.65, gate_drop_at_least(0.02), 'drop ≥ 0.02 vs v2.1.1 (mosaic suburb at 500 m)'),
]

WEIGHTS = [0.10, 0.15, 0.20]
DEFAULT_WEIGHT = 0.15  # Hard gates are calibrated for this weight per §6.2.


def main():
    print('Phase −1 smoke test — multiplicative formula against v1.2 priors')
    print('=' * 72)

    # Construction check first: deficit = 0 ⇒ v2.2 = 10 × EF exactly.
    construction_ef = 0.6
    for w in WEIGHTS:
        got = hrc_v22(construction_ef, 0.0, w)
        expected = 10.0 * construction_ef
        if abs(got - expected) > 1e-12:
            print(f'  [FAIL] Construction: hrc_v22(EF={construction_ef}, deficit=0, w={w}) '
                  f'returned {got}, expected {expected}')
            sys.exit(1)
    print('  [PASS] Construction: deficit=0 → v2.2 = 10×EF (exact, all w)')

    # Construction check: deficit = 1 ⇒ v2.2 = 10 × EF × (1 − w).
    for w in WEIGHTS:
        got = hrc_v22(construction_ef, 1.0, w)
        expected = 10.0 * construction_ef * (1.0 - w)
        if abs(got - expected) > 1e-12:
            print(f'  [FAIL] Construction: deficit=1, w={w} returned {got}, '
                  f'expected {expected}')
            sys.exit(1)
    print('  [PASS] Construction: deficit=1 → v2.2 = 10×EF×(1−w) (exact, all w)')

    print()
    print(f'Per-pixel hard gates at default w={DEFAULT_WEIGHT} (handoff v1.2 §6.3):')
    print()

    fail_count = 0
    for pid, ef, deficit, baseline, gate_fn, gate_label in PRIORS:
        v22 = hrc_v22(ef, deficit, DEFAULT_WEIGHT)
        v211 = hrc_v211(ef)
        # v2.1.1 baseline sanity check first
        if abs(v211 - baseline) > 0.05:
            print(f'  [WARN] {pid}: derived v2.1.1 = {v211:.2f} differs from '
                  f'stated baseline {baseline:.2f} by > 0.05. '
                  f'Check EF prior in handoff §6.2.')
        ok, detail = gate_fn(v22, baseline)
        mark = 'PASS' if ok else 'FAIL'
        print(f'  [{mark}] {pid}: EF={ef:.3f} deficit={deficit:.2f} '
              f'v2.1.1={baseline:.2f} v2.2={v22:.2f}  '
              f'gate={gate_label}  ({detail})')
        if not ok:
            fail_count += 1

    # Sensitivity sweep — informational only, no gating.
    print()
    print(f'Sensitivity sweep at w ∈ {WEIGHTS} (informational, not gated):')
    print()
    header = f'  {"pixel":<11} {"EF":>6} {"deficit":>8} {"v2.1.1":>8} '
    header += ' '.join(f'{"w="+format(w,".2f"):>8}' for w in WEIGHTS)
    print(header)
    for pid, ef, deficit, baseline, _gate, _label in PRIORS:
        row = f'  {pid:<11} {ef:>6.3f} {deficit:>8.2f} {baseline:>8.2f} '
        row += ' '.join(f'{hrc_v22(ef, deficit, w):>8.2f}' for w in WEIGHTS)
        print(row)

    print()
    if fail_count == 0:
        print(f'All hard gates passed at w={DEFAULT_WEIGHT}. '
              'Safe to proceed to Phase 0 GEE exports.')
        sys.exit(0)
    else:
        print(f'{fail_count} hard gate(s) failed at w={DEFAULT_WEIGHT}. '
              'DO NOT submit GEE tasks.')
        print('Investigate the formula change or revise handoff §6.2 / §6.3 priors.')
        sys.exit(1)


if __name__ == '__main__':
    main()
