# HRC 30 m US Test Sites — Phase 2 Build Handoff (`pipeline.js`)

| Field | Value |
|---|---|
| **Version** | 1.0 |
| **Date** | 2026-07-22 |
| **Status** | Phase 0 & 1 COMPLETE. **This is the brief to build Phase 2 in a fresh thread.** |
| **Purpose** | Self-contained handoff so a new session can build `scripts/pipeline.js` without the prior conversation. Read this + the completion report + the two named repo scripts; you need nothing else. |
| **Read-first** | `docs/HRC_30m_test_sites_usa_phase0_1_completion_report_v1_0.md` (the data), `docs/HRC_30m_test_sites_usa_implementation_plan_v1_0.md` (build map, gaps G1–G8) |

---

## 0. How to use this handoff (new thread)

You are Claude Code in the `earth-hrc-index` repo. Phases 0–1 are done by a prior session. Your job is **Phase 2: write `scripts/pipeline.js`** (Google Earth Engine, JavaScript) — the 30 m OpenET pipeline that produces per-tile evaporative fraction for three US flux-tower sites, plus the per-tower footprint stacks Phase 3 validates.

**Orientation actions (do these first, ~5 min):**
1. Read `docs/HRC_30m_test_sites_usa_phase0_1_completion_report_v1_0.md` — the tower references (§5) and per-site winter masks (§5.3) are your validation targets and masking inputs.
2. Read `scripts/31_hrc_v2_1_idf_tiles_v2_2.js` — the **template**: named constants at top, per-region image build, `Export.table.toDrive` schema. Copy its structure and house style.
3. Read `scripts/37_albedo_modifier_phase0_diagnostic.js` §`buildRegionImage` — a worked net-radiation build (net shortwave from SW_down×(1−albedo); net longwave from LST⁴×emissivity×σ). You will build the analogous thing at **30 m from Landsat** (denominator A).
4. Skim `scripts/feasibility.js` — the site boxes, tower coords, and asset IDs live there (and in §3 below).

**Do NOT** touch production tiles, the database, or `src/` in Phase 2. Output is CSVs to Google Drive only. Build **Mead first**, prove it, then generalize.

---

## 1. Project one-paragraph context

The HRC Index scores land by heat-regulation capacity ≈ evaporative fraction (EF = λE/Rn), 0–10. Production tiers are 9 km (ERA5) and 500 m (PML/MODIS). This work adds a **30 m demonstration tier** over three US AmeriFlux sites using **OpenET** (turnkey 30 m monthly ET for CONUS, CC-BY-4.0) as the latent-heat numerator. The honest label: a **full-year 30 m EF product, winter-masked**, referenced to the existing 500 m ecoregion baseline. It is close to but not identical with the production annual score.

---

## 2. Locked decisions that constrain Phase 2

| ID | Decision | What it means for `pipeline.js` |
|---|---|---|
| **D-B** | geeSEBAL turbulent layer **at Mead only**, held from public card | Scaffold a Mead-only sensible-heat `H` run → `EF_turbulent = LE/(LE+H)`. Tonzi/Vaira + Metolius: latent-heat EF only. |
| **D-C** | `region_code = mead_ne \| tonzi_vaira_ca \| metolius_or`; `data_source = <site>_landsat_30m_2023` | Tag every exported row with these. `data_resolution_m = 30`. |
| **D-D** | Full calendar-year composite, **per-site winter masking** | Compute all 12 months; drop the masked months (§3.3); annual composite = mean of unmasked monthly EF. Emit `months_masked` count. |
| **D-E** | Metolius accepted with closure caveat | Emit the **OpenET six-member spread** at Metolius as an uncertainty band; never a crisp single value. |
| **D2** | *(the crux — pre-registered)* build **both** net-radiation denominators, tower adjudicates in Phase 3 | Produce EF twice per month: denominator **A** (clear-sky 30 m Landsat Rn) and **B** (all-sky ERA5 Rn, texture-downscaled). Do not pick a winner — that is Phase 3. |

---

## 3. Inputs (everything `pipeline.js` needs)

### 3.1 Assets
- **Numerator (LE)**: `OpenET/ENSEMBLE/CONUS/GRIDMET/MONTHLY/v2_0`, band `et_ensemble_mad` (ensemble ET, mm/month). Member bands for the D-E spread: the six model members are in the per-model OpenET collections (`OpenET/GEESEBAL/…`, `OpenET/SSEBOP/…`, `OpenET/PTJPL/…`, `OpenET/SIMS/…`, `OpenET/DISALEXI/…`, `OpenET/EEMETRIC/…`) monthly — sample all six at Metolius footprints for the band; `et_ensemble_mad_min`/`_max`/`_sd` on the ensemble asset are a cheaper first cut.
- **Landsat (denominator A, 30 m)**: `LANDSAT/LC08/C02/T1_L2` + `LANDSAT/LC09/C02/T1_L2`. Bands: `ST_B10` (surface temp, scale 0.00341802 + 149.0 K), `ST_EMIS` (emissivity, scale 0.0001), surface reflectance `SR_B*` for broadband albedo (Liang 2001). QA: `QA_PIXEL` for per-pixel cloud/shadow masking.
- **All-sky radiation (denominator B magnitude + SW_down/LW_down)**: `ECMWF/ERA5_LAND/MONTHLY_AGGR` — `surface_solar_radiation_downwards_sum`, `surface_thermal_radiation_downwards_sum`, `surface_net_solar_radiation_sum`, `surface_net_thermal_radiation_sum`.
- **Ecoregions (D3 reference label)**: `RESOLVE/ECOREGIONS/2017`.

### 3.2 Site boxes & towers (also in `scripts/feasibility.js`)
| `region_code` | bbox lon/lat | towers (id · regime · lon,lat) |
|---|---|---|
| mead_ne | −96.52,41.14 → −96.40,41.20 | US-Ne1 irrig-maize (−96.4766,41.1651) · US-Ne2 irrig-maize-soy (−96.4701,41.1649) · US-Ne3 rainfed (−96.4397,41.1797) |
| tonzi_vaira_ca | −121.00,38.38 → −120.92,38.46 | US-Ton oak-savanna (−120.9660,38.4309) · US-Var grassland (−120.9508,38.4133) |
| metolius_or | −121.62,44.40 → −121.50,44.50 | US-Me2 ponderosa-pine (−121.5574,44.4523) |

### 3.3 Pipeline winter masks + the tower/pipeline intersection (D-D, D-G, D-H)
Apply the **uniform D-G rule** to the pipeline exactly as `tower.py` applies it to the tower: exclude a month where EF ∉ [−0.05, 1.05], **or** monthly mean available energy (Rn−G) < 25 W/m², **or** valid-coverage < 0.50 (for the pipeline, "coverage" = clear-Landsat availability). **Pipeline low-energy months** (the Rn-floor result, your primary masking target):
- **mead_ne**: **{1, 12}**
- **tonzi_vaira_ca**: **{12}**
- **metolius_or**: **{1, 2, 3, 12}**

The tower additionally drops some months on *tower-record* coverage (US-Ton {4}, US-Me2 {6,10}); those are data-completeness issues on the tower side, not pipeline issues. **Per D-H, Gate P3 compares the pipeline to the tower over the INTERSECTION of pipeline-valid ∩ tower-valid months** — so compute the pipeline's own valid-month set and intersect; do not hardcode the tower's exclusions into the pipeline.

### 3.4 Tower references to validate against — CORRECTED, ratio-of-annual-sums (D-F)

**These are the headline Gate-P3 targets** (`HRC = 10 × Σ LE / Σ available energy` over unmasked months). The earlier mean-of-monthly-ratios values are **superseded** (they biased biomes in opposite directions — see `docs/HRC_scoring_conventions_source_of_truth.md`).

| Tower | Regime | **Tower HRC (D-F)** | ~~old (mean-of-ratios)~~ | annual closure |
|---|---|---|---|---|
| US-Ne1 | irrigated maize | **5.70** | ~~5.31~~ | 0.92 |
| US-Ne2 | irrigated maize-soy | **6.01** | ~~5.83~~ | 0.89 |
| US-Ne3 | rainfed maize-soy | **4.81** | ~~4.45~~ | 0.90 |
| US-Ton | oak savanna | **2.95** | ~~3.94~~ | 0.94 |
| US-Var | grassland | **2.83** | ~~3.79~~ | 0.92 |
| US-Me2 | ponderosa pine | **1.91** (soft) | ~~1.43~~ | 0.47 (caveat, D-E) |

Full per-month tower EF is in `tower_ef_<id>.csv` (repo root). **Two core validations the pipeline must reproduce (D-J — check the monthly curve, not just the annual scalar):**
1. **Mead**: irrigated (≈5.7–6.0) > rainfed (≈4.8) at the footprint.
2. **Tonzi/Vaira**: annual values are nearly equal (2.95 vs 2.83) but **summer diverges** — savanna EF 0.15–0.22 *above* grassland 0.02–0.10. An annual-only gate could pass a pipeline that gets this backwards; check the summer months explicitly.

---

## 4. What `pipeline.js` must produce

Per site, for calendar year 2023:

1. **Numerator** — OpenET monthly LE. Convert `et_ensemble_mad` (mm/month) to monthly latent-heat energy: `LE_J = et_mm × 2.45e6` (J/m², since 1 mm ≡ 1 kg/m²). Keep monthly.
2. **Denominator A — clear-sky 30 m** (D2): per month, from clear Landsat scenes over the box:
   - net shortwave `= SW_down × (1 − albedo_broadband)` (SW_down from ERA5; albedo 30 m Liang-2001 from Landsat SR).
   - net longwave `= LW_down − ε·σ·LST⁴` (LW_down from ERA5; ε=`ST_EMIS`, LST=`ST_B10`, σ=5.67e-8).
   - `Rn_A = net_sw + net_lw` at 30 m. Per-pixel cloud-mask via `QA_PIXEL`, then monthly mean.
3. **Denominator B — all-sky texture-downscaled** (D2): take ERA5-Land all-sky monthly net radiation (`surface_net_solar_radiation_sum + surface_net_thermal_radiation_sum`, ~9 km, correct magnitude) and impose the 30 m spatial pattern of the Landsat clear-sky Rn field (e.g. `Rn_B = Rn_ERA5_allsky × (Rn_A / mean(Rn_A over ERA5 cell))`). Correct magnitude, 30 m texture.
4. **Monthly EF, both denominators**: `EF_A_month = LE_J / (Rn_A_J − G_month)`, `EF_B_month = LE_J / (Rn_B_J − G_month)`. G is small at monthly scale (D1) — use ERA5-Land `G` if convenient, else 0 and note it. Clip EF to [0,1].
5. **Annual composite** (D-D): mean over **unmasked** months (§3.3) → `ef_annual_A`, `ef_annual_B`. Emit `months_masked` count.
6. **Per-tower footprint stacks** (for Phase 3): retain the per-month EF (both denominators) in a small pixel **window** around each tower (not one pixel — footprint-weighted; R6), exported so Phase 3 can compare against `tower_ef_<id>.csv` month-by-month.
7. **Metolius member spread** (D-E): the six OpenET members' EF at the US-Me2 footprint, as an uncertainty band.
8. **Mead only — geeSEBAL H** (D-B): run geeSEBAL on the same Landsat scenes for sensible heat `H`, compute `EF_turbulent = LE/(LE+H)` at Mead footprints. Label modelled.

**Gate P2**: clean annual composites for both denominators; no unmasked cloud; per-tower month stacks retained; masks match §3.3.

---

## 5. CSV export schema (FIX IT HERE — `import.py` will depend on it)

Two exports per site. Tile CSV (one row per 30 m→H3-res-10 cell, but Phase 2 may export at native 30 m and aggregate in Phase 4 — either is fine as long as the columns below exist):

```
longitude, latitude,
ef_annual_A, ef_annual_B,          // both D2 denominators, annual composite
hrc_A, hrc_B,                       // = ef_annual_* × 10
annual_mean_le_wm2,                 // growing/annual mean latent heat (W/m2) — Cooling Work (§4.6)
months_masked,                      // count of winter months dropped
openet_member_spread,               // nullable; populated at Metolius (D-E)
region_code, data_source,           // per D-C
data_resolution_m,                  // 30
source_window                       // '2023-01-01/2024-01-01'
```

Footprint CSV (one row per tower per month, for Phase 3):
```
tower_id, region_code, month,
ef_A_month, ef_B_month,             // pipeline EF at footprint window, both denominators
ef_turbulent_month,                 // Mead only (D-B); else null
n_landsat_scenes,                   // that month, over the box
masked                              // bool, per §3.3 rule
```

Export to Drive folder `EarthHRC`, filenames `hrc_30m_<region_code>_tiles.csv` and `hrc_30m_<region_code>_footprint.csv`.

---

## 6. Build order & validation

- **Mead first** (proves the chain on the high-confidence, multi-tower case). Then Tonzi/Vaira, then Metolius.
- After Mead's footprint CSV exists, the Phase-3 check is: does `ef_*_month` at the US-Ne1/2/3 windows track `tower_ef_US-Ne{1,2,3}.csv`, and does the pipeline reproduce **irrigated > rainfed**? Both denominators are compared; the winner is chosen in Phase 3 (Gate P3: within ±0.06 crop/grass, ±0.10 forest, no month-bias trend, choice recorded before import). **Do not pick the D2 winner in Phase 2.**

---

## 7. Gotchas learned in Phases 0–1 (save yourself the debugging)

1. **OpenET is all-sky monthly; denominator A is clear-sky.** That mismatch is the whole reason D2 builds both denominators — expect A to be biased vs the tower; B corrects magnitude. Don't "fix" it early.
2. **Winter EF is undefined, not just noisy.** At Mead/Metolius, monthly Rn→0 in winter makes EF blow up (tower US-Me2 Jan EF ≈ 17). Mask on the **available-energy floor (Rn−G < 25 W/m²) or EF∉[0,1]**, not on energy-balance closure.
3. **Metolius closes at 47%** (secondary EC system, 2023). Its EF is likely an underestimate; report with the member-spread band (D-E). Phase-3 tolerance is ±0.10 there.
4. **The Phase-0 sanity EF ran hot (~0.95)** because it used a shared ~9 km ERA5 denominator; the 30 m denominator A/B is what fixes it. Not a bug.
5. **Landsat has thin winter months** (Mead Dec = 0 scenes, Metolius Feb = 0) — those are the masked months; single-scene winter months at Metolius have no cloud-mask redundancy.
6. **Rn sign**: ERA5 `surface_net_thermal_radiation_sum` is signed (a loss), so `Rn = net_solar + net_thermal`.

---

## 8. First actions for the new thread

1. Read the three files in §0.
2. Write `scripts/pipeline.js` for **Mead only** first: numerator + denominator A + denominator B + monthly EF (both) + annual composite with mask {1,12} + the three US-Ne footprint stacks. Export both CSVs.
3. Sanity-check in the GEE console: US-Ne1 footprint annual EF_A and EF_B should bracket the tower 5.31; irrigated (Ne1/Ne2) footprint EF > rainfed (Ne3). Print before exporting.
4. Once Mead looks right, generalize the site loop to Tonzi/Vaira (mask {12}) and Metolius (mask {1,2,3,12} + member spread). Add the Mead-only geeSEBAL H last.
5. Update the completion report / implementation-plan Gate-P2 checkbox when composites are clean.

**Deliverable of Phase 2:** `scripts/pipeline.js` + `hrc_30m_<site>_tiles.csv` and `hrc_30m_<site>_footprint.csv` for all three sites, ready for Phase 3 validation against the §3.4 tower references.
