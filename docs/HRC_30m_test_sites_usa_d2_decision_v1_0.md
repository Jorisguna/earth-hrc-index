# HRC 30 m US Test Sites — D2 Decision Record

| Field | Value |
|---|---|
| **Version** | 1.0 |
| **Date** | 2026-08-06 |
| **Status** | **Gate P3 run. D2 decided.** Recorded per `docs/HRC_30m_test_sites_usa_phase3_handoff_v1_0.md` §4.4 — before any Phase 4 import work. |
| **Evidence** | `validate.py` + `hrc_30m_phase3_validation.csv` (repo root), run against the six `hrc_30m_*_footprint.csv` exports and `tower_ef_US-*.csv`, over the D-H (pipeline-valid ∩ tower-valid) intersection, C1 ratio-of-annual-sums. |
| **Recorded by** | Joris (project owner) + Claude (pipeline/validation build) |

---

## 1. Denominator winner: **B**, unambiguous

Denominator A fails the magnitude gate at all six towers (diffs +0.79 to +2.12 EF) and the curve gate everywhere it applies. This is the pre-registered, expected outcome (Q3 in the Phase 2 review) — A inverts the Mead irrigated/rainfed anchor and collapses to non-physical values at Metolius. No further work on A.

**B is the production denominator for this tier.**

---

## 2. Per-tower disposition

| Tower | Magnitude (tol ±0.06/±0.10) | Curve | Disposition |
|---|---|---|---|
| **US-Ne1** | pass, diff +0.045 | fails (Feb/Mar only) | **Cleared for Phase 4**, curve caveat below |
| **US-Ne2** | pass, diff +0.047 | fails (Feb/Mar only) | **Cleared for Phase 4**, same caveat |
| **US-Ne3** | fails, diff +0.124 | fails | **Held — new open item**, §4 |
| **US-Ton** | fails, diff +0.266 | **passes** | **Not cleared** — known external cause, §5 (unchanged from release blockers) |
| **US-Var** | fails, diff +0.081 | **passes** | **Not cleared** — same external cause |
| **US-Me2** | pass, diff +0.040 | n/a (no partner tower) | **Not cleared** — thin evidence + disputed regime label, §6 |

## 3. The Mead-anchor curve caveat (Ne1/Ne2)

The D-H intersection for Mead leaves only `[2, 3, 5, 7, 10]` — June–September, the months carrying the strongest irrigated-vs-rainfed signal, are excluded by design (that's what Q1's capping exists for; the *strict* variant used here for Phase 3 still drops them). So the curve gate is testing the anchor on its weakest evidence, not its best.

Investigated directly: **March is ambiguous even in the tower's own data** (Ne1 0.386 < Ne3 0.406 that month) — not a pipeline issue. **February is not ambiguous in the tower** (clean split, Ne1 0.599/Ne2 0.605 vs Ne3 0.493) but the pipeline doesn't reproduce it. Traced to mechanism: the ERA5-based denominator-B available-energy underestimate in February (~40%) is nearly identical across all three towers (0.57–0.61×) — not Ne3-specific — but OpenET's numerator undershoots the tower *less* at Ne3 (0.93×) than at Ne1/Ne2 (0.69–0.75×) that month, so Ne1/Ne2's numerator and denominator errors partially cancel while Ne3's don't, inflating Ne3's relative February EF.

**Conclusion:** Ne1/Ne2's curve failure is a testing-window artifact plus one explained mechanism, not a pipeline defect. Cleared, with this caveat attached to the record.

## 4. US-Ne3 — held, not cleared, on a same-session (not independently verified) finding

Ne3 fails both gates under B (diff +0.124, more than double tolerance). Investigated in this session:

- **Not a clean, single-mechanism failure** the way Ton/Var's is. Checked whether OpenET's raw LE runs systematically hot at Ne3 relative to Ne1/Ne2 across the full year: it leads in 6 of 11 months — only modestly above the 1-in-3 chance baseline (~3.7/11), not a deterministic pattern.
- **But** Ne3 leads by the largest margin in its two highest-magnitude months — May (1.84× vs 1.50–1.58×) and September (1.86× vs 1.42–1.57×) — and ratio-of-annual-sums weights months by actual energy, so these two disproportionately drive the annual result even without a majority-of-months pattern.
- **Reading:** a modest, partial tendency for OpenET to over-credit the rainfed field's LE specifically in its highest-ET months, compounding with denominator biases that happen to cancel more favorably for Ne1/Ne2 elsewhere in the year. Plausible, not implausible — but this is a same-session finding on three site-months of manual inspection, not the externally-documented, independently-verified investigation behind the Ton/Var floor.

**Do not import US-Ne3 on the strength of this explanation alone.** It needs either independent verification (comparable to the numerator-check investigation's rigor) or a decision to accept it as a documented, lower-confidence caveat before Phase 4. Held pending that call — **this is new information not previously on the release-blockers list.**

## 5. US-Ton / US-Var — unchanged from the release blockers document

Both fail magnitude but **pass the curve gate** — the pipeline correctly reproduces the savanna-above-grassland summer ecology even where the absolute magnitude is biased. This is exactly the signature of the externally-documented, independently-verified OpenET numerator floor (`HRC_numerator_check_findings_v1_3.md`), not a pipeline defect. `validate.py`'s automated `likely_cause` tag correctly identifies both as `numerator`, with no knowledge of that external investigation built in — an independent confirmation the diagnosis logic is sound.

**Status unchanged: not release-ready until OpenET addresses the floor upstream, or a different numerator source is used.** This gate run adds pipeline-side confirmation to an already-settled call; it doesn't reopen it.

## 6. US-Me2 — not cleared, thin evidence + disputed label

Passes magnitude (+0.040) but on only **5 intersection months** `[4,5,7,8,9]` — the thinnest evidence base of any tower. Compounding factors already on record: 2023 energy-balance closure is 0.519 (tower's own evaporative fraction is undefined across a 0.204–0.393 range depending on method — wider than the ±0.10 tolerance itself), and the regime label (`mature_ponderosa_pine`) is disputed — AmeriFlux's own BADM record calls the 2023 footprint post-fire "regenerating." Curve gate doesn't apply (no comparison partner at Metolius).

**Not cleared.** A magnitude pass on this evidence base isn't a meaningful validation.

---

## 7. What Phase 4 can actually proceed with

**US-Ne1 and US-Ne2 only**, denominator B, with the Feb/Mar curve caveat recorded on the card or in the methodology note. Everything else — Ne3, Ton, Var, Me2 — is held, each for a documented, different reason (one new and uncertain; two external and settled; one thin-evidence). This narrows the "Mead only" release further than the release-blockers document anticipated: two of three Mead towers, not all three.

## 8. Limitations carried forward, unresolved by this gate

- **100 m footprint radius is inherited, not derived** — flagged externally as a live sensitivity larger than pixel resolution. Every number in this record is conditioned on that choice.
- **Single year (2023).** Q6's resolution (interannual range as a card caveat) applies to whatever ships; this gate itself is single-year evidence only.
- **`likely_cause` is a diagnostic heuristic, not a statistical test** — useful for triage, not proof. The Ne3 investigation in §4 required manual follow-up beyond what the automated tag captured (it correctly flagged the presence of a denominator contribution in February but missed the numerator contribution in May/September).
