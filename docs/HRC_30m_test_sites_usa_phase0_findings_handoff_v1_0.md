# HRC 30 m US Test Sites — Phase 0 Findings & Handoff

| Field | Value |
|---|---|
| **Version** | 1.0 |
| **Date** | 2026-07-22 |
| **Status** | Phase 0 PASSED (3/3 sites). Phase 1 (Gate P1) COMPLETE — all six towers computed, `tower_ef_*.csv` written. One open decision: Metolius closure (§5bis). Ready for Phase 2. |
| **Covers** | Decisions locked, Phase 0 feasibility results, artefacts built to date, and the exact next step. |
| **Parent docs** | `HRC_30m_test_sites_usa_project_plan_v1_0.md` (science) · `HRC_30m_test_sites_usa_implementation_plan_v1_0.md` (build map, gap list G1–G8) |

---

## 1. Where we are in one line

All three US flux-tower sites clear the on-platform Gate P0 (OpenET coverage, clear-Landsat counts, Mead sanity). The only open P0 item is the off-platform AmeriFlux BASE file check. The Phase 1 tower script is written and compiles; it has not been run against real data yet.

---

## 2. Decisions locked (2026-07-22)

Recorded in full in the implementation plan §3. Summary:

| ID | Decision | Consequence for the build |
|---|---|---|
| **D-A** | **Reference line only** — no coarse companion tile layer. | Phase 5 builds no second map layer / no resolution toggle. The 30 m score sits beside the 500 m ecoregion *reference number* on the Bioregion Card, labelled. |
| **D-B** | **geeSEBAL turbulent layer: build at Mead, hold from card.** | `pipeline.js` scaffolds sensible-heat `H` / `EF_turbulent` at Mead only; validated in Phase 3; kept off the public card. Tonzi/Vaira + Metolius: latent-heat EF only. |
| **D-C** | **`site_state` naming.** | `region_code = mead_ne \| tonzi_vaira_ca \| metolius_or` (one per site — this is what enforces resolution isolation via `hrc_tiles_default`'s `MIN(data_resolution_m)` per region). `data_source = <site>_landsat_30m_2023` (provenance only). |
| **D-D** | **Full calendar-year composite, NOT a growing-season window** (added 2026-07-22 after the Phase-0 12-month survey). | The seasonal composite becomes an **annual** composite. OpenET is monthly year-round, so the numerator is never the limiter; winter is a denominator problem handled by **per-site quality masking** (drop months where clear Landsat = 0 or net radiation is too low for a defined EF, and *report* which dropped — no blind exclusion). Faithful to the annual 500 m reference the tile sits beside (D-A), and fixes the Mediterranean phenology error at Tonzi/Vaira. **Relabels the product from "growing-season mean" to "annual (winter months masked)"** — see §3.4 and implementation-plan G7 / §4.6. |

---

## 3. Phase 0 results (Gate P0)

Run: `scripts/feasibility.js` in the Earth Engine Code Editor, year **2023**, **full calendar year (Jan–Dec)**, Landsat threshold `CLOUD_COVER < 30`.

### 3.1 Coverage — full-year OpenET months + clear Landsat scenes

OpenET = `1` every month for all three sites (numerator never the limiter). Landsat scenes per month (Jan→Dec):

| Site | J | F | M | A | M | J | J | A | S | O | N | D | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **mead_ne** | 2 | 4 | 4 | 3 | 2 | 3 | 2 | 4 | 4 | 4 | 6 | **0** | Pass; mask **Dec** |
| **tonzi_vaira_ca** | 6 | 3 | 3 | 10 | 7 | 6 | 12 | 11 | 11 | 9 | 3 | 7 | Pass; **all 12 months usable** |
| **metolius_or** | 1 | **0** | 1 | 1 | 2 | 4 | 2 | 3 | 1 | 2 | 1 | 1 | Pass; mask **Feb**, watch single-scene months |

**Reading:** the winter Landsat collapse is real but **localised to two months** — Mead December (0) and Metolius February (0) — not a blanket winter. Tonzi/Vaira has clear scenes every month, and its best-imaged months are the Nov–May green season that a fixed Apr–Oct window would have discarded (the decisive evidence for D-D). Metolius rides single scenes through much of winter (the R2 forest stress case), so its winter months carry no masking redundancy.

### 3.2 Mead one-month sanity (July 2023, rough EF)

| Tower | Regime | July EF |
|---|---|---|
| US-Ne1 | irrigated maize | **0.950** |
| US-Ne2 | irrigated maize-soy | **0.974** |
| US-Ne3 | rainfed maize-soy | **0.930** |

**Direction correct** (both irrigated > rainfed) → pipeline plumbing works. **Magnitudes run hot** (~0.93–0.97 vs the ~0.7–0.9 predicted) and the irrigated/rainfed gap is small (~0.02–0.04). This is an **expected artefact of the rough sanity proxy, not a site problem**: the denominator is ERA5-Land at ~9 km, so a single coarse Rn pixel covers all three towers and only the OpenET numerator can differ; 2023 had a wet July when even rainfed maize transpires strongly. Removing exactly this artefact is the job of Phase 2's D2 30 m denominator. The sanity check's only mandate — "OpenET present + irrigated > rainfed" — is met.

### 3.3 Findings carried forward

- **F1 — Metolius thin months (R2 forest stress case).** April and September have only **one** clear Landsat scene each. Passes P0 but leaves no redundancy: if that single scene is cloud-contaminated over the tower pixel, the month effectively drops in Phase 2. Metolius already carries the looser **±0.10** Gate-P3 tolerance and the OpenET member-spread band, so this is anticipated. **Action:** watch Apr/Sep specifically in Phase 2 masking and Phase 3 validation; do **not** swap in a backup site yet.
- **F2 — sanity magnitudes are proxy-inflated, expected to fall in Phase 2.** Don't treat the ~0.95 as a forecast of the production 30 m number.
- **F3 — full-year window with a two-month mask (drives D-D).** The 12-month survey shows winter is *not* a blanket outage: only **Mead December** and **Metolius February** have zero clear Landsat scenes. Combined with near-zero winter net radiation at these latitudes (EF undefined), the Phase 2 rule is: **compute all 12 months; mask a month per-site where clear Landsat = 0 OR monthly Rn is below a defined-EF threshold; record which months dropped.** Provisional masked set: Mead {Dec}, Metolius {Feb, + any single-scene month that fails per-pixel cloud masking over the tower}, Tonzi/Vaira {none}. Not blind exclusion.

### 3.4 Labelling consequence of D-D

Because the composite is now full-year, the product label shifts from **"growing-season mean"** to **"annual (winter months masked where snow / low-Rn)"**. This touches:
- Implementation-plan **G7** (Cooling Work legend/headline label) — the conditional is now "annual, winter-masked" for these sites, still distinct from the true year-round annual of IDF/Tapajós.
- Implementation-plan **§4.6** — the Cooling Work field carries **annual mean latent heat flux over unmasked months**, with the masked-month count surfaced so the qualifier is honest.
- Migration 009 `temporal_qualifier` value → `annual_winter_masked` (was `growing_season`), and a companion `months_masked` count per tile.

**Gate P0 status: 3/3 sites pass the three on-platform items. Open item: §5.**

---

## 3bis. Phase 1 — tower reference results (Gate P1, all six towers)

Run: `python3 tower.py <AmeriFlux BASE CSV> --tower <id>` for 2023. All six towers computed; `tower_ef_<id>.csv` written for each. Reference = annual mean EF_rn_g over unmasked months × 10.

| Site | Tower | Regime | **Tower HRC** | closure | winter mask |
|---|---|---|---|---|---|
| mead_ne | US-Ne1 | irrigated maize | **5.31** | 0.92 | {Jan, Dec} |
| mead_ne | US-Ne2 | irrigated maize-soy | **5.83** | 0.89 | {Jan, Dec} |
| mead_ne | US-Ne3 | rainfed maize-soy | **4.45** | 0.90 | {Jan, Dec} |
| tonzi_vaira_ca | US-Ton | blue-oak savanna | **3.94** | 0.94 | {Dec} |
| tonzi_vaira_ca | US-Var | annual grassland | **3.79** | 0.92 | {none} |
| metolius_or | US-Me2 | ponderosa pine | **1.43** | **0.47** | {Jan,Feb,Mar,Dec} |

**Results:**
- **F4 — Mead anchor validated.** Irrigated (5.31, 5.83) > rainfed (4.45) at annual scale, closure ~0.9. The pipeline must reproduce this contrast at the footprint (Gate P3).
- **F5 — Tonzi/Vaira self-consistent.** Two towers in one scene agree (3.94 vs 3.79); Mediterranean phenology (high-winter/low-summer EF) is present in the tower data — confirms D-D a third time.
- **F6 — Metolius is the R2 weak case, and worse than expected.** In 2023 US-Me2 exposes only a secondary EC system (`_2_1_1`) with **47% energy-balance closure**. EF 1.43 is likely an underestimate (poor closure → LE under-captured). **Open decision** — see §5bis.

**Empirical per-site winter masks (feed the Phase 2 pipeline mask, D-D):** Mead {Jan, Dec}, Tonzi {Dec}, Vaira {none}, Metolius {Jan, Feb, Mar, Dec}. Note this *extends* the Landsat-only Phase-0 masks (e.g. Mead was {Dec} on scene-count alone; the tower's low-Rn criterion adds Jan) — confirming D-D's "clear Landsat = 0 OR Rn below threshold."

**F7 — three `tower.py` fixes real AmeriFlux data forced (all shipped):**
1. **Winter mask is physical, not closure-based.** Closure is recorded-not-corrected (plan rule); a chronically poor-closing site (Metolius, ~0.47 all year) has valid physical EF and must not be masked for closure. Mask = EF outside [0,1]±0.05 OR monthly available energy < 25 W/m².
2. **AmeriFlux sensor resolution**: prefer measured over `_PI_F` gap-filled, and primary position (bare / `_1_1_1`) over secondary (`_1_2_1`); resolve after year-filtering; print all candidates for audit. Bare `NETRAD`/`LE` can be empty while a qualified variant holds the data.
3. Year-filter precedes column resolution.

## 5bis. Decision D-E — Metolius (US-Me2) 47% closure: ACCEPT WITH CAVEAT (LOCKED 2026-07-22)

The only tower at the forest stress site has poor 2023 energy-balance closure (0.47, secondary EC system). **Decision: keep 2023 US-Me2 as the reference, with a prominent closure caveat**, leaning on the already-looser ±0.10 forest Gate-P3 tolerance and the OpenET six-member spread band. This matches R2's "never present the forest number as crisp beside the crisp cropland number." Consequences to carry forward:
- Metolius tiles/card must **surface the closure value (0.47) and an "energy-balance not closed" flag** — do not present HRC 1.43 as a crisp point.
- Phase 3 uses the ±0.10 forest tolerance for Metolius (already planned).
- The forest number is reported **with the OpenET member-model spread as an uncertainty band**, never as a single crisp value.
- Considered and rejected for now: earlier-year US-Me2 (tower-year ≠ pipeline-year), backup-site swap (loses the ponderosa-pine biome). Either remains available if Phase 3 fails at Metolius.

## 4. Artefacts built to date

| File | Purpose | State |
|---|---|---|
| [`scripts/feasibility.js`](../scripts/feasibility.js) | Phase 0 diagnostic — OpenET coverage, Landsat counts, tower manifest, Mead sanity; exports `hrc_30m_usa_feasibility_phase0.csv`. | **Run, passed.** |
| [`tower.py`](../tower.py) | Phase 1 tower reference — monthly `EF_rn_g` and `EF_turbulent` from AmeriFlux BASE; physical winter mask; measured/primary-sensor resolution; closure recorded not corrected. Generalizes `test_c_frfon.py` to AmeriFlux BASE (gap G8). | **Run on all six towers (§3bis); `tower_ef_*.csv` written.** |
| `tower_ef_US-{Ne1,Ne2,Ne3,Ton,Var,Me2}.csv` | Per-tower per-month EF / closure / mask, for the Phase 3 archive. | **Written.** |
| [`src/App.jsx`](../src/App.jsx#L668-L676) | Gap **G1** fix — added `data_resolution_m === 30 → H3 res 10` mapping so future 30 m tiles render at ~65 m instead of falling through to a 9.8 km blob. No-op until 30 m data exists. | **Shipped; build + lint clean.** |
| [`docs/HRC_30m_test_sites_usa_implementation_plan_v1_0.md`](./HRC_30m_test_sites_usa_implementation_plan_v1_0.md) | Build map: reuse table, gap list G1–G8, locked decisions, phase-by-phase actions. | Current. |

Nothing above touches production tiles or schema. No DB migration has been written yet (migration 009 is intentionally deferred until Phase 2/3 fix the D2 denominator choice and the member-spread band shape — see implementation plan Phase 4).

---

## 5. The one open Phase-0 item

**Confirm AmeriFlux BASE half-hourly files exist for 2023** at the six towers (Gate P0 item 3, off-platform). Download from [ameriflux.lbl.gov](https://ameriflux.lbl.gov) (BASE-BADM product):

`US-Ne1, US-Ne2, US-Ne3, US-Ton, US-Var, US-Me2`

Coordinates/regimes are printed by `feasibility.js` and hard-coded in `tower.py`'s `TOWERS` manifest (single source of truth).

---

## 6. Next step (recommended)

1. Download **US-Ne1** BASE HH file.
2. Run: `python3 tower.py ~/Downloads/AMF_US-Ne1_BASE_HH_*.csv --tower US-Ne1`
3. Read the per-month `EF_rn_g` / `EF_turbulent` / `closure` table + seasonal mean. This validates the Phase-1 code against real data before Phase 2 is built on top of it, and starts closing **Gate P1** for Mead.

Then Phase 2 (`pipeline.js`): OpenET 30 m numerator + **both** D2 denominators, seasonal composite, per-tower month stacks, Mead-only geeSEBAL `H`. Phase 3 adjudicates D2 against the Phase-1 tower values — so tower data is on the critical path regardless of build order.

---

## 7. Build-order reminder

Mead end-to-end first (Phases 0→5) to prove the whole chain — including the G1/G7 integration fixes — on the easy, multi-tower, high-confidence case, then Tonzi/Vaira, then Metolius (hardest, thinnest Landsat). Sequence by descending confidence so any pipeline problem surfaces where the truth is clearest.
