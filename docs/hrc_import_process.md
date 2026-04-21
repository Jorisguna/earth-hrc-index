# HRC Data Import Process
## How to update HRC scores for a new region or recompute cycle

---

## What this does

Takes two CSV files exported from Google Earth Engine (GEE) and loads them into Supabase:
- A **tiles CSV** — one row per ERA5 grid cell with HRC scores
- A **reference CSV** — one row per ecoregion with the intact site benchmark (p90 HRC of protected areas)

The Python script merges them, computes restoration gaps, and inserts everything into the `hrc_tiles` table.

---

## Files involved

| File | Purpose |
|------|---------|
| `scripts/merge_and_import_v2_0.py` | The import script — run this |
| `scripts/25_hrc_tiles_wales_v2_0.js` | GEE: tile scores for Wales |
| `scripts/26_hrc_tiles_la_v2_0.js` | GEE: tile scores for LA |
| `scripts/27_hrc_tiles_sfbay_v2_0.js` | GEE: tile scores for SF Bay |
| `scripts/28_hrc_reference_wales_v2_0.js` | GEE: intact reference for Wales |
| `scripts/29_hrc_reference_la_v2_0.js` | GEE: intact reference for LA (IUCN I–VI) |
| `scripts/30_hrc_reference_sfbay_v2_0.js` | GEE: intact reference for SF Bay (IUCN I–VI) |

---

## Step-by-step

### Step 1 — Run GEE scripts

1. Open [Google Earth Engine](https://code.earthengine.google.com)
2. Open each of the 6 scripts above
3. Click **Run** in the editor
4. Go to the **Tasks panel** (top right) and click **RUN** next to each queued export
5. Wait 5–15 minutes per script

You need to run both the tiles script AND the reference script for each region.

### Step 2 — Download CSVs from Google Drive

All exports go to the `EarthHRC` folder in your Google Drive.

Download all 6 CSV files into one folder on your computer, e.g.:
```
~/hrc_imports/
```

### Step 3 — Rename the files

Google Drive adds extra text to filenames. Rename each file to match exactly:

| Rename to |
|-----------|
| `tiles_wales_v2_0.csv` |
| `tiles_la_v2_0.csv` |
| `tiles_sfbay_v2_0.csv` |
| `hrc_reference_wales_v2_0.csv` |
| `hrc_reference_la_v2_0.csv` |
| `hrc_reference_sfbay_v2_0.csv` |

In Terminal you can rename with:
```bash
mv "old name.csv" "new_name.csv"
```

### Step 4 — Delete old tiles from Supabase

In **Supabase → SQL Editor**, run one delete per region you are reimporting:

**Wales:**
```sql
DELETE FROM hrc_tiles
WHERE longitude BETWEEN -5.35 AND -2.65
  AND latitude BETWEEN 51.35 AND 53.45;
```

**Los Angeles:**
```sql
DELETE FROM hrc_tiles
WHERE longitude BETWEEN -119.0 AND -117.4
  AND latitude BETWEEN 33.6 AND 34.4;
```

**SF Bay:**
```sql
DELETE FROM hrc_tiles
WHERE longitude BETWEEN -123.0 AND -121.2
  AND latitude BETWEEN 37.0 AND 38.6;
```

### Step 5 — Run the import script

Open Terminal, navigate to the project, and run:

```bash
cd ~/earth-hrc-index
python3 scripts/merge_and_import_v2_0.py ~/hrc_imports/
```

The script auto-pairs files by region name — all three regions process in one command.

### Step 6 — Verify in Supabase

Run this query to check the results:

```sql
SELECT ecoregion_name,
       COUNT(*) as tiles,
       ROUND(AVG(hrc_score)::numeric, 2) as avg_hrc,
       MAX(hrc_reference) as hrc_reference
FROM hrc_tiles
WHERE methodology_version = 'v2.0'
GROUP BY ecoregion_name
ORDER BY ecoregion_name;
```

**Expected values (v2.0, Jan 2025–Jan 2026):**

| Ecoregion | avg_hrc | hrc_reference |
|-----------|---------|---------------|
| Celtic broadleaf forests | ~8.82 | ~9.95 |
| English Lowlands beech forests | ~8.33 | ~8.70 |
| California coastal sage and chaparral | ~2.90 | ~3.10 |
| California montane chaparral and woodlands | ~2.75 | ~3.07 |
| Mojave desert | ~2.91 | null (no PAs) |

If Wales mean HRC is below 5.0, or LA is above 6.0, something is wrong with the GEE formula — do not import.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `No tiles_*_v2_0.csv files found` | Files are named wrong — rename them (Step 3) |
| `row-level security policy` error | Script is using anon key — check `.env` has `SUPABASE_SERVICE_KEY` set |
| `Could not find column` error | Column doesn't exist in DB — run the relevant migration in `scripts/migrations/` |
| All tiles show `0 no reference` | Reference CSV had too few PA centroids — check `pa_centroid_count` column in reference CSV, may need to expand IUCN filter to I–VI |
| `>50% unmatched` warning | Old tiles weren't deleted first — run the DELETE queries (Step 4) then re-run |

---

## Notes

- The `.env` file must contain `SUPABASE_SERVICE_KEY` (not the anon key) for inserts to work
- Wales and SF Bay IUCN filter: I–VI (sparse PA coverage in these regions)
- LA IUCN filter: I–VI (same reason)
- Mojave will always have null reference — no protected areas
- This process runs once per recompute cycle (currently annual)
