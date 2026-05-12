# Patches — v2.1.2 absolute latent heat flux

This file describes the additions needed in two files. The Python
import script and the React bioregion card.

---

## 1. Python import script (`scripts/merge_and_import_v2_1_higher_fidelity.py`)

### What changes

One new column name, `latent_heat_flux_annual_wm2`, threaded into three
places in the import script:

- The new field is read from the GEE-exported CSV row
- It's passed through into the Supabase `insert_data` dict
- The methodology version is bumped from `v2.1.1` → `v2.1.2`
- The auto-pair glob pattern is bumped from `*_tiles_v2_1_1.csv` → `*_tiles_v2_1_2.csv`

The conditional read protects older CSV files (those exported before
v2.1.2) from crashing the import. Older files would write NULL into the
new column, which is the desired behaviour per the handoff: pre-v2.1.2
tiles stay NULL.

Implementation in this codebase — see the commit alongside this doc.

---

## 2. `src/components/BioregionCard.jsx`

### What the user sees

A new row in the card, between Restoration Gap and Ecoregion:

```
Cooling work        36 W/m²    ⓘ
```

### Implementation pattern

Match existing `card-section` / `card-row` styling. Show em-dash for
NULL values (pre-v2.1.2 tiles), value rounded to integer for v2.1.2
tiles.

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

### Tooltip copy (confirmed with user, May 2026)

> "The absolute rate at which this tile moves energy upward through
> evaporation, averaged across the year. Higher values mean more total
> cooling work delivered. The HRC score above measures *efficiency*
> (the fraction of received energy used for cooling); this number
> measures *magnitude* (the total cooling work). Forests typically
> deliver more cooling work in absolute terms even when their
> efficiency ratio looks similar to or below intensively managed
> cropland, because forests absorb more sunlight to begin with."

This goes into `src/lib/explainers.js` under the key `coolingWork`.

### Display formatting decisions

- **Unit**: watts per square metre, displayed as `W/m²`. Standard for
  climate science. Confirmed acceptable with user.
- **Precision**: round to nearest integer. The Penman-Monteith-Leuning
  underestimate alone is roughly ±15 W/m² at temperate broadleaf sites;
  decimal precision implies false confidence.
- **NULL handling**: row hidden entirely (pre-v2.1.2 tiles have no
  value to show, and a row with em-dash adds visual noise).
- **Colour ramp**: deferred to v1.1. Value rendered as plain text for
  v1.0 to avoid overloading the bioregion card visually.

---

## Order of operations

1. Apply `scripts/migrations/006_absolute_latent_heat_flux.sql` to Supabase.
2. Run the verification queries at the bottom of that file.
3. Apply the Python import-script patch.
4. Push the two updated Earth Engine scripts
   (`31_hrc_v2_1_idf_tiles_v2_1_2.js` and
   `32_hrc_v2_1_tapajos_tiles_v2_1_2.js`) and run the export tasks.
5. Check the Earth Engine console output against the in-script
   acceptance gate prints. The two `print(...)` calls report the
   FR-Fon or K67 pixel value and the regional mean. **Fail fast here
   if either tower pixel reads outside its gate range.**
6. Download the CSVs from Google Drive.
7. DELETE v2.1.1 tiles from `hrc_tiles` to make room.
8. Re-import via the patched Python script.
9. Run `validate_latent_heat_flux.py` against the database. Hard
   pass-fail at this step.
10. Also re-run `validate_satellite_vs_tower.py` (now filtered on
    v2.1.2) to confirm HRC values didn't regress.
11. Apply the `BioregionCard.jsx` patch and deploy.
