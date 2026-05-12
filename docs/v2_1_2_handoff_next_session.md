# v2.1.2 Handoff — Resume in Next Session

Snapshot of where the v2.1.2 (absolute latent heat flux / "cooling work") build sits, so the next context window can pick up cold.

---

## Current state — what's done

| Item | Status |
|---|---|
| Migration `scripts/migrations/006_absolute_latent_heat_flux.sql` | **Applied** in Supabase (confirmed implicitly by successful import — column exists, inserts went through). |
| GEE script `scripts/31_hrc_v2_1_idf_tiles_v2_1_2.js` | Run, exported, **imported**. In-pipeline gate (n=15,994): FR-Fon 36.71 W/m², IDF mean 35.73 W/m². |
| GEE script `scripts/32_hrc_v2_1_tapajos_tiles_v2_1_2.js` | Run, exported, **imported**. In-pipeline gate (n=30,559): K67 95.08 W/m², Tapajós mean 90.46 W/m². |
| Patched `scripts/merge_and_import_v2_1_higher_fidelity.py` | **Run.** 46,553 rows inserted across IDF + Tapajós, 0 failures. |
| New `scripts/validate_latent_heat_flux.py` | **Run & PASSED.** FR-Fon pixel 36.71 ✓, K67 pixel 95.08 ✓, IDF regional mean 36.82 ✓. Tapajós regional mean 93.16 W/m² (3.16 over the 90 soft gate — flag-not-halt per handoff). |
| Patched `scripts/validate_satellite_vs_tower.py` | **Run & PASSED.** FR-Fon HRC 5.704 (diff −0.476, within ±0.5 hard gate). K67 HRC 5.622 (diff −2.028, around ±2.0 calibration range — see notes below). |
| `docs/v2_1_2_patches.md` | Done. Records tooltip wording, label "Cooling work", unit W/m², display rules. |
| **v2.1.1 tile records in Supabase** | **Replaced** with v2.1.2 tiles. |
| Commit `fbf6545` on `main` | **Created**, not yet pushed. Bundles the migration, GEE scripts, import patch, both validators, and the patches doc. |
| `src/components/BioregionCard.jsx` Cooling work row | **NOT DONE.** |
| `src/lib/explainers.js` `coolingWork` entry | **NOT DONE.** |

---

## What the user is doing right now

Wiring the BioregionCard "Cooling work" row + `coolingWork` explainer (the last unblocked UI work in scope). After that, push `main` to deploy via Vercel.

---

## File naming convention (confirmed with user)

Staging folder: `~/Downloads/v2.1_1/` (reusing the existing folder, name not bumped to `v2.1_2`).

| File | Exact name expected |
|---|---|
| IDF tiles | `hrc_v2_1_idf_tiles_v2_1_2.csv` |
| Tapajós tiles | `hrc_v2_1_tapajos_tiles_v2_1_2.csv` |
| IDF reference | `hrc_v2_1_1_idf_reference.csv` (unchanged from v2.1.1 — references are HRC p90 values, not per-tile) |
| Tapajós reference | `hrc_v2_1_1_tapajos_reference.csv` (unchanged) |

The import script's glob (`hrc_v2_1_*_tiles_v2_1_2.csv` for tiles, `hrc_v2_1_1_{slug}_reference.csv` for references) matches this naming exactly.

---

## Resume sequence

Steps 1–5 (migration, staging, import, both validators) all **completed and passed**. Start at step 6.

6. **Apply UI changes** — `BioregionCard.jsx` Cooling work row + `explainers.js` `coolingWork` entry (see next section).
7. **Commit + push** the UI changes (the prior commit `fbf6545` covers everything else) to deploy via Vercel.

---

## Outstanding UI work (not yet started)

Two files. Wording and styling already locked in `docs/v2_1_2_patches.md` — no design decisions left.

### `src/components/BioregionCard.jsx`

Add a new row between Restoration Gap and Ecoregion. Hide entirely when value is NULL (pre-v2.1.2 tiles).

```jsx
{tile.latent_heat_flux_annual_wm2 != null && (
  <div className="card-row">
    <span className="card-key">
      Cooling work
      <InfoBtn onClick={() => onInfo('coolingWork')} />
    </span>
    <span className="card-val">
      {Math.round(tile.latent_heat_flux_annual_wm2)} W/m²
    </span>
  </div>
)}
```

### `src/lib/explainers.js`

Add a `coolingWork` key with this exact tooltip text (confirmed with user May 2026):

> The absolute rate at which this tile moves energy upward through evaporation, averaged across the year. Higher values mean more total cooling work delivered. The HRC score above measures *efficiency* (the fraction of received energy used for cooling); this number measures *magnitude* (the total cooling work). Forests typically deliver more cooling work in absolute terms even when their efficiency ratio looks similar to or below intensively managed cropland, because forests absorb more sunlight to begin with.

---

## Key constants / strings to remember

- Methodology version filter (all scripts and UI): `'v2.1.2_higher_fidelity'`
- HRC formula tag in DB: `'pml_v2_500m_v2.1.2'`
- Batch ID: `'2026-Q2-v2.1.2-higher-fidelity'`
- New column: `latent_heat_flux_annual_wm2` (NUMERIC)
- Conversion: `annual_latent_heat_J/m²/yr ÷ 31,536,000` (or `et_mm/yr × 0.0777`)
- PML dataset: `CAS/IGSNRR/PML/V2_v018`

---

## Things that might trip the next session

- **Migration number was renumbered** from handoff's `004` to local `006` (we already had 004 + 005). Don't be confused by the mismatch with the original handoff doc.
- **v2.1.1 tiles are gone.** If validation fails, you cannot fall back to v2.1.1 in Supabase — would need to re-import from the v2.1.1 CSVs (still on disk).
- **Reference CSVs are intentionally v2.1.1.** References are HRC p90 values per ecoregion — the new column is a per-tile diagnostic, not a reference quantity. No new reference scripts needed.
- **Tapajós regional mean is 3.16 W/m² over the 90 soft gate** (93.16 W/m²). The handoff explicitly says soft gates flag-not-halt. Don't treat this as a failure, but worth a look at the upper tail (max 127.50 W/m²) at some point.
- **K67 HRC diff lands around ±2.0.** Documented as "calibration, not gate." Actual run came in at −2.028, just outside the ±2.0 nominal band — `validate_satellite_vs_tower.py` correctly treats this as informational because K67 is calibration-mode, not pass-fail. This is consistent with the MOD11A1 cold-bias range in dense humid tropical evergreen forest.
- `src/App.jsx` had paginated fetch + map/satellite toggle + finer color ramps + H3 `highPrecision: true` added in the previous session — already deployed. No work owed there.
