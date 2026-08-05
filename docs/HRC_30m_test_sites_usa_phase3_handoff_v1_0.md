# HRC 30 m US Test Sites — Phase 3 Build Handoff (`validate.py`)

| Field | Value |
|---|---|
| **Version** | 1.0 |
| **Date** | 2026-08-04 |
| **Status** | Phase 2 core built and running (`scripts/pipeline.js`). **Gate P3 has not been run.** Everything to date is diagnostics and console prints — no pass/fail check exists. This is the brief to build `validate.py`. |
| **Purpose** | Self-contained handoff so a new session can build `validate.py` without the prior conversation. Read this + the four named files; you need nothing else. |
| **Read-first** | `docs/HRC_scoring_conventions_source_of_truth.md` (C1–C8, binding), `docs/HRC_30m_test_sites_usa_phase0_1_completion_report_v1_0.md` (§2 D-F…D-J, §5 tower refs), `scripts/pipeline.js` (what it exports today), `tower.py` (the D-G/D-F reference implementation Phase 3 must match, not re-derive). |

---

## 0. How to use this handoff (new thread)

You are building **Phase 3: `validate.py`** — the script that decides whether the 30 m pipeline passes against the flux towers, picks the D2 denominator winner, and either clears or blocks Phase 4 (import). This is a **gate**, not a report: it has a pass/fail outcome, and nothing gets imported if it fails.

**Orientation actions (do these first):**
1. Read `docs/HRC_scoring_conventions_source_of_truth.md` §1 (C1–C8) — every convention Phase 3 must honor, especially **C1 (ratio-of-annual-sums, never mean-of-monthly-ratios)** and **C8 (validate the monthly curve, not just the annual scalar)**.
2. Read §3 below **before writing any aggregation code** — the current pipeline output cannot support a correct C1-compliant intersection re-aggregation without a small, specified pipeline.js patch. Do that patch first (§3.1, §8).
3. Skim `tower.py` — it is the reference implementation of the exact mask and aggregation rules Phase 3 must mirror on the pipeline side. Do not reinvent them.

**Do NOT, in this phase:**
- Write migration 009, `import.py`, or touch the database. Phase 3 is validation-only; Phase 4 starts only after this gate passes and the D2 decision is recorded.
- Modify `pipeline.js`'s methodology (denominator formulas, D-G thresholds) as part of this work — if `validate.py` finds a pipeline bug, that's a Phase 2 fix, done separately and re-validated. The one exception is the §3.1 export patch, which adds columns without changing any computation.
- Pick the D2 winner casually in conversation. It gets picked by `validate.py`'s output, recorded in writing (§4.4), before anyone imports anything.

---

## 1. What Phase 3 actually decides

Phase 2 built two candidate denominators (A: clear-sky 30 m Landsat; B: all-sky ERA5 + texture) and pre-registered that the tower data — not engineering judgment — picks the winner (decision D2). Phase 3 is that adjudication. It also carries a second, independently important job that the original project plan under-weighted: an **external, independently-verified investigation** (not part of this pipeline; see `docs/HRC_scoring_conventions_source_of_truth.md`'s sibling findings, referenced in the Phase 2 review artifact) found that OpenET's own latent-heat numerator has a **hard floor** at senescing Mediterranean wildland sites (Tonzi/Vaira) — an upstream limitation no denominator choice can fix. `validate.py` must be able to tell the difference between "the denominator is wrong" and "the numerator has a floor no denominator can reach," because the gate's diagnosis, not just its pass/fail bit, is what Phase 4 needs.

---

## 2. Locked decisions that constrain Phase 3

| ID | Decision | What it means for `validate.py` |
|---|---|---|
| **D2** | Both denominators built in Phase 2; **tower adjudicates the winner here** | Compute the gate for A and B independently; report both; state the winner with evidence (§4.4). Do not assume B wins even though it's the obvious practical answer — the record has to show why. |
| **D-F / C1** | Aggregation = **ratio-of-annual-sums**, `10 × ΣLE / Σavail`, never mean-of-monthly-ratios | Applies to the **intersection-subset** re-aggregation too, not just the full-year composite. This is the constraint the current footprint CSV schema can't satisfy without the §3.1 patch. |
| **D-G** | Uniform month-exclusion mask, identical rule on both sides (`EF∉[−0.05,1.05]` OR `avail<25 W/m²` OR `coverage<0.50`) | Already computed on both sides — pipeline's `masked` column (footprint CSV), tower's `excluded` column (`tower_ef_*.csv`). Use them directly; do not recompute. |
| **D-H** | Compare over **pipeline-valid ∩ tower-valid** months, not either side's valid set alone | The join logic in §3.3. This is the single most load-bearing piece of `validate.py`'s plumbing. |
| **D-J / C8** | Validate the **monthly curve**, not just the annual scalar — Tonzi/Vaira summer divergence is the diagnostic case | Per the external advisory, this should be **load-bearing**: a pipeline that passes the annual tolerance but gets summer ordering backwards should **fail**, not pass with a footnote. §4.2. |
| **D-E** | Metolius forest tolerance is **±0.10** EF (wider than crop/grass's ±0.06), reported with the member-spread band, never a crisp single value | Use ±0.10 for US-Me2 only; ±0.06 for all five other towers (Ne1/2/3 crop, Ton/Var grass — "crop/grass" in the original gate language covers savanna and grassland both). |
| **Gate P3** (implementation plan) | Winner within tolerance, **no month-bias trend**, D2 choice recorded **before** import | "No month-bias trend" was never given a precise statistical test in the source docs — operationalize it as a plotted/tabulated residual-by-month check (§4.1), not a fabricated significance threshold. |

---

## 3. Inputs

### 3.1 Pipeline outputs — REQUIRES A SMALL PATCH FIRST

`scripts/pipeline.js` exports `hrc_30m_<region_code>_footprint.csv` (one row per tower per month) with, today: `tower_id, region_code, month, ef_A_month, ef_B_month, ef_turbulent_month, n_landsat_scenes, masked, et_openet_mm_raw, le_openet_wm2_raw`.

**The problem:** `ef_A_month`/`ef_B_month` are already-divided ratios. To re-aggregate correctly over an arbitrary month subset (the D-H intersection, which is generally *not* the same set of months the pipeline used for its own full-year composite), C1 requires summing the raw numerator and denominator over that subset and dividing once — not averaging the ratios. The footprint CSV doesn't currently carry the raw denominator, so this can't be done correctly as-is.

**The fix** (in the footprint-row-building loop, `scripts/pipeline.js`, where `leSum`, `sums.get('availA_J')`, `sums.get('availB_J')` are already computed and then discarded): export them. Concretely, add to the pushed `ee.Feature` properties:
```js
le_j_month:      leSum,
avail_a_j_month: sums.get('availA_J'),
avail_b_j_month: sums.get('availB_J')
```
and add the three names to `footprintSelectors`. This is a pure export addition — no computation changes, nothing else in the pipeline is affected. **Do this before writing any `validate.py` aggregation logic.**

With that patch, `validate.py` can compute, for any month subset `S`:
```
ef_A(S) = Σ_{m∈S} le_j_month_m / Σ_{m∈S} avail_a_j_month_m
ef_B(S) = Σ_{m∈S} le_j_month_m / Σ_{m∈S} avail_b_j_month_m
```
— genuine ratio-of-annual-sums over exactly the intersection, matching `tower.py`'s own method line-for-line.

### 3.2 Tower references

`tower_ef_US-{Ne1,Ne2,Ne3,Ton,Var,Me2}.csv` (repo root). Columns include `month, sum_le, sum_netrad, sum_g, mean_avail_wm2, ef_rn_g, closure, excluded, note`. The `excluded` boolean is D-G already applied on the tower side — use it directly. `sum_le` and `(sum_netrad − sum_g)` are the tower's raw monthly numerator/denominator, exactly analogous to the pipeline's new `le_j_month`/`avail_*_j_month` — so the tower-side intersection re-aggregation is `Σsum_le / Σ(sum_netrad−sum_g)` over the same month subset, already directly computable from the existing file with no changes needed there.

### 3.3 The D-H intersection — exact join logic

Per tower, per month: `kept = (pipeline.masked == False) AND (tower.excluded == False)`. Join on `(tower_id, month)`. A tower's intersection-valid set is generally a **strict subset** of both sides' individually-valid sets (e.g. Mead loses Aug/Sep to the pipeline's own EF>1.05 exclusion even though the tower doesn't exclude them; US-Ton loses April to the tower's own coverage exclusion even though the pipeline doesn't). Do not substitute either side's mask alone — that silently reintroduces the exact comparison the v2.1.1 production failure mode (matched-methodology violation, C5) was created to prevent.

---

## 4. What `validate.py` must produce

### 4.1 The magnitude gate

Per tower, per denominator (A and B): `diff = pipeline_ef(intersection) − tower_ef(intersection)`. Pass if `|diff| ≤ 0.06` (Ne1/Ne2/Ne3/Ton/Var) or `≤ 0.10` (Me2). Report the intersection month count (`n_intersection_months`) alongside every result — a gate computed over 3 months means something different from one over 10, and that has to be visible, not buried.

**Month-bias check** (Gate P3's "no month-bias trend," operationalized): tabulate `(pipeline_ef_month − tower_ef_month)` for every intersection month and print it per tower. Flag — don't auto-fail, this wasn't given a hard statistical threshold in the source docs — if the residual visibly trends with season rather than scattering around a constant offset.

### 4.2 The curve gate (D-J) — treat as load-bearing

Two ordering checks, independent of the magnitude tolerance:
- **Mead anchor:** for every intersection month, and for the intersection-annual figure, `pipeline_ef(Ne1) > pipeline_ef(Ne3)` and `pipeline_ef(Ne2) > pipeline_ef(Ne3)`.
- **Tonzi/Vaira curve:** for the summer intersection months (where both towers have historically diverged — Jun–Sep per the tower reference tables, but derive the actual overlap from the data, don't hardcode it), `pipeline_ef(Ton) > pipeline_ef(Var)`.

A denominator that fails either ordering check should **fail Phase 3 for that denominator**, regardless of whether it happens to land inside the annual magnitude tolerance. This is the specific failure mode C8 and the external advisory both warn about: an annual-only gate can pass a pipeline that gets the ecology backwards.

### 4.3 Likely-cause split — numerator floor vs. denominator error

For any tower where the magnitude gate fails, use the raw-numerator audit columns (`et_openet_mm_raw`, `le_openet_wm2_raw` — already unmasked, already in the footprint CSV) to distinguish two failure shapes:
- **Numerator-floor signature:** `le_openet_wm2_raw` sits far above the tower's `sum_le`-derived flux specifically in the tower's *lowest*-EF months (the pattern the external investigation already found at Tonzi/Vaira) — no denominator choice fixes this.
- **Denominator-error signature:** the raw OpenET LE roughly tracks the tower, but `avail_a_j_month`/`avail_b_j_month` diverges from the tower's `(sum_netrad − sum_g)` — this is addressable by denominator work.

Tag each failing tower-month with `likely_cause: numerator | denominator | mixed | unclear`. This is diagnosis, not a pass/fail input — its job is to stop Phase 4 from being handed a bare "Ton failed" with no indication that the failure is a known, external, upstream OpenET limitation rather than a pipeline bug to chase.

### 4.4 The D2 decision record

`validate.py`'s final output must include a short, dated, plain-language block: which denominator wins (per the gate results, not vibes), the evidence (the per-tower pass/fail table), and an explicit acknowledgment of which towers fail regardless of denominator choice (expected: Tonzi, on the numerator-floor finding) and are therefore **out of scope for Phase 4 import** until that upstream issue is resolved. This record is what "recorded before import" (handoff §6) actually means — it should be copy-pasteable into a dated addendum, not left implicit in a chat log.

---

## 5. Output schema

```
hrc_30m_phase3_validation.csv   (one row per tower per denominator)
  tower_id, region_code, regime,
  denominator,                    // 'A' | 'B'
  n_intersection_months,
  tower_ef, pipeline_ef, diff,
  tolerance,                      // 0.06 or 0.10
  gate_pass_magnitude,            // bool
  gate_pass_curve,                // bool, null where not applicable (only Ne1/Ne2/Ne3 vs Ne3, Ton vs Var)
  likely_cause,                   // 'numerator' | 'denominator' | 'mixed' | 'unclear' | null (only set on failure)
  notes
```
Plus the D2 decision record (§4.4) as a separate short markdown or console block, not a CSV row.

---

## 6. Illustrative preview — NOT the official gate result

Computed from the pipeline's **full-year composite** (not yet the true D-H intersection — that requires §3.1's patch and the real join). This is only to show what the shape of the result is likely to look like, so building `validate.py` isn't done blind:

| Tower | Tolerance | Tower EF | Pipeline EF_B | Diff | Illustrative result |
|---|---:|---:|---:|---:|---|
| US-Ne1 | ±0.06 | 0.570 | 0.559 | −0.011 | pass, comfortably |
| US-Ne2 | ±0.06 | 0.601 | 0.573 | −0.028 | pass, comfortably |
| US-Ne3 | ±0.06 | 0.481 | 0.542 | **+0.061** | **fails, narrowly** — worth watching once the real intersection is computed |
| US-Ton | ±0.06 | 0.295 | 0.566 | **+0.271** | fails badly — expected, numerator-floor signature |
| US-Var | ±0.06 | 0.283 | 0.343 | +0.060 | passes, right at the boundary |
| US-Me2 | ±0.10 | 0.191 (soft) | 0.237 | +0.046 | passes, comfortably |

Two things this preview already suggests, to watch for once the real gate runs: (1) US-Ne3 sits close enough to the boundary that the true intersection-based number (likely different from this full-year figure, since Mead's intersection drops Aug/Sep/Nov — see the Phase 2 review artifact §05) could tip it either way; (2) US-Ton failing badly is the expected outcome given the numerator-floor finding, not a pipeline bug to debug.

---

## 7. Gotchas (read before you start)

1. **The footprint CSV can't support a correct C1 re-aggregation yet.** §3.1's patch is a prerequisite, not a nice-to-have. Building the intersection logic against the ratio columns alone silently reintroduces mean-of-monthly-ratios — the exact bug D-F exists to prevent.
2. **Denominator A is not just biased, it's non-diagnostic.** It inverts the Mead irrigated/rainfed ordering (rainfed's HRC_A sits above one of the two irrigated towers) and collapses to large negative values at Metolius. Expect A to fail the curve gate outright. This is the pre-registered, expected outcome — don't spend time trying to make A competitive (see Q3 in the Phase 2 review).
3. **US-Ton will very likely fail regardless of denominator.** This traces to OpenET's own numerator floor (external, independently verified — not a pipeline defect). `validate.py`'s job is to *say so* via §4.3, not to chase a fix that doesn't exist in this codebase.
4. **The pipeline's D-G mask and the tower's D-G mask diverge for real, explainable reasons, not bugs.** ERA5 over-reads available energy 20–47% in spring/early summer and under-reads up to 65% in Nov/Jan/Feb relative to the tower (see Phase 2 review artifact §05) — this is why the pipeline excludes different months than the tower does. D-H's intersection exists specifically to handle this; don't try to reconcile the two masks into one.
5. **Mead's Aug/Sep exclusion (`EF≈1.06–1.10`, mild OpenET-side advection) is a separate phenomenon from the ERA5 shoulder-season gap above** — don't conflate an OpenET-numerator effect with an ERA5-denominator effect just because both end up excluding a month.
6. **US-Me2's coordinate was wrong for all of 2023** until 2026-08-04 (pre-fire AmeriFlux location used for a post-fire year); it's fixed in `pipeline.js`/`feasibility.js` now, but the `regime: 'mature_ponderosa_pine'` label is an open, unresolved question — AmeriFlux's own BADM record calls the current footprint "regenerating" post-fire. Don't treat Me2's regime label as settled; flag it in `validate.py`'s notes column rather than silently trusting it.
7. **Use `tower.py`'s and `pipeline.js`'s own mask columns (`excluded`, `masked`) — do not recompute D-G independently in `validate.py`.** Recomputation risks drifting from the canonical implementation (both already exist and are correct); `validate.py`'s job is to join and gate, not re-derive.
8. **The 100 m footprint radius is inherited, not derived**, and is flagged (externally) as a live, unresolved sensitivity — footprint area affects results more than pixel resolution does. Whatever `validate.py` concludes is conditioned on this; don't present the gate result as more final than that caveat allows.

---

## 8. First actions for the new thread

1. Patch `scripts/pipeline.js`'s footprint export per §3.1 (three lines: export `leSum`, `sums.get('availA_J')`, `sums.get('availB_J')` as new columns). Re-run the pipeline, regenerate the six footprint CSVs.
2. Write `validate.py`: load the six footprint CSVs + six `tower_ef_*.csv`, join on `(tower_id, month)`, compute the D-H intersection per tower.
3. Implement §4.1 (magnitude gate + month-bias tabulation), §4.2 (curve gate — Mead anchor, Tonzi/Vaira ordering), §4.3 (likely-cause split using the raw audit columns).
4. Run it. Compare against §6's illustrative preview — investigate any large disagreement before trusting the real output.
5. Write the §4.4 D2 decision record. This is the artifact Phase 4 is gated on.

**Deliverable of Phase 3:** `validate.py` + `hrc_30m_phase3_validation.csv` + the D2 decision record, ready for Phase 4 (migration 009, `import.py`, `aggregate.js`) — or a documented, evidence-backed statement of which towers/sites are not yet ready for import and why.
