# HRC Scoring Conventions — Source of Truth

| Field | Value |
|---|---|
| **Version** | 1.0 |
| **Date** | 2026-07-22 |
| **Status** | Authoritative, in-repo. Any new tier or region **inherits these by reference** — do not re-derive them. |
| **Why this exists** | The 30 m US Phase-0/1 work re-implemented the HRC score from scratch and silently departed from the ratio-of-annual-sums convention (it used mean-of-monthly-ratios), biasing biomes in opposite directions. The convention lived only in external docs and in one in-repo script (`test_c_frfon.py`), with no single binding inheritance point. This file is that point. |

Terms: HRC = Heat Regulation Capacity. EF = evaporative fraction = latent heat flux ÷ available energy. Available energy = net radiation − ground heat flux. EC = eddy covariance (flux-tower method).

---

## 1. The binding conventions (C1 … C8)

Every HRC score — production or demonstration tier, any region — MUST satisfy all of these. Each maps to a locked decision in the 30 m US programme (D-F … D-J) and to the pre-build conformance gate (§2).

| # | Convention | Rule |
|---|---|---|
| **C1** | **Aggregation = ratio-of-annual-sums** | `HRC = 10 × ( Σ_m latent heat_m ) / ( Σ_m available energy_m )` over unmasked months. **Never** mean-of-monthly-ratios for the headline (it over-weights low-energy months and biases EF↔energy-correlated biomes in opposite directions). Mean-of-ratios may be reported only as a labelled sensitivity. *(D-F)* |
| **C2** | **Temporal window = full annual cycle** | Compute over all 12 months, not a growing-season window tuned to one biome. Winter handled by masking (C4), not by truncating the window. *(D-D)* |
| **C3** | **Reference = multi-year** | A production reference spans ≥ one wet + one dry year; report the interannual range. A single-year reference may prototype a build but is not production-ready. *(D-I)* |
| **C4** | **One uniform quality/mask rule** | Exclude a month if EF ∉ [−0.05, 1.05], **or** monthly mean available energy < 25 W/m², **or** valid coverage < 0.50. Identical for every reference site AND the pipeline. No per-site exceptions. Document thresholds; disclose borderline cases as sensitivities. **Closure is NOT a mask criterion.** *(D-G)* |
| **C5** | **Matched-methodology reference** | Define a reference that measures the *same quantity* as the thing it validates. A budget-closed satellite product is compared only to an all-hour ratio-of-annual-sums tower reference, over the **intersection** of valid periods. An operational (strict-mask, partner-facing) reference may exist separately. *(D-H)* |
| **C6** | **Closure recorded, not corrected** | Energy-balance closure is reported for provenance; it is never silently applied to the score. A chronically poor-closing site (e.g. semi-arid forest ~0.5) has valid physical EF. *(project plan Phase 1)* |
| **C7** | **Sign & unit conventions match production** | Absolute-value latent heat where production uses it; net radiation = net solar + net thermal with thermal negative (satellite), or measured all-wave net radiation (tower). Confirm the |·| convention per side; do not assume. *(see memory `feedback_gee_hrc_formula`: never abs() thermal radiation in netRad)* |
| **C8** | **Validation checks the monthly curve** | Where seasonality carries the signal, the gate checks the monthly EF trajectory, not only the annual scalar (e.g. two sites with equal annual EF but opposite summer behaviour). *(D-J)* |

---

## 2. Pre-build conformance gate (MANDATORY before any new tier/region)

Run this before writing pipeline code for a new tier. Every item must pass; record the evidence.

1. **Aggregation identical to production** — verified by *reproducing a known production number* with the new code, not by inspection. (C1)
2. **Temporal window = full annual cycle**, not a biome-tuned season. (C2)
3. **Reference computed over multiple years**; interannual range documented. (C3)
4. **One uniform quality/mask rule** across all reference sites and the pipeline; thresholds documented; borderline cases disclosed. (C4)
5. **Matched-methodology reference defined**; gate compares over the intersection of valid periods. (C5)
6. **Sign/unit conventions match production.** (C7)
7. **Flux-tower data quality confirmed at feasibility** — primary vs secondary EC system for the target year, annual closure, ground-heat-flux presence, monthly coverage — never deferred to build. (feeds C5/C6)
8. **Validation checks the monthly curve** wherever seasonality carries the signal. (C8)

---

## 3. Provenance

- Locked decisions D-F … D-J: `docs/HRC_30m_test_sites_usa_phase0_1_completion_report_v1_0.md` §2.
- Root-cause analysis + the recurrence-prevention feedback: `HRC_30m_test_sites_methodology_feedback_handoff_v1_0.md`.
- Reference implementation of C1/C4/C6: `tower.py` (headline ratio-of-annual-sums, uniform D-G mask, closure recorded).
- In-repo precedent that already used ratio-of-annual-sums (the convention that should have been inherited): `test_c_frfon.py:82`.

Any change to a convention here is a project-owner decision and must be reflected in `tower.py`, the pipeline, and every dependent tier — not made locally in one script.
