# HRC Formula Bug — Handoff Document

## Summary

There is a formula error in all recent GEE scripts that causes HRC scores to be
systematically ~50% too low. The original Wales tiles in the database were computed
correctly. All scripts written after the original Wales upload (05, 08, 09, 10)
have the bug.

---

## The Bug

### Correct formula (used for original Wales DB tiles)
```javascript
var latentHeat = era5.select('surface_latent_heat_flux_sum').abs();
var netRad     = era5.select('surface_net_solar_radiation_sum')
                  .add(era5.select('surface_net_thermal_radiation_sum'));
// surface_net_thermal_radiation_sum is negative (net outgoing longwave).
// Adding it — not abs-ing it — gives TRUE net radiation (Rn).
var netRadSafe = netRad.where(netRad.lte(0), 0.001);
var ef         = latentHeat.divide(netRadSafe).min(1).max(0);
var hrc        = ef.multiply(10);
```

### Wrong formula (all scripts 05, 08, 09, 10)
```javascript
var latentHeat = era5.select('surface_latent_heat_flux_sum').abs();
var solarRad   = era5.select('surface_net_solar_radiation_sum').abs();
var thermalRad = era5.select('surface_net_thermal_radiation_sum').abs();  // ← BUG: abs() on negative value
var netRad     = solarRad.add(thermalRad);  // ← inflated denominator
var netRadSafe = netRad.where(netRad.lte(0), 0.001);
var ef         = latentHeat.divide(netRadSafe).min(1).max(0);
var hrc        = ef.multiply(10);
```

### Why it matters
ERA5 `surface_net_thermal_radiation_sum` is typically **negative** (~−80 MJ/m²/month
in Wales spring), representing net outgoing longwave radiation.

- **Correct:** netRad = 300 + (−80) = **220** → EF = 150/220 = **0.68** → HRC = **6.8**
- **Wrong:**   netRad = 300 + 80   = **380** → EF = 150/380 = **0.39** → HRC = **3.9**

Taking abs() of the thermal term nearly doubles the denominator, halving EF.

---

## Evidence

| Source | Formula | Wales spring HRC |
|--------|---------|-----------------|
| DB Wales tiles (original upload) | Correct (true Rn) | ~6–7 |
| 05_hrc_trend_wales_v2.js output CSV | Wrong | mean = 3.37, max = 4.09 |
| 10_hrc_historical_wales.js (Mar–May 2001–2010) | Wrong | mean = 3.11, max = 3.67 |
| 08_hrc_tiles_assam.js → DB | Wrong | ~3–4 |
| 09_hrc_tiles_sfbay.js → DB | Wrong | ~3–4 |

The original Wales scripts (01–04) are not in the repo. They used the correct formula.

---

## Current State of the Database

| Region | DB hrc_score | Formula used | Correct? |
|--------|-------------|--------------|----------|
| Wales  | ~6–7        | Correct (true Rn) | ✓ Yes |
| LA / Barbados | ~6–8 | Unknown — likely correct original scripts | Probably ✓ |
| Assam  | ~3–4        | Wrong (abs thermal) | ✗ No |
| SF Bay | ~3–4        | Wrong (abs thermal) | ✗ No |

Assam and SF Bay HRC scores are **not comparable** to Wales. The restoration_gap
values computed for Assam and SF Bay are also wrong as a result.

---

## What Needs to Be Done

### 1. Fix the GEE scripts (08, 09, 05, 10)
Replace the three-line wrong formula with the two-line correct formula in:
- `scripts/08_hrc_tiles_assam.js`
- `scripts/09_hrc_tiles_sfbay.js`
- `scripts/05_hrc_trend_wales_v2.js`
- `scripts/10_hrc_historical_wales.js`

### 2. Recompute and re-import Assam and SF Bay
Run corrected 08 and 09 in GEE, export CSVs, regenerate SQL via
`scripts/insert_new_tiles.py`, and reload into Supabase using
`ON CONFLICT DO NOTHING` after deleting the wrong rows.

### 3. Recompute trend scores for Wales
Run corrected `05_hrc_trend_wales_v2.js`, re-import `trend_score` and
`trend_score_60m` for Wales tiles via SQL UPDATE.

### 4. Complete the historical baseline (Script A)
Once `10_hrc_historical_wales.js` is fixed, run it in GEE and confirm
historical spring HRC lands in ~5–8 range for Wales. Then repeat for all
other regions.

### 5. Repeat for other regions (LA, Barbados)
Verify these were loaded from the original correct-formula scripts. If their
hrc_score values are ~6–8, they are fine. If ~3–4, they also need recomputing.

---

## Key Files

| File | Purpose |
|------|---------|
| `scripts/08_hrc_tiles_assam.js` | GEE — Assam tiles (has formula bug) |
| `scripts/09_hrc_tiles_sfbay.js` | GEE — SF Bay tiles (has formula bug) |
| `scripts/05_hrc_trend_wales_v2.js` | GEE — Wales trend recomputation (has formula bug) |
| `scripts/10_hrc_historical_wales.js` | GEE — Historical baseline Wales (has formula bug, partial fix applied to thermal line) |
| `scripts/insert_new_tiles.py` | Python — converts GEE CSV → SQL INSERT |
| `scripts/HRC_Wales_Trend_60months.csv` | Wales hrc_score/trend export — computed with wrong formula, NOT yet imported |
| `src/App.jsx` | React app — viewport-based Supabase fetch, H3 hex layer |

---

## The One-Line Fix

In every GEE script, replace:
```javascript
var solarRad   = era5.select('surface_net_solar_radiation_sum').abs();
var thermalRad = era5.select('surface_net_thermal_radiation_sum').abs();
var netRad     = solarRad.add(thermalRad);
```

With:
```javascript
var netRad = era5.select('surface_net_solar_radiation_sum')
              .add(era5.select('surface_net_thermal_radiation_sum'));
```

Keep the `netRadSafe` safety clip and everything else unchanged.

---

## Project Context

- **HRC score** = evaporative fraction × 10. Range 0–10. Higher = healthier.
- **Dataset**: `ECMWF/ERA5_LAND/DAILY_AGGR` (Tier C, ~9km, reanalysis)
- **Period**: June 2018 – May 2023 (60 months). Current HRC = mean of last 3 months.
- **Stack**: GEE (computation) → Python (CSV→SQL) → Supabase (DB) → React/Deck.gl (app)
- **Repo**: `/Users/jorisgunawardena/earth-hrc-index`
- **Pilot regions**: Wales, Los Angeles, Barbados, Assam, SF Bay
