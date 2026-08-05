// =====================================================================
// feasibility.js — HRC 30 m US test sites, Phase 0 feasibility diagnostic
//
// Phase 0 of HRC_30m_test_sites_usa_implementation_plan_v1_0.md (Gate P0).
// Diagnostic only — does NOT touch production tiles or schema.
//
// PURPOSE: per-site go/no-go evidence before any 30 m pipeline is built.
// For each of the three sites it answers the four Gate-P0 questions:
//
//   1. Does OpenET have monthly coverage over the box for the target
//      year? (Trivial now that CONUS coverage is 48-state, but the
//      project plan requires we verify the specific months exist.)
//   2. Are there >=1-2 clear Landsat 8/9 scenes per month across the full
//      year over the box? (Winter/snow collapse is expected and measured,
//      not assumed — it informs the per-month quality mask in Phase 2.)
//   3. (Off-platform) Does AmeriFlux tower data exist for the same year?
//      — the tower coords are printed here so Phase 1's tower.py has a
//      single source of truth; the BASE download itself is manual.
//   4. Mead one-month sanity: monthly evaporative fraction over the
//      irrigated maize tower pixel (US-Ne1) is in the plausible mid-
//      season range and clearly ABOVE the rainfed pixel (US-Ne3).
//
// The evaporative fraction here is a DELIBERATELY ROUGH Phase-0 sanity
// number: OpenET monthly ET -> latent heat, over an ERA5-Land (~9 km)
// monthly net radiation, ground heat flux neglected. It is NOT the
// production quantity (that is Phase 2, D2, at 30 m with both
// denominators). Its only job is to confirm the irrigated > rainfed
// contrast and a believable magnitude before we spend pipeline effort.
//
// OUTPUT: console prints (per-site coverage tables + Mead sanity) and a
// small CSV of the per-site/per-month coverage counts for the record.
//   - hrc_30m_usa_feasibility_phase0.csv
// =====================================================================

// ── Time window ─────────────────────────────────────────────────────
// 2023 to match the v2.1.2 / v2.2 production radiation window and the
// OpenET asset the pipeline will use.
var YEAR = 2023;
// Inspect the FULL calendar year, not a growing-season window. OpenET is
// monthly year-round for all CONUS, so the numerator is never the limiter.
// The production HRC score (the 500 m reference the 30 m tile sits beside
// under decision D-A) is ANNUAL, so an annual composite is the faithful
// comparison. A fixed Apr–Oct window would also be actively WRONG for
// Tonzi/Vaira, whose Mediterranean grassland is green in winter/spring and
// senescent in summer. Winter is a DENOMINATOR problem (near-zero net
// radiation, snow), handled by explicit per-month quality masking in
// Phase 2 — not by blind-dropping whole months here. This diagnostic
// surveys all 12 months so the window is evidence-based: watch where
// Landsat clear scenes collapse (snow) and where monthly Rn approaches
// zero (EF undefined).
var ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// ── Data assets ─────────────────────────────────────────────────────
var OPENET_MONTHLY = 'OpenET/ENSEMBLE/CONUS/GRIDMET/MONTHLY/v2_0';
var OPENET_BAND    = 'et_ensemble_mad';   // ensemble ET, mm/month
var ERA5_MONTHLY   = 'ECMWF/ERA5_LAND/MONTHLY_AGGR';
var L8 = 'LANDSAT/LC08/C02/T1_L2';
var L9 = 'LANDSAT/LC09/C02/T1_L2';

// Clear-scene threshold for the Landsat count (scene-level CLOUD_COVER).
// Loose on purpose — Phase 0 asks "is there anything usable each month",
// not "is this the scene we composite". Phase 2 does per-pixel masking.
var CLOUD_COVER_MAX = 30;

// Physical constant for the sanity EF.
var LAMBDA = 2.45e6;   // J per kg, latent heat of vaporisation
                       // (1 mm ET = 1 kg/m2 of water => ET_mm * LAMBDA = J/m2)

// ── Sites ───────────────────────────────────────────────────────────
// One entry per site. `code` is the production region_code (decision
// D-C, site_state convention). Towers carry the AmeriFlux id, the
// land-cover regime, and coordinates (lon, lat) — the single source of
// truth reused by Phase 1 tower.py.
var SITES = [
  {
    code: 'mead_ne',
    label: 'Mead, Nebraska (intensive cropland)',
    confidence: 'High',
    bbox: ee.Geometry.Rectangle([-96.52, 41.14, -96.40, 41.20]),
    towers: [
      { id: 'US-Ne1', regime: 'irrigated_continuous_maize',   lon: -96.4766, lat: 41.1651 },
      { id: 'US-Ne2', regime: 'irrigated_maize_soy_rotation', lon: -96.4701, lat: 41.1649 },
      { id: 'US-Ne3', regime: 'rainfed_maize_soy_rotation',   lon: -96.4397, lat: 41.1797 }
    ]
  },
  {
    code: 'tonzi_vaira_ca',
    label: 'Tonzi / Vaira Ranch, California (oak savanna + grassland)',
    confidence: 'Medium',
    bbox: ee.Geometry.Rectangle([-121.00, 38.38, -120.92, 38.46]),
    towers: [
      { id: 'US-Ton', regime: 'blue_oak_savanna',   lon: -120.9660, lat: 38.4309 },
      { id: 'US-Var', regime: 'annual_c3_grassland', lon: -120.9508, lat: 38.4133 }
    ]
  },
  {
    code: 'metolius_or',
    label: 'Metolius, Oregon (semi-arid ponderosa pine — forest stress case)',
    confidence: 'Lower',
    bbox: ee.Geometry.Rectangle([-121.62, 44.40, -121.50, 44.50]),
    towers: [
      // Coordinate corrected 2026-08-04 (see pipeline.js for the full note):
      // BADM's post-fire location, valid 2022-08 onward, supersedes the
      // pre-fire point this repo had used everywhere. 123.8 m offset.
      { id: 'US-Me2', regime: 'mature_ponderosa_pine', lon: -121.5589, lat: 44.4526 }
    ]
  }
];

// ── Helpers ─────────────────────────────────────────────────────────

// Count OpenET monthly images over a box for one month. The collection
// is monthly, so a healthy month returns exactly 1.
function openetCount(bbox, month) {
  var start = ee.Date.fromYMD(YEAR, month, 1);
  var end   = start.advance(1, 'month');
  return ee.ImageCollection(OPENET_MONTHLY)
    .filterDate(start, end)
    .filterBounds(bbox)
    .size();
}

// Count clear-ish Landsat 8+9 scenes over a box for one month.
function landsatCount(bbox, month) {
  var start = ee.Date.fromYMD(YEAR, month, 1);
  var end   = start.advance(1, 'month');
  var l8 = ee.ImageCollection(L8).filterDate(start, end).filterBounds(bbox)
             .filter(ee.Filter.lt('CLOUD_COVER', CLOUD_COVER_MAX));
  var l9 = ee.ImageCollection(L9).filterDate(start, end).filterBounds(bbox)
             .filter(ee.Filter.lt('CLOUD_COVER', CLOUD_COVER_MAX));
  return l8.merge(l9).size();
}

// Monthly net radiation (J/m2) over a box from ERA5-Land. ERA5-Land net
// thermal is signed (a loss), so Rn = net_solar + net_thermal. This is
// the denominator that fails in winter — printed per month so the window
// choice is evidence-based (watch for Rn approaching zero).
function monthlyRnImage(bbox, month) {
  var start = ee.Date.fromYMD(YEAR, month, 1);
  var end   = start.advance(1, 'month');
  var era = ee.ImageCollection(ERA5_MONTHLY).filterDate(start, end).first();
  return era.select('surface_net_solar_radiation_sum')
            .add(era.select('surface_net_thermal_radiation_sum'))
            .clip(bbox).rename('rn_J');
}

// Rough Phase-0 monthly evaporative fraction image over a box:
//   EF = (OpenET ET -> latent heat, J/m2) / (ERA5-Land net radiation, J/m2)
// Ground heat flux neglected. Clamp to [0, 1.2] so a broken denominator
// shows up as an implausible >1 rather than being hidden.
function monthlyEF(bbox, month) {
  var start = ee.Date.fromYMD(YEAR, month, 1);
  var end   = start.advance(1, 'month');

  var et_mm = ee.ImageCollection(OPENET_MONTHLY)
    .filterDate(start, end).filterBounds(bbox)
    .select(OPENET_BAND).mean();          // one monthly image
  var le_J = et_mm.multiply(LAMBDA);      // J/m2 over the month

  return le_J.divide(monthlyRnImage(bbox, month)).clamp(0, 1.2).rename('ef');
}

// Sample a value at a tower point.
function sampleAt(image, band, lon, lat) {
  return image.select(band).reduceRegion({
    reducer: ee.Reducer.first(),
    geometry: ee.Geometry.Point([lon, lat]),
    scale: 30,
    maxPixels: 1e4
  }).get(band);
}

// ── 1. Per-site coverage: OpenET months + Landsat scenes ────────────
// Build one flat FeatureCollection of (site, month, openet_images,
// landsat_scenes) rows — printed and exported for the record.
// Monthly net radiation as an average flux (W/m2) sampled at a point.
// ERA5-Land is ~9 km and the boxes are ~10 km, so a point sample matches
// a box mean but is far cheaper — a box-mean reduceRegion x 36 months
// bloated the graph and hit EE's memory ceiling. Rounded to 0.1 so the
// aggregate_array prints inline rather than collapsing to "List (...)".
function rnWm2AtPoint(lon, lat, month) {
  var start = ee.Date.fromYMD(YEAR, month, 1);
  var secondsInMonth = start.advance(1, 'month').difference(start, 'second');
  var era = ee.ImageCollection(ERA5_MONTHLY)
    .filterDate(start, start.advance(1, 'month')).first();
  var rnJ = era.select('surface_net_solar_radiation_sum')
               .add(era.select('surface_net_thermal_radiation_sum'));
  var j = rnJ.reduceRegion({
    reducer: ee.Reducer.first(),
    geometry: ee.Geometry.Point([lon, lat]),
    scale: 1000, maxPixels: 1e4
  }).values().get(0);
  return ee.Number(j).divide(secondsInMonth).multiply(10).round().divide(10);
}

var coverageRows = [];
SITES.forEach(function(site) {
  // Representative point for the (near-uniform) Rn sample: the first tower.
  var rnPt = site.towers[0];
  ALL_MONTHS.forEach(function(month) {
    coverageRows.push(ee.Feature(null, {
      site_code:      site.code,
      site_label:     site.label,
      confidence:     site.confidence,
      year:           YEAR,
      month:          month,
      openet_images:  openetCount(site.bbox, month),
      landsat_scenes: landsatCount(site.bbox, month),
      mean_rn_wm2:    rnWm2AtPoint(rnPt.lon, rnPt.lat, month)
    }));
  });
});
var coverage = ee.FeatureCollection(coverageRows);

print('── Phase 0 coverage — FULL YEAR (OpenET + Landsat + net radiation) ──');
print('Reading: openet_images should be 1 every month. landsat_scenes: watch');
print('where winter/snow collapses it. mean_rn_wm2: watch where it approaches');
print('zero — those months are where EF = LE/(Rn-G) becomes undefined and need');
print('quality masking (Phase 2), NOT blind exclusion.');
print('Months inspected (order of the arrays below):', ALL_MONTHS);
// Flat, month-ordered arrays so all 12 months are readable in the console
// without expanding nested features. Sorted by month → index aligns with
// ALL_MONTHS above.
SITES.forEach(function(site) {
  var fc = coverage.filter(ee.Filter.eq('site_code', site.code)).sort('month');
  print(site.code + ' — openet_images / month:',  fc.aggregate_array('openet_images'));
  print(site.code + ' — landsat_scenes / month:', fc.aggregate_array('landsat_scenes'));
  print(site.code + ' — mean_rn_wm2 / month:',     fc.aggregate_array('mean_rn_wm2'));
});

// ── 2. Tower coordinate manifest (for Phase 1 tower.py) ─────────────
// Printed so the AmeriFlux BASE download + tower.py inherit one
// authoritative coordinate/regime list. AmeriFlux data presence itself
// is an off-platform check (Gate P0 item 3).
print('── Tower manifest (AmeriFlux BASE check is off-platform) ──');
SITES.forEach(function(site) {
  site.towers.forEach(function(t) {
    print(site.code + ' / ' + t.id + ' [' + t.regime + ']',
          'lon ' + t.lon + ', lat ' + t.lat);
  });
});

// ── 3. Mead one-month sanity: irrigated vs rainfed EF ───────────────
// Gate P0 item 4. July is peak maize ET. Expect US-Ne1 (irrigated) in
// ~0.7-0.9 and clearly above US-Ne3 (rainfed). US-Ne2 (irrigated) is
// printed as a second irrigated reference.
var SANITY_MONTH = 7;   // July
var mead = SITES[0];
var meadEF = monthlyEF(mead.bbox, SANITY_MONTH);

var ne1 = mead.towers[0], ne2 = mead.towers[1], ne3 = mead.towers[2];
print('── Mead sanity: monthly EF, ' + YEAR + '-0' + SANITY_MONTH + ' ──');
print('Gate P0: US-Ne1 (irrigated) plausible ~0.7-0.9 AND > US-Ne3 (rainfed).');
print('US-Ne1 irrigated EF:', sampleAt(meadEF, 'ef', ne1.lon, ne1.lat));
print('US-Ne2 irrigated EF:', sampleAt(meadEF, 'ef', ne2.lon, ne2.lat));
print('US-Ne3 rainfed   EF:', sampleAt(meadEF, 'ef', ne3.lon, ne3.lat));

// ── 4. Map preview ──────────────────────────────────────────────────
Map.centerObject(mead.bbox, 12);
var efViz = { min: 0, max: 1, palette: ['8B2500', 'E88219', 'C8D84A', '1D9E75'] };
Map.addLayer(meadEF, efViz, 'Mead July EF (rough Phase-0)');
SITES.forEach(function(site) {
  Map.addLayer(site.bbox, { color: 'white' }, site.code + ' bbox', false);
  site.towers.forEach(function(t) {
    Map.addLayer(ee.Geometry.Point([t.lon, t.lat]),
                 { color: 'cyan' }, site.code + ' ' + t.id, false);
  });
});

// ── 5. Export the coverage table for the record ─────────────────────
Export.table.toDrive({
  collection:     coverage,
  description:    'hrc_30m_usa_feasibility_phase0',
  folder:         'EarthHRC',
  fileNamePrefix: 'hrc_30m_usa_feasibility_phase0',
  fileFormat:     'CSV',
  selectors: [
    'site_code', 'site_label', 'confidence', 'year', 'month',
    'openet_images', 'landsat_scenes', 'mean_rn_wm2'
  ]
});

print('── Next steps ──');
print('1. Read the per-site coverage tables above; confirm Gate P0 per site.');
print('2. Run the export task to archive hrc_30m_usa_feasibility_phase0.csv.');
print('3. Off-platform: confirm AmeriFlux BASE files exist for ' + YEAR +
      ' at each printed tower (Gate P0 item 3).');
print('4. A site failing P0 is swapped for a backup (US-NR1 / US-SRM / ' +
      'US-ARM), not forced.');
