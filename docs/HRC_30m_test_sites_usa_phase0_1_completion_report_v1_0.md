# HRC 30 m US Test Sites — Phase 0 & Phase 1 Completion Report

| Field | Value |
|---|---|
| **Version** | 1.0 |
| **Date** | 2026-07-22 |
| **Status** | **Phase 0 PASSED** (3/3 sites). **Phase 1 (Gate P1) COMPLETE** (6/6 towers). **Aggregation corrected to ratio-of-annual-sums (D-F, 2026-07-22)** — §5.1 references updated; see `docs/HRC_scoring_conventions_source_of_truth.md`. Ready for Phase 2. |
| **Type** | Consolidated record — the authoritative account of Phases 0–1, reproducible from this document alone. |
| **Parent docs** | `HRC_30m_test_sites_usa_project_plan_v1_0.md` (science) · `HRC_30m_test_sites_usa_implementation_plan_v1_0.md` (build map, gaps G1–G8) · `HRC_30m_test_sites_usa_phase0_findings_handoff_v1_0.md` (running handoff) |
| **Owner** | Joris (technical + scientific lead) |

---

## 1. Executive summary

Three US flux-tower sites — Mead NE (cropland), Tonzi/Vaira CA (savanna+grassland), Metolius OR (semi-arid pine) — were taken through feasibility (Phase 0) and tower-reference computation (Phase 1) for a 30 m OpenET-driven HRC demonstration tier.

- **Phase 0**: OpenET has full monthly coverage at all three sites; clear Landsat scenes are adequate except two isolated winter months; the Mead irrigated-vs-rainfed sanity holds. **All three sites pass.**
- **Phase 1**: annual tower evaporative fraction computed for all six towers from AmeriFlux BASE data. **The Mead anchor validates the core signal** (irrigated 5.31/5.83 > rainfed 4.45). Tonzi/Vaira's two towers self-agree (3.94/3.79). Metolius is the honest forest weak case (HRC 1.43 at 47% energy-balance closure).
- **Methodology evolved on evidence**: the composite window moved from growing-season to **full calendar year with per-site winter masking** (decision D-D), and Metolius is **accepted with a closure caveat** (decision D-E).

Nothing to date touches production tiles or database schema. No migration has been written (deferred to Phase 4 by design).

---

## 2. Locked decisions (D-A … D-E)

| ID | Decision | Rationale |
|---|---|---|
| **D-A** | **Reference line only** — the 30 m score sits beside the 500 m ecoregion *reference number* on the Bioregion Card; no coarse companion tile layer, no resolution toggle. | These US sites have no existing 500 m/9 km tier to compare against; a reference line is honest and cheap. |
| **D-B** | **geeSEBAL turbulent layer at Mead only, held from the public card.** Tonzi/Vaira + Metolius: latent-heat EF only. | Formula-3 `LE/(LE+H)` is an add-on cost; prove it where confidence is highest. |
| **D-C** | **`site_state` naming**: `region_code = mead_ne \| tonzi_vaira_ca \| metolius_or`; `data_source = <site>_landsat_30m_2023`. | `region_code` is the resolution-isolation key (`hrc_tiles_default` picks `MIN(data_resolution_m)` per region); provenance belongs in `data_source`. |
| **D-D** | **Full calendar-year composite, not growing-season**, with per-site winter masking (mask a month where clear Landsat = 0 OR available energy too low; report masked months). | OpenET is monthly year-round; the 500 m reference (D-A) is annual; Apr–Oct is actively wrong for Mediterranean Tonzi/Vaira. Evidence in §4–§5. |
| **D-E** | **Metolius accepted with a closure caveat.** Keep 2023 US-Me2; surface the 0.47 closure and an "energy-balance not closed" flag; use the ±0.10 forest Gate-P3 tolerance + OpenET member-spread band. | Only forest tower available for 2023; matches R2's "never present the forest number as crisp." Earlier-year / backup-site options remain if Phase 3 fails. |
| **D-F** | **Aggregation = ratio-of-annual-sums** (`10 × ΣLE / Σ available energy`), not mean-of-monthly-ratios. Latter reported only as a labelled sensitivity. | Matches the production score and the 500 m reference (D-A); energy-weights correctly. Mean-of-ratios biases biomes in opposite directions, compressing the contrast the index measures. |
| **D-G** | **One uniform month-exclusion rule** for every tower and the pipeline: EF ∉ [−0.05,1.05] OR mean available energy < 25 W/m² OR valid coverage < 0.50. No per-tower exceptions. | Removes ad-hoc per-tower drops that made references non-comparable. |
| **D-H** | **Matched-methodology reference + intersection gate.** Compare the pipeline (budget-closed) only to the all-hour ratio-of-annual-sums tower reference, over the intersection of pipeline-valid ∩ tower-valid months. | Avoids comparing a closed satellite product to an open tower (the v2.1.1 failure mode). |
| **D-I** | **Multi-year tower reference** (≥ one wet + one dry year); report the interannual range. *Phased:* single-year is fine to prototype/validate Phase 2; multi-year required before "production" status. | 2023 was a regionally wet year; the Mediterranean sites and the irrigated–rainfed gap are the most interannually sensitive quantities. |
| **D-J** | **Gate P3 checks the monthly EF curve**, not only the annual scalar — esp. Tonzi/Vaira summer (savanna 0.15–0.22 > grassland 0.02–0.10). | Their annual values are nearly equal while summer diverges; an annual-only gate could pass a pipeline that gets the ecology backwards. |

---

## 3. Site & tower definitions

Year: **2023** (matches the v2.1.2/v2.2 production radiation window and the OpenET asset). Boxes and tower coordinates are the single source of truth, used by `scripts/feasibility.js` and `tower.py`.

| Site (`region_code`) | Confidence | Bounding box (lon/lat) | Towers (AmeriFlux id · regime · lon, lat) |
|---|---|---|---|
| **mead_ne** | High | −96.52,41.14 → −96.40,41.20 | US-Ne1 irrigated maize (−96.4766, 41.1651) · US-Ne2 irrigated maize-soy (−96.4701, 41.1649) · US-Ne3 rainfed maize-soy (−96.4397, 41.1797) |
| **tonzi_vaira_ca** | Medium | −121.00,38.38 → −120.92,38.46 | US-Ton blue-oak savanna (−120.9660, 38.4309) · US-Var annual grassland (−120.9508, 38.4133) |
| **metolius_or** | Lower | −121.62,44.40 → −121.50,44.50 | US-Me2 ponderosa pine (−121.5574, 44.4523) |

Data assets: OpenET `OpenET/ENSEMBLE/CONUS/GRIDMET/MONTHLY/v2_0` (band `et_ensemble_mad`, mm/mo); Landsat `LANDSAT/LC08|LC09/C02/T1_L2`; `ECMWF/ERA5_LAND/MONTHLY_AGGR` (net radiation, Phase-0 sanity denominator).

---

## 4. Phase 0 results (Gate P0)

Source: `scripts/feasibility.js`, full calendar year, Landsat `CLOUD_COVER < 30`.

### 4.1 OpenET monthly coverage
`1` image every month (Jan–Dec) at all three sites. **The numerator is never the limiter.**

### 4.2 Clear Landsat scenes per month (Jan→Dec)

| Site | J | F | M | A | M | J | J | A | S | O | N | D |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mead_ne | 2 | 4 | 4 | 3 | 2 | 3 | 2 | 4 | 4 | 4 | 6 | **0** |
| tonzi_vaira_ca | 6 | 3 | 3 | 10 | 7 | 6 | 12 | 11 | 11 | 9 | 3 | 7 |
| metolius_or | 1 | **0** | 1 | 1 | 2 | 4 | 2 | 3 | 1 | 2 | 1 | 1 |

Winter Landsat collapse is **localised to two months** — Mead Dec (0), Metolius Feb (0). Tonzi/Vaira is usable all 12 months; its best-imaged months are the Nov–May green season a fixed Apr–Oct window would have discarded → the decisive evidence for D-D. Metolius rides single scenes through winter (R2).

### 4.3 Mead irrigated-vs-rainfed sanity (July, rough OpenET-ET / ERA5-Rn proxy)
US-Ne1 irrigated **0.950**, US-Ne2 irrigated **0.974**, US-Ne3 rainfed **0.930**. Direction correct (irrigated > rainfed). Magnitudes run hot because the ~9 km ERA5 denominator is shared across the three towers — an expected proxy artefact removed by Phase 2's 30 m denominator, not a site problem.

**Gate P0: PASS for all three sites** (on-platform items). AmeriFlux data presence (off-platform) confirmed in Phase 1.

---

## 5. Phase 1 results (Gate P1)

Source: `python3 tower.py <AmeriFlux BASE CSV> --tower <id>` for 2023. Reference = annual mean `EF_rn_g` over unmasked months × 10. Closure recorded, never applied.

### 5.1 Headline tower references

> **⚠ SUPERSEDED (2026-07-22).** The values below were computed with **mean-of-monthly-ratios**, later found to violate the locked scoring convention and to bias biomes in opposite directions. The corrected headline uses **ratio-of-annual-sums** (decision **D-F**); see the corrected table immediately after, and `docs/HRC_scoring_conventions_source_of_truth.md`. The per-month EF in §5.2 is unchanged (only the annual aggregation changed).

**CORRECTED — ratio-of-annual-sums (D-F), uniform D-G mask:**

| Site | Tower | Regime | **Tower HRC (D-F)** | ~~old (mean-of-ratios)~~ | closure | excluded months |
|---|---|---|---|---|---|---|
| mead_ne | US-Ne1 | irrigated maize | **5.70** | ~~5.31~~ | 0.92 | {1,12} low-energy |
| mead_ne | US-Ne2 | irrigated maize-soy | **6.01** | ~~5.83~~ | 0.89 | {1,12} low-energy; {4} low-coverage |
| mead_ne | US-Ne3 | rainfed maize-soy | **4.81** | ~~4.45~~ | 0.90 | {1,12} low-energy |
| tonzi_vaira_ca | US-Ton | blue-oak savanna | **2.95** | ~~3.94~~ | 0.94 | {4} low-coverage; {12} low-energy |
| tonzi_vaira_ca | US-Var | annual grassland | **2.83** | ~~3.79~~ | 0.92 | {none} |
| metolius_or | US-Me2 | ponderosa pine | **1.91** (soft) | ~~1.43~~ | **0.47** | {1,2,3,12} low-energy/nonphysical; {6,10} low-coverage |

The aggregation change moves cropland UP (energy-weighting favours high-EF summer) and Mediterranean DOWN (favours low-EF summer) — the opposite-direction bias that motivated D-F. Mead irrigated > rainfed and Tonzi/Vaira self-consistency both survive.

### 5.2 Per-month EF_rn_g (all towers; `*` = winter-masked, excluded from the annual mean)

| Mo | US-Ne1 | US-Ne2 | US-Ne3 | US-Ton | US-Var | US-Me2 |
|---|---|---|---|---|---|---|
| 1 | 0.751* | 0.593* | 0.607* | 0.782 | 0.862 | 17.157* |
| 2 | 0.599 | 0.605 | 0.493 | 0.493 | 0.733 | 1.235* |
| 3 | 0.386 | 0.458 | 0.406 | 0.501 | 0.599 | 2.064* |
| 4 | 0.306 | 0.181 | 0.297 | 0.527 | 0.631 | 0.219 |
| 5 | 0.236 | 0.207 | 0.161 | 0.430 | 0.383 | 0.255 |
| 6 | 0.720 | 0.734 | 0.591 | 0.222 | 0.061 | 0.179 |
| 7 | 0.845 | 0.799 | 0.747 | 0.208 | 0.022 | 0.178 |
| 8 | 0.859 | 0.818 | 0.709 | 0.152 | 0.020 | 0.144 |
| 9 | 0.607 | 0.540 | 0.382 | 0.166 | 0.096 | 0.159 |
| 10 | 0.365 | 0.346 | 0.335 | 0.243 | 0.164 | 0.015 |
| 11 | 0.389 | 0.364 | 0.334 | 0.609 | 0.401 | −0.005 |
| 12 | 0.639* | 0.536* | 0.550* | 0.790* | 0.570 | 0.223* |

Reading: **Mead** peaks in summer (irrigated 0.85, rainfed 0.75), low bare-soil spring — the maize signature; **Tonzi/Vaira** is *inverted* (high winter/spring, low summer) — the Mediterranean phenology D-D preserves; **Metolius** summer EF ~0.15 (semi-arid, water-limited), with winter months physically undefined (Jan EF 17 → masked).

### 5.3 Scientific findings

- **F4 — Mead anchor validated.** Irrigated (5.31, 5.83) > rainfed (4.45) at annual scale, ~0.9 closure. Phase 3 must reproduce this contrast at the footprint.
- **F5 — Tonzi/Vaira self-consistent.** Two towers in one scene agree (3.94 vs 3.79); Mediterranean phenology present in the data.
- **F6 — Metolius is the R2 weak case.** 2023 exposes only a secondary EC system (`_2_1_1`) at 47% closure; EF 1.43 is likely an underestimate (poor closure → LE under-captured). Handled by D-E.
- **Empirical winter masks (feed the Phase 2 pipeline mask, D-D):** Mead {Jan, Dec}, Tonzi {Dec}, Vaira {none}, Metolius {Jan, Feb, Mar, Dec}. These *extend* the Landsat-only Phase-0 masks (Mead was {Dec} on scene-count alone; the tower's low-Rn criterion adds Jan) — confirming D-D's dual criterion.

### 5.4 `tower.py` — three fixes real AmeriFlux data forced (F7)

1. **Winter mask is physical, not closure-based.** Closure is recorded-not-corrected (project rule); a chronically poor-closing site (Metolius ~0.47 year-round) has valid physical EF and must not be masked on closure. Mask = EF outside [0,1]±0.05 **or** monthly mean available energy (Rn−G) < 25 W/m².
2. **AmeriFlux sensor resolution.** Prefer measured over `_PI_F` gap-filled; prefer primary position (bare / `_1_1_1`) over secondary (`_1_2_1`); resolve *after* year-filtering; print all candidate variants for audit. (Bare `NETRAD`/`LE` columns can be empty while a position-qualified variant holds the year's data — the original bug.)
3. Year-filter precedes column resolution.

---

## 6. Artefacts & reproduction

| Artefact | Purpose |
|---|---|
| [`scripts/feasibility.js`](../scripts/feasibility.js) | Phase 0 diagnostic (GEE). Full-year OpenET + Landsat + net-radiation survey; Mead sanity; exports `hrc_30m_usa_feasibility_phase0.csv`. |
| [`tower.py`](../tower.py) | Phase 1 tower reference. `python3 tower.py <BASE_CSV> --tower <id> [--year 2023]`. |
| `tower_ef_US-{Ne1,Ne2,Ne3,Ton,Var,Me2}.csv` | Per-tower per-month EF / closure / available-energy / mask. Phase 3 archive. |
| [`src/App.jsx`](../src/App.jsx#L668-L676) | Gap G1 fix — `data_resolution_m === 30 → H3 res 10`. Shipped; no-op until 30 m data exists; build+lint clean. |

AmeriFlux inputs: BASE-BADM (half-hourly `HH` or hourly `HR`) for the six towers from [ameriflux.lbl.gov](https://ameriflux.lbl.gov), CC-BY-4.0. `tower.py` finds the header row dynamically and resolves columns per §5.4.

---

## 7. Gate checklist & next step

- [x] **P0** — OpenET months present; clear Landsat adequate (2 isolated winter zeros, masked); tower data present; Mead sanity plausible — **all 3 sites**
- [x] **P1** — monthly tower EF computed for every site-month; closure recorded — **all 6 towers**
- [ ] **P2** — 30 m pipeline: OpenET numerator + both D2 denominators; annual composite with per-site winter masks; per-tower month stacks; Metolius member-spread; Mead geeSEBAL H
- [ ] **P3** — validation: pipeline vs tower at footprint, ±0.06 crop/grass / ±0.10 forest; D2 winner recorded pre-import
- [ ] **P4** — aggregate H3 res 10, migration 009, import (distinct `region_code`/`data_source`)
- [ ] **P5** — app integration (G1 done; G4 nav, G7 label, card fields, G2 verify)
- [ ] **P6** — methodology doc

**Next: Phase 2 `pipeline.js`** (GEE), templated from `scripts/31_hrc_v2_1_idf_tiles_v2_2.js`, **Mead first**. The Phase-1 tower references in §5 are the fixed targets Phase 3 will adjudicate against; the §5.3 per-site winter masks are the pipeline's masking input.
