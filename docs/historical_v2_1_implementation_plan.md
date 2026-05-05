# Historical Baseline v2.1 — Implementation Plan

**Status:** Ready to implement
**Source methodology:** `HRC_historical_baseline_methodology_v2_1.md` (post-review revision, May 2026)
**Pilot regions:** Wales, San Francisco Bay, Los Angeles
**Target deploy:** v2.1 release

---

## 1. What changes vs current state

| Aspect | Current state | v2.1 target |
|--------|---------------|-------------|
| Dataset | `ERA5_LAND/DAILY_AGGR` (deprecated v2.0 prototype) | `ERA5_LAND/MONTHLY_AGGR` |
| Formula | Mean of spring monthly ratios | Ratio of annual sums per year, mean across 10 years |
| Window | March–May only | Full annual cycle |
| Region coverage | Wales + SF Bay (LA never had it) | Wales + SF Bay + **LA (new)** |
| Signed change column | No | Yes (`historical_change`) |
| Confidence flag | No | Yes (`historical_confidence`) |
| Method version stamp | No | Yes (`historical_method_version`) |
| Production data state | All historical fields NULL (lost on v2.0 INSERT) | Fully populated for all three regions |

**Sign convention (per revised methodology §2.4):**
- `historical_change = hrc_score - hrc_historical_reference` → positive means **recovery**, negative means **degradation**
- `restoration_gap_historical = GREATEST(hrc_historical_reference - hrc_score, 0)` → unsigned magnitude of degradation only

This convention matches the live `BioregionCard.jsx` absolute view, which already computes `(hrc - tile.hrc_historical_reference)` inline. After v2.1, the front-end can read the column directly with no sign-flip rework.

---

## 2. Adaptations from the methodology document

The revised methodology is closely aligned with our codebase. Two minor adaptations remain:

### 2.1 Verification query — no `region` column

§3.6 of the methodology uses `WHERE region IN ('wales', 'sfbay', 'la')` but our `hrc_tiles` table has no `region` column. Use a `CASE` over lat/lon ranges instead (matches what we used for trend and ceiling verification).

### 2.2 SF Bay bounding box — use wider v2.0 box

The methodology proposes `[-122.7, 37.2, -121.6, 38.3]` for SF Bay. The v2.0 tile import uses `[-123.0, 37.0, -121.2, 38.6]` (wider on all sides). Using the narrower box risks missing boundary tiles that exist in `hrc_tiles`. Use the wider v2.0 box for full coverage.

| Region | Bounding box (use these) |
|--------|--------------------------|
| Wales | `[-5.35, 51.35, -2.65, 53.45]` |
| SF Bay | `[-123.0, 37.0, -121.2, 38.6]` (matches v2.0 tile import) |
| LA | `[-119.0, 33.6, -117.4, 34.4]` |

---

## 3. Implementation phases

### Phase 1 — Schema migration with pre-flight check (~30 min)

#### 1.1 Pre-flight column type diagnostic

Run this **first** in Supabase SQL Editor:

```sql
SELECT column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_name = 'hrc_tiles'
  AND column_name IN (
    'hrc_historical_reference',
    'restoration_gap_historical',
    'historical_change',
    'historical_confidence',
    'historical_method_version',
    'historical_window'
  )
ORDER BY column_name;
```

**Expected outcome:** `hrc_historical_reference` and `restoration_gap_historical` exist as `numeric`. The other four columns don't exist yet. If any column shows an unexpected type, fix with explicit `ALTER COLUMN ... TYPE` before running the migration.

#### 1.2 Migration

Save as `scripts/migrations/004_v2_1_historical.sql`:

```sql
-- Migration: v2.1 historical baseline columns
ALTER TABLE hrc_tiles
  ADD COLUMN IF NOT EXISTS hrc_historical_reference   NUMERIC,
  ADD COLUMN IF NOT EXISTS historical_change          NUMERIC,
  ADD COLUMN IF NOT EXISTS restoration_gap_historical NUMERIC,
  ADD COLUMN IF NOT EXISTS historical_confidence      TEXT,
  ADD COLUMN IF NOT EXISTS historical_method_version  TEXT DEFAULT 'v2.1',
  ADD COLUMN IF NOT EXISTS historical_window          TEXT DEFAULT '2001-01-01/2011-01-01';

-- Drop any v2.0-era data so it does not contaminate v2.1 verification
UPDATE hrc_tiles
SET hrc_historical_reference   = NULL,
    historical_change          = NULL,
    restoration_gap_historical = NULL,
    historical_confidence      = NULL
WHERE historical_method_version IS NULL OR historical_method_version != 'v2.1';
```

(Effectively a no-op on the data given current state — all historical fields are already NULL — but keeps the migration idempotent.)

### Phase 2 — Update v2.0 import script to preserve historical columns (~20 min)

**Critical to prevent regression.** The next time someone re-imports v2.0 tiles via `merge_and_import_v2_0.py`, all historical work will be wiped again unless the script preserves these columns.

Modify `scripts/merge_and_import_v2_0.py`:

```python
# Add to insert_data dict in process_region()
'hrc_historical_reference':   None,  # preserved by separate v2.1 import
'historical_change':          None,
'restoration_gap_historical': None,
'historical_confidence':      None,
'historical_method_version':  None,
'historical_window':          None,
```

This ensures future v2.0 recomputes don't error on missing columns. The actual values are populated by the separate v2.1 import pipeline.

### Phase 3 — GEE script updates (~2 hours)

**File modifications:**

| File | Action |
|------|--------|
| `scripts/10_hrc_historical_wales.js` | Replace with v2.1 methodology (header note: supersedes v2.0 prototype) |
| `scripts/12_hrc_historical_sfbay.js` | Replace with v2.1 methodology |
| `scripts/13_hrc_historical_la.js` | **Create new** |

**v2.1 script template** (use the canonical pattern from methodology doc §3.2 with `projection: 'EPSG:4326'` and `tileScale: 4`):

```javascript
// =====================================================================
// Heat Regulation Capacity Historical Baseline — v2.1
// Methodology aligned with v2.0 current HRC score
// Dataset: ECMWF ERA5_LAND/MONTHLY_AGGR
// Formula: ratio-of-annual-sums per year, mean across 2001-2010
// =====================================================================

var region     = ee.Geometry.Rectangle([-5.35, 51.35, -2.65, 53.45]);
var regionName = 'wales';
var years      = ee.List.sequence(2001, 2010);

Map.centerObject(region, 8);

var computeAnnualHRC = function(year) {
  year = ee.Number(year);
  var startDate = ee.Date.fromYMD(year, 1, 1);
  var endDate   = ee.Date.fromYMD(year.add(1), 1, 1);

  var era5 = ee.ImageCollection('ECMWF/ERA5_LAND/MONTHLY_AGGR')
    .filterDate(startDate, endDate)
    .filterBounds(region);

  var latentHeat = era5.select('surface_latent_heat_flux_sum')
                       .map(function(img) { return img.abs(); })
                       .sum().clip(region);

  var solarRad   = era5.select('surface_net_solar_radiation_sum').sum().clip(region);
  var thermalRad = era5.select('surface_net_thermal_radiation_sum').sum().clip(region);

  // CRITICAL: thermal radiation is NEGATIVE — never .abs() it
  var netRad     = solarRad.add(thermalRad);
  var netRadSafe = netRad.where(netRad.lte(0), 0.001);

  return latentHeat.divide(netRadSafe).min(1).max(0)
                   .multiply(10).rename('HRC_annual')
                   .set('year', year)
                   .clip(region);
};

var annualHRCs        = ee.ImageCollection.fromImages(years.map(computeAnnualHRC));
var historicalBaseline = annualHRCs.mean()
  .rename('hrc_historical_reference').toFloat().clip(region);

print('Historical baseline range:',
  historicalBaseline.reduceRegion({
    reducer: ee.Reducer.minMax().combine(ee.Reducer.mean(), '', true),
    geometry: region, scale: 11132, maxPixels: 1e8
  })
);

// Native ERA5-Land grid sampling, lat/lon emitted for 5dp matching with hrc_tiles
var historicalFC = historicalBaseline.sample({
  region:     region,
  scale:      11132,
  projection: 'EPSG:4326',
  geometries: true,
  tileScale:  4
}).map(function(f) {
  var coords = f.geometry().coordinates();
  return f.set({
    longitude: ee.Number(coords.get(0)),
    latitude:  ee.Number(coords.get(1))
  });
});

print('Sample point count:', historicalFC.size());

Map.addLayer(historicalBaseline,
  { min: 0, max: 10, palette: ['8B2500','D4550A','F4A623','C8D84A','1D9E75'] },
  'HRC historical 2001–2010 (' + regionName + ')'
);

Export.table.toDrive({
  collection:     historicalFC,
  description:    'hrc_historical_v2_1_' + regionName,
  folder:         'EarthHRC',
  fileNamePrefix: 'hrc_historical_v2_1_' + regionName,
  fileFormat:     'CSV',
  selectors:      ['longitude', 'latitude', 'hrc_historical_reference']
});

print('Export task queued. Go to Tasks panel and click RUN.');
```

For SF Bay: change `region` to `[-123.0, 37.0, -121.2, 38.6]` and `regionName` to `'sfbay'`.
For LA: change `region` to `[-119.0, 33.6, -117.4, 34.4]` and `regionName` to `'la'`.

### Phase 4 — Run GEE & download CSVs (~45 min)

For each of the three scripts:
1. Open in Google Earth Engine
2. Click **Run**
3. Click **RUN** in Tasks panel
4. Wait ~10 min per export
5. Download CSV from Drive `EarthHRC` folder

Outputs:
- `hrc_historical_v2_1_wales.csv` (~320 rows)
- `hrc_historical_v2_1_sfbay.csv` (~221 rows)
- `hrc_historical_v2_1_la.csv` (~98 rows expected based on existing tile counts)

### Phase 5 — Generate import SQL (~20 min)

**Create** `scripts/update_historical_v2_1.py`:

```python
#!/usr/bin/env python3
"""
update_historical_v2_1.py
Generate UPDATE SQL from a v2.1 historical baseline CSV.

Usage:
  python3 scripts/update_historical_v2_1.py path/to/hrc_historical_v2_1_wales.csv
"""
import csv, sys
from pathlib import Path

def csv_to_sql(csv_path):
    csv_path = Path(csv_path)
    region = csv_path.stem.replace('hrc_historical_v2_1_', '')
    output = Path(__file__).parent / f'{region}_historical_update_v2_1.sql'

    rows = []
    with open(csv_path, newline='', encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            try:
                lon = float(row['longitude'])
                lat = float(row['latitude'])
                val = row['hrc_historical_reference'].strip()
                if val in ('', 'null', 'None'):
                    continue
                rows.append((lon, lat, float(val)))
            except (KeyError, ValueError):
                continue

    confidence_map = {'wales': 'medium', 'sfbay': 'medium', 'la': 'medium-low'}
    confidence = confidence_map.get(region, 'medium')

    lines = [
        f'-- {region}_historical_update_v2_1.sql',
        f'-- Generated from {csv_path.name}',
        f'-- Methodology: v2.1 (annual ratio-of-sums, 2001–2010, full annual cycle)',
        f'-- Match convention: longitude + latitude rounded to 5 decimal places',
        f'-- {len(rows)} rows',
        '',
        'BEGIN;',
        '',
    ]

    for lon, lat, val in rows:
        lines.append(
            f'UPDATE hrc_tiles SET hrc_historical_reference = {val}, '
            f"historical_method_version = 'v2.1', "
            f"historical_window = '2001-01-01/2011-01-01', "
            f"historical_confidence = '{confidence}' "
            f'WHERE ROUND(longitude::numeric, 5) = ROUND({lon}::numeric, 5) '
            f'AND ROUND(latitude::numeric, 5) = ROUND({lat}::numeric, 5);'
        )

    lines += ['', 'COMMIT;']
    output.write_text('\n'.join(lines))
    print(f'Wrote {output} ({len(rows)} UPDATE statements)')

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 scripts/update_historical_v2_1.py <csv>')
        sys.exit(1)
    csv_to_sql(sys.argv[1])
```

Run for each CSV:
```bash
python3 scripts/update_historical_v2_1.py ~/Downloads/hrc_historical_v2_1_wales.csv
python3 scripts/update_historical_v2_1.py ~/Downloads/hrc_historical_v2_1_sfbay.csv
python3 scripts/update_historical_v2_1.py ~/Downloads/hrc_historical_v2_1_la.csv
```

### Phase 6 — Run SQL imports in Supabase (~15 min)

In **Supabase SQL Editor**, run in order:

1. `wales_historical_update_v2_1.sql`
2. `sfbay_historical_update_v2_1.sql`
3. `la_historical_update_v2_1.sql`
4. **Compute derived columns** — create `scripts/compute_historical_change_v2_1.sql`:

```sql
-- Derives historical_change (signed, "new minus old": positive = recovery)
-- and restoration_gap_historical (unsigned magnitude of degradation only).
-- These two quantities use DIFFERENT sign conventions on purpose — see methodology §2.4.

UPDATE hrc_tiles
SET historical_change          = hrc_score - hrc_historical_reference,
    restoration_gap_historical = GREATEST(hrc_historical_reference - hrc_score, 0)
WHERE hrc_historical_reference IS NOT NULL
  AND hrc_score IS NOT NULL;
```

### Phase 7 — Verification (~20 min)

#### 7.1 Coverage and direction-of-change query

```sql
SELECT
  CASE
    WHEN longitude BETWEEN -5.35 AND -2.65 AND latitude BETWEEN 51.35 AND 53.45 THEN 'Wales'
    WHEN longitude BETWEEN -119.0 AND -117.4 AND latitude BETWEEN 33.6 AND 34.4 THEN 'LA'
    WHEN longitude BETWEEN -123.0 AND -121.2 AND latitude BETWEEN 37.0 AND 38.6 THEN 'SF Bay'
  END AS region,
  COUNT(*)                                                  AS n_tiles,
  COUNT(hrc_historical_reference)                           AS n_with_baseline,
  ROUND(AVG(hrc_historical_reference)::numeric, 2)          AS mean_baseline,
  ROUND(AVG(hrc_score)::numeric, 2)                         AS mean_current,
  ROUND(AVG(historical_change)::numeric, 2)                 AS mean_change,
  ROUND(AVG(restoration_gap_historical)::numeric, 2)        AS mean_gap,
  COUNT(*) FILTER (WHERE historical_change > 0)             AS n_improved,
  COUNT(*) FILTER (WHERE historical_change < 0)             AS n_degraded,
  COUNT(*) FILTER (WHERE historical_change = 0)             AS n_stable
FROM hrc_tiles
WHERE methodology_version = 'v2.0'
GROUP BY region
ORDER BY region;
```

**Acceptance gates:**

- [ ] All three regions show `n_with_baseline = n_tiles` (full coverage)
- [ ] Wales mean baseline 7.0–7.8
- [ ] SF Bay mean baseline 4.5–5.5
- [ ] LA mean baseline 2.8–3.5
- [ ] Each region has some tiles with `historical_change > 0` (recovery exists somewhere — under new sign convention)
- [ ] Mojave Desert subset of LA (longitude > −117.8 roughly) has `restoration_gap_historical` close to 0 (stable deserts sanity check)

#### 7.2 Sign-convention crosscheck (methodology §3.6 sanity check 4)

Catches schema regressions that flip the convention:

```sql
SELECT
  longitude, latitude,
  hrc_score, hrc_historical_reference,
  historical_change,
  hrc_score - hrc_historical_reference                      AS computed_change,
  restoration_gap_historical,
  GREATEST(hrc_historical_reference - hrc_score, 0)         AS computed_gap,
  CASE
    WHEN ABS(historical_change - (hrc_score - hrc_historical_reference)) > 0.001 THEN 'CHANGE SIGN MISMATCH'
    WHEN ABS(restoration_gap_historical - GREATEST(hrc_historical_reference - hrc_score, 0)) > 0.001 THEN 'GAP MISMATCH'
    ELSE 'OK'
  END AS audit
FROM hrc_tiles
WHERE hrc_historical_reference IS NOT NULL
ORDER BY RANDOM()
LIMIT 20;
```

All 20 rows should show `audit = 'OK'`. Any other value blocks deploy.

### Phase 8 — App UI updates (~1.5 hours)

**Significantly less rework than originally scoped.** The v2.1 sign convention now matches the live app's existing inline computation, so:

- **Absolute view** ([src/components/BioregionCard.jsx:227-249](src/components/BioregionCard.jsx#L227-L249)): currently computes `(hrc - tile.hrc_historical_reference)` inline, with green/orange colour. Just swap the inline computation for `tile.historical_change` and the rendering stays identical.

- **Relative view** (gap mode handler, [src/components/BioregionCard.jsx:48-57](src/components/BioregionCard.jsx#L48-L57)): the existing `gapNote` says "this location has lost this many HRC points". Update to handle the recovery case using `tile.historical_change > 0.2`.

- **Explainer text** ([src/lib/explainers.js](src/lib/explainers.js), `historicalBaseline` body): replace with the v2.1 copy from methodology doc §4.3. Key change: full annual cycle (not spring), 10 annual values (not 30 monthly), all three regions covered (not Wales+SFBay only).

#### 8.1 BioregionCard absolute view — swap inline math for column

```jsx
{tile.hrc_historical_reference != null && (
  <div className="card-section">
    <div className="card-row">
      <span className="card-key">
        Historical baseline (2001–2010)
        <InfoBtn onClick={() => onInfo('historicalBaseline')} />
      </span>
      <span className="card-val">{fmt(tile.hrc_historical_reference)} / 10</span>
    </div>
    <div className="card-row">
      <span className="card-key">
        Change since 2001–10
        <InfoBtn onClick={() => onInfo('historicalBaseline')} />
      </span>
      <span className="card-val" style={{
        color: tile.historical_change >= 0 ? '#1D9E75' : '#E67E22'
      }}>
        {tile.historical_change >= 0 ? '+' : ''}{fmt(tile.historical_change)}
      </span>
    </div>
  </div>
)}
```

#### 8.2 BioregionCard relative view — handle recovery in gapNote

```jsx
// intact (default)
const gap = tile.restoration_gap
return {
  gap,
  reference: gap != null && hrc != null ? hrc + gap : null,
  refLabel:  'Ecoregion reference',
  gapNote:   'This location could recover this many HRC points if restored to the reference condition for its ecoregion.',
  explainerKey: 'restorationGap',
}

// historical (already exists)
if (gapMode === 'historical') {
  const isRecovered = tile.historical_change != null && tile.historical_change > 0.2
  return {
    gap:          tile.restoration_gap_historical,
    reference:    tile.hrc_historical_reference,
    refLabel:     '2001–2010 baseline',
    gapNote:      isRecovered
      ? `This location has improved by ${fmt(tile.historical_change)} HRC points since its 2001–2010 baseline — its restoration gap is zero.`
      : 'This location has lost this many HRC points since its 2001–2010 mean.',
    explainerKey: 'historicalBaseline',
  }
}
```

#### 8.3 Explainer text update

Replace `explainers.historicalBaseline.body` in [src/lib/explainers.js](src/lib/explainers.js) with the v2.1 copy from methodology §4.3.

### Phase 9 — Documentation & deploy (~1 hour)

1. Add cross-reference link from `docs/v2_0_reference_methodology.md` to the new historical methodology
2. Move/rename methodology source file into `docs/historical_v2_1_methodology.md`
3. Commit + push to deploy via Vercel
4. Smoke-test on production: open Wales tile, verify "Change since 2001–10" populates; switch to gap view → Historical, verify hex layer renders

---

## 4. Effort estimate

| Phase | Effort |
|-------|--------|
| 1 — Schema migration + pre-flight | 0.5 hr |
| 2 — Update merge_and_import_v2_0.py to preserve cols | 0.3 hr |
| 3 — GEE scripts | 2 hr |
| 4 — Run GEE + download | 0.75 hr (mostly waiting) |
| 5 — Generate SQL | 0.3 hr |
| 6 — Run SQL imports | 0.25 hr |
| 7 — Verification (incl. sign-convention crosscheck) | 0.3 hr |
| 8 — App UI (much smaller — sign convention already aligned) | 1.5 hr |
| 9 — Docs & deploy | 1 hr |
| **Total** | **~7 hours** |

One focused day; could split as Phases 1–7 (data) + 8–9 (UI/deploy) across two sessions.

---

## 5. Decisions to make before starting

1. **Should we surface `historical_confidence` in the UI?** Methodology proposes `medium` for Wales/SFBay, `medium-low` for LA. Recommendation: **defer to v2.2** — minor UX addition, not blocking.

2. **Drop the deprecated v2.0 historical SQL files?** `wales_historical_update.sql`, `sfbay_historical_update.sql` are now superseded. Recommendation: **rename with `_DEPRECATED_v2_0` suffix**, don't delete (preserves audit trail).

3. **LA confidence flag — `medium-low` vs `medium`?** Doc justifies `medium-low` with "Mojave subset has fewer ground stations." Recommendation: **start with `medium-low`**, revisit if Mojave tiles look unexpectedly noisy.

4. **Sliding vs fixed reference window?** Doc §6.3 raises this for v2.2. Fixed 2001–2010 is correct for now.

---

## 6. Risks

| Risk | Mitigation |
|------|-----------|
| Coordinate mismatch between v2.1 historical export and v2.0 tile coordinates | Both sample at ERA5 native scale 11132 with `EPSG:4326` projection — should match. Verify with COUNT(*) after import. |
| GEE export hits row limit | Largest region is Wales (~320 rows). Far below any GEE limit. |
| LA mean baseline outside expected 2.8–3.5 range | Re-check formula and bounding box; compare against published Mojave/coastal sage ET literature. |
| Sign-convention regression on future schema work | Sanity check 4 (Phase 7.2) catches this. Methodology §6.1 process note codifies the audit for future reference columns. |
| v2.0 import script wipes historical on next recompute | **Phase 2 fix** — added preserve-NULL stubs to `insert_data` dict in `merge_and_import_v2_0.py`. |
| Gap view shows a tile that improved as if it were degraded | **Phase 8.2 fix** — `gapNote` checks `historical_change > 0.2` and renders a recovery message. |

---

## 7. Out of scope (deferred to v2.2+)

Per methodology §6:
- Per-tile annual time series storage (rolling baseline windows)
- Tier B (Sentinel-2 / Landsat) historical cross-validation for 2014+
- Optional secondary "spring-only" view for restoration practitioners
- Ecoregion-relative historical reference
- `historical_confidence` UI surfacing

---

## 8. Decision log (fill as work progresses)

| Date | Decision | Rationale | Made by |
|------|----------|-----------|---------|
| | Pre-flight type diagnostic ran clean / required fixes | | |
| | merge_and_import_v2_0.py updated to preserve historical columns | | |
| | LA confidence flag: `medium-low` confirmed / changed to | | |
| | Sign-convention crosscheck (Phase 7.2) all OK | | |
| | Production smoke-test complete | | |
