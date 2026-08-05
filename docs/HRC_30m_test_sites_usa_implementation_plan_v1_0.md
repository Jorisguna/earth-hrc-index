# HRC 30-metre US Test Sites — Implementation Plan (build handoff)

| Field | Value |
|---|---|
| **Version** | 1.0 |
| **Date** | 2026-07-22 |
| **Status** | Ready to execute — Phase 0 not yet run |
| **Companion to** | `HRC_30m_test_sites_usa_project_plan_v1_0.md` (the project plan / scientific design). This document is the **build** counterpart: it maps each phase onto concrete files in this repository, flags the integration gaps the project plan does not name, and orders the work. |
| **Scope** | Mead NE, Tonzi/Vaira CA, Metolius OR — three OpenET-driven 30 m seasonal EF tile sets, integrated as a new tier alongside the existing 9 km / 500 m tiers. |

---

## 1. Review of the project plan

The scientific design is sound and I am not asking to change it. Strengths worth keeping:

- **Pre-registration of D2** (both net-radiation denominators built, tower adjudicates in Phase 3, choice recorded before looking) is the right discipline and mirrors nothing we currently do — it's an upgrade to the project's methodology hygiene.
- **Confidence-descending build order** (Mead → Tonzi/Vaira → Metolius) surfaces pipeline bugs where the truth is clearest. Keep it.
- **Honest forest framing** (R2: OpenET member-model spread as an uncertainty band, looser ±0.10 gate) matches the project's existing "trust-the-data, no silent disables" posture from v2.2.
- **Cooling Work becomes a real number** (§4.6) — this repo already ships a Cooling Work view and a `latent_heat_flux_annual_wm2` column, so §4.6 lands on existing rails.

What the project plan **under-specifies** — the gaps this build plan exists to close. Each is grounded in a specific file:

| # | Gap the project plan doesn't name | Evidence in repo | Consequence / resolution |
|---|---|---|---|
| **G1** | **No H3 resolution mapping for a 30 m tier.** The renderer maps only `500→res8`, `70→res10`, everything else `→res5`. A tile tagged `data_resolution_m = 30` falls through to res 5 (~9.8 km hexes). | [App.jsx:668-670](src/App.jsx#L668-L670) | 30 m tiles render as giant 9.8 km blobs. The whole "higher fidelity" demo is invisible. **Must add a `30→10` (or `65→10`) branch.** |
| **G2** | **Resolution isolation is keyed on `region_code`, not `data_source`.** The project plan (§4/§8) specifies three distinct `data_source` tags. But `hrc_tiles_default` picks `MIN(data_resolution_m)` **per `region_code`**. | [007_refresh_hrc_tiles_default_view.sql:28-41](scripts/migrations/007_refresh_hrc_tiles_default_view.sql#L28-L41) | If a site's 30 m tiles share a `region_code` with any coarser tiles, the view silently hides the coarse ones — or, worse, if `region_code` is left null/shared, the "never average 30 m and 500 m" guarantee (Gate P5) is not actually enforced. **Each site needs its own `region_code`.** |
| **G3** | **The headline "500 m-annual vs 30 m-seasonal side-by-side" (§5, §8) has no 500 m layer to compare against at these sites.** IDF and Tapajós have a real 500 m production tier; Mead/Tonzi/Metolius have **neither** a 500 m nor a 9 km tile today. | REGIONS list has no US flux sites; only IDF/Tapajós carry 500 m ([App.jsx:66-73](src/App.jsx#L66-L73)) | The advertised side-by-side would compare 30 m against **empty**. **RESOLVED (D-A): reference line only** — 30 m score sits beside the 500 m ecoregion reference number on the card; no coarse tile layer, no resolution toggle. |
| **G4** | **Low-zoom disappearance.** At `zoom < 9` the app queries only `data_resolution_m = 9000`. The three sites have no 9 km tier, so they vanish when zoomed out. | [App.jsx:642-646](src/App.jsx#L642-L646) | Region-nav buttons must fly straight to `zoom ≥ ~12`; the sites are simply absent at regional zoom. Acceptable, but must be a conscious choice, and the nav zoom must be set high. |
| **G5** | **The v2.2 importer is not reusable for OpenET EF tiles.** `import_hrc_v2_2_tiles.py` hardcodes the albedo-modifier methodology, formula string, and eight albedo columns that don't exist in an OpenET product. | [import_hrc_v2_2_tiles.py:66-67,140-170](scripts/import_hrc_v2_2_tiles.py#L66-L170) | The generic `import.py` deliverable must be a **new** importer. Copy the batch-size-250 + retry/back-off resilience (it's hard-won), but a new column set and new methodology tag. |
| **G6** | **No schema migration is called for.** The new product needs columns the current `hrc_tiles` lacks: denominator-choice (A/B), OpenET ensemble member spread (the R2 forest band), growing-season mean LE, and the monthly/seasonal qualifier. | Migrations stop at `008` | Add **migration 009**. Enumerated in §4, Phase 4. |
| **G7** | **Cooling Work label says "annual".** The legend reads "Annual mean latent heat flux" and the headline "Mean cooling work"; these tiles are **growing-season**, not annual. | [App.jsx:501](src/App.jsx#L501), [App.jsx:317-319](src/App.jsx#L317-L319) | §4.6 requires a "growing-season" label. Needs a per-tile / per-tier conditional label, not a global rename (IDF/Tapajós stay annual). |
| **G8** | **AmeriFlux BASE ≠ ICOS FLUXNET column names.** The existing tower scripts read `LE_F_MDS` / `LE_CORR` / `NETRAD` (ICOS format). AmeriFlux BASE uses `LE`, `NETRAD`, `G`, `H`, `SW_IN`, etc. | [test_c_frfon.py:38-46](test_c_frfon.py#L38-L46) | `tower.py` (Phase 1) should generalize `test_c_frfon.py`'s aggregation logic but with an AmeriFlux column map. Don't assume the France script runs as-is. |

None of these are reasons to change the science. They are the difference between "the pipeline produces correct numbers" and "the numbers actually appear, isolated and correctly labelled, in the live app." The project plan is strong on the former and thin on the latter.

---

## 2. Reuse map — what already exists that we build on

| Project-plan deliverable | Existing asset to generalize | Notes |
|---|---|---|
| `tower.py` (Phase 1 tower EF) | [test_c_frfon.py](test_c_frfon.py), [test_b.py](test_b.py) | Annual ratio-of-sums, closure-corrected vs uncorrected — exactly the Phase-1 pattern. Re-parameterize for AmeriFlux columns + monthly grouping (G8). |
| `import.py` (Phase 4) | [import_hrc_v2_2_tiles.py](scripts/import_hrc_v2_2_tiles.py) | Copy batch/retry resilience; new column set (G5). |
| Import runbook | [docs/hrc_import_process.md](docs/hrc_import_process.md) | Extend with per-site DELETE boxes + new `region_code`s. |
| Tier selection / no-mixing | [007_refresh_hrc_tiles_default_view.sql](scripts/migrations/007_refresh_hrc_tiles_default_view.sql) | Already does MIN-resolution-per-region; works for us **iff** G2 (distinct `region_code`) is honoured. Likely **no view change needed**. |
| Cooling Work view + column | `latent_heat_flux_annual_wm2`, cooling view mode | Populate with growing-season mean LE; fix label (G7). |
| Provenance-overlay pattern (sample points on map) | centroid overlay in [App.jsx:857-887](src/App.jsx#L857-L887) | Precedent for surfacing tower footprints / OpenET member spread as an inspectable overlay — aligns with the `feedback_sample_provenance_visibility` memory. |
| GEE tile script skeleton | [scripts/31_hrc_v2_1_idf_tiles_v2_2.js](scripts/31_hrc_v2_1_idf_tiles_v2_2.js) | Structure (named constants at top, per-ecoregion join, CSV export schema) is the template for `pipeline.js`. |

---

## 3. Decisions — LOCKED (2026-07-22)

- **D-A — the side-by-side (G3): REFERENCE LINE ONLY.** No coarse companion tile layer. The 30 m-seasonal tiles sit beside the 500 m ecoregion **reference number** on the Bioregion Card (D3 handling), clearly labelled. **Consequence:** Phase 5 does *not* build a second map layer or a resolution toggle; G3's "companion tile" branch is dropped. The headline is reframed honestly as "30 m-seasonal score vs the 500 m ecoregion reference" — a card field, not a dual map.
- **D-B — geeSEBAL turbulent layer (Q1): BUILD AT MEAD, HOLD FROM CARD.** `pipeline.js` scaffolds the sensible-heat `H` / `EF_turbulent = LE/(LE+H)` layer at **Mead only**; validate against the tower in Phase 3; keep it **out of the public Bioregion Card** until Formula 3 matures. Tonzi/Vaira and Metolius: latent-heat EF only. Adds ~1 session at Mead.
- **D-D — full calendar-year composite, NOT growing-season (LOCKED 2026-07-22, post Phase-0 12-month survey).** OpenET is monthly year-round, so the numerator never limits the window; winter is a *denominator* problem (near-zero net radiation, snow) handled by **per-site quality masking** — compute all 12 months, drop a month where clear Landsat = 0 or monthly Rn is below a defined-EF threshold, and **report which dropped** (no blind exclusion). Evidence: only Mead {Dec} and Metolius {Feb} have zero clear scenes; Tonzi/Vaira is usable all 12 months and its green season is Nov–May, which a fixed Apr–Oct window would have discarded. **This makes the product annual** (faithful to the annual 500 m reference under D-A) and shifts the label from "growing-season mean" to "annual (winter-masked)" — see G7, §4.6, and Phase 4 below.
- **D-C — naming: `site_state` for `region_code`.** `region_code = mead_ne | tonzi_vaira_ca | metolius_or` (one per site — this is what enforces G2 resolution isolation, since `hrc_tiles_default` returns `MIN(data_resolution_m)` per `region_code`). `data_source = mead_ne_landsat_30m_2023 | tonzi_vaira_ca_landsat_30m_2023 | metolius_or_landsat_30m_2023` (provenance/label only, no rendering or isolation effect). **Rationale:** `region_code` names a *place* everywhere else in the codebase (`idf`, `tapajos`, `wales`); OpenET/Landsat provenance belongs in `data_source` + `hrc_formula`, so a future OpenET reprocess or sensor swap never forces a region rename.

---

## 4. Phase-by-phase build

Phase gates are the project plan's; the **build actions** below are new and repo-specific. Everything is Mead-first, then generalized.

### Phase 0 — Feasibility (per site) — `scripts/feasibility.js`
- New GEE script. Confirm OpenET `OpenET/ENSEMBLE/CONUS/GRIDMET/MONTHLY/v2_0` months exist over each box; count clear Landsat scenes/month; verify AmeriFlux year overlap; one-month Mead irrigated-vs-rainfed EF sanity print.
- **Gate P0** per site. Output a one-screen feasibility table to the GEE console; paste into a `docs/` findings note (matches the `HRC_albedo_modifier_phase0_findings_v1.md` precedent).

### Phase 1 — Tower reference (per tower) — `scripts/tower.py`
- Generalize [test_c_frfon.py](test_c_frfon.py): monthly grouping, AmeriFlux column map (G8), both `LE/(Rn−G)` and (if D-B) `LE/(LE+H)`, record energy-balance closure (don't correct silently — the France scripts already model this).
- Emit `tower_ef_<site>.csv`: one row per site-month, columns `ef_rn_g`, `ef_turbulent?`, `closure_ratio`, `n_halfhours`.
- **Gate P1**: monthly tower EF for every site-month; closure recorded.

### Phase 2 — 30 m pipeline (GEE) — `scripts/pipeline.js`
- Numerator: OpenET monthly LE. **Both** denominators (D2): A = clear-sky 30 m Landsat Rn; B = ERA5-Land all-sky Rn texture-downscaled to the Landsat clear-sky pattern.
- Monthly EF (both) → **annual composite over all 12 months, with per-site winter masking (D-D)**: drop a month where clear Landsat = 0 or monthly Rn is below a defined-EF threshold; emit `months_masked` per tile. Phase-0 provisional masks: Mead {Dec}, Metolius {Feb + single-scene months that fail per-pixel cloud masking over the tower}, Tonzi/Vaira {none}. Composite = mean of the *unmasked* monthly EF.
- Retain per-month stack at each tower pixel (for Phase 3).
- Emit the **OpenET six-member spread** at forest pixels (R2 band).
- Optional geeSEBAL H run at Mead only (D-B).
- Template from [31_hrc_v2_1_idf_tiles_v2_2.js](scripts/31_hrc_v2_1_idf_tiles_v2_2.js): named constants at top; CSV export schema fixed here so `import.py` can rely on it.
- **Gate P2**: clean composites both denominators; no unmasked cloud; per-tower stacks retained.

### Phase 3 — Validation (the decision point) — `scripts/validate.py`
- Compare 30 m seasonal EF at each tower **footprint window** (not one pixel — R6) against Phase-1 tower value, **both** denominators.
- **Gate P3**: winner within **±0.06** (crop/grass) / **±0.10** (forest); no month-bias trend; D2 A-vs-B choice **recorded with evidence before importing**. Fail → stop, do not import.
- Record the D2 verdict in a `docs/` note; this is the pre-registered decision.

### Phase 4 — Aggregate, reference, import — `scripts/aggregate.js` + `scripts/import.py` + migration 009
- `aggregate.js`: aggregate each site to **H3 res 10** (~65 m edge); apply D3 reference handling (inherit RESOLVE 2017 ecoregion reference from the 500 m tier, labelled — or scene-relative, labelled); populate annual (winter-masked) mean LE (§4.6, D-D).
- **Migration `009_openet_30m_tier.sql`** (closes G6). New columns on `hrc_tiles`:
  - `ef_annual` (the 30 m annual composite EF over unmasked months),
  - `net_rad_denominator` (`'A_clearsky'` | `'B_allsky_downscaled'` — the D2 winner),
  - `openet_member_spread` (R2 forest uncertainty band; nullable),
  - `annual_mean_le_wm2` (§4.6 Cooling Work, over unmasked months; distinct from the true-annual `latent_heat_flux_annual_wm2`),
  - `temporal_qualifier` (`'annual_winter_masked'` — drives the G7 label; D-D),
  - `months_masked` (integer count of winter months dropped per tile — makes the qualifier honest).
  - Re-expand `hrc_tiles_default` (the view freezes its column list — same lesson as migration 007) so the new columns surface at `zoom ≥ 9`.
- `import.py` (closes G5): new importer, copy the 250-row-batch + retry/back-off from the v2.2 importer, new column set, `data_resolution_m = 30`, distinct `region_code` + `data_source` per D-C.
- **Gate P4**: tiles imported; distinct tags; H3 res recorded; fields labelled.

### Phase 5 — App integration (`src/`)
The concrete edits, in order:
1. **G1 — H3 mapping.** [App.jsx:668-670](src/App.jsx#L668-L670): add `t.data_resolution_m === 30 ? 10` (or map 30 m to res 10 explicitly). Without this nothing else matters.
2. **G4 — region nav.** Add Mead / Tonzi-Vaira / Metolius to `REGIONS` ([App.jsx:66-73](src/App.jsx#L66-L73)) at `zoom ≥ 12`.
3. **G7 — Cooling Work label.** Conditional label driven by `temporal_qualifier` (D-D): "annual (winter-masked, N months dropped)" for these sites vs the true-annual "annual mean" of IDF/Tapajós, in the Legend ([App.jsx:501](src/App.jsx#L501)) and headline ([App.jsx:317](src/App.jsx#L317)).
4. **Bioregion Card** ([src/components/BioregionCard.jsx](src/components/BioregionCard.jsx)): surface `ef_annual`, denominator choice, member spread (forest), annual (winter-masked) LE, and `months_masked` — every field carrying the temporal + reference-provenance qualifier.
5. **Reference-line framing** (D-A = reference line only): the Bioregion Card shows the 30 m-seasonal score beside the 500 m ecoregion reference number, labelled — **no** second map layer, no resolution toggle.
6. **G2 verification** — confirm at runtime that `hrc_tiles_default` returns only 30 m rows for the three new `region_code`s (no mixed-resolution aggregation). Likely **no SQL change** needed; just verify.
- **Gate P5**: all tiers render; every card field qualified; no mixed-resolution aggregation.

### Phase 6 — Documentation — `HRC_30m_test_sites_usa_methodology_v1_0.md`
- Write it so the pipeline reproduces from the document alone; tag every claim built-vs-specified; turbulent layer (if built) tagged built-but-modelled.
- **Gate P6**.

---

## 5. Build order & effort

Mead end-to-end first (Phase 0→5) to prove the whole chain including app integration on the easy, multi-tower case, **then** Tonzi/Vaira, then Metolius. This front-loads not just the science (per the project plan) but the **integration risk** (G1/G2/G7 are one-time fixes proven on Mead). Rough effort tracks the project plan's ~8–11 sessions; the integration fixes (G1–G7) add ~0.5–1 session, mostly one-time on Mead.

## 6. Definition of done (roll-up)
- [ ] D-A / D-B / D-C decided (§3)
- [ ] P0–P3 gates passed per site; D2 winner recorded pre-import
- [ ] Migration 009 applied; `hrc_tiles_default` re-expanded
- [ ] Three sites imported, distinct `region_code` **and** `data_source`, `data_resolution_m = 30`
- [ ] G1 (H3 res), G4 (nav), G7 (label) shipped; card fields qualified
- [ ] Verified in live app: 30 m hexes render at ~65 m; no 30 m/coarse mixing; growing-season labels correct
- [ ] Methodology doc reproducible standalone
