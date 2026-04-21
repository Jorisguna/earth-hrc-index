// ============================================================
// 23_hrc_intact_sfbay_v1_1.js
// Earth HRC Index — Intact Site Reference — SF Bay
//
// Computes hrc_reference per RESOLVE ecoregion as the p90 HRC
// of all ERA5 pixels inside IUCN I–IV protected areas.
//
// Uses same HRC formula and time window as hrc_score v1.1:
//   EF = abs(latent_heat) / net_radiation
//   HRC = EF × 10
//   Window: Apr 2025 – Mar 2026 (12-month mean)
//
// Output per ecoregion:
//   ecoregion_id, ecoregion_name, biome_name,
//   hrc_reference (p90), hrc_reference_p75, hrc_reference_p95,
//   pa_pixel_count
//
// Low-confidence flag: pa_pixel_count < 20
//
// Datasets:
//   ECMWF/ERA5_LAND/DAILY_AGGR        (Tier C — HRC)
//   WCMC/WDPA/current/polygons        (IUCN I–IV protected areas)
//   RESOLVE/ECOREGIONS/2017           (ecoregion boundaries)
// ============================================================

var region    = ee.Geometry.Rectangle([-123.0, 37.0, -121.2, 38.6]);
var ERA5      = 'ECMWF/ERA5_LAND/DAILY_AGGR';
var startDate = ee.Date('2025-04-01');
var endDate   = ee.Date('2026-04-01');

Map.centerObject(region, 8);

// ── Step 1: Compute 12-month mean HRC ────────────────────────
// Monthly collection — consistent with hrc_score v1.1 method
var months = ee.List.sequence(0, 11);

var monthlyHRC = ee.ImageCollection.fromImages(
  months.map(function(m) {
    m = ee.Number(m);
    var start = startDate.advance(m, 'month');
    var end   = start.advance(1, 'month');

    var era5 = ee.ImageCollection(ERA5)
      .filterDate(start, end)
      .filterBounds(region)
      .mean();

    var latentHeat = era5.select('surface_latent_heat_flux_sum').abs();
    var netRad     = era5.select('surface_net_solar_radiation_sum')
                      .add(era5.select('surface_net_thermal_radiation_sum'));
    var netRadSafe = netRad.where(netRad.lte(0), 0.001);
    var ef         = latentHeat.divide(netRadSafe).min(1).max(0);
    return ef.multiply(10).rename('hrc_score').toFloat();
  })
);

var currentHRC = monthlyHRC.mean().rename('hrc_score').clip(region);

print('HRC range (all tiles, sanity check — SF Bay expect ~5.0):',
  currentHRC.reduceRegion({
    reducer:   ee.Reducer.minMax().combine(ee.Reducer.mean(), '', true),
    geometry:  region,
    scale:     11132,
    maxPixels: 1e8
  })
);

// ── Step 2: Load WDPA — IUCN I–IV only ──────────────────────
var wdpa = ee.FeatureCollection('WCMC/WDPA/current/polygons')
  .filter(ee.Filter.inList('IUCN_CAT', ['Ia', 'Ib', 'II', 'III', 'IV']))
  .filterBounds(region);

print('WDPA I–IV PA count in region:', wdpa.size());

// ── Step 3: Load RESOLVE ecoregions ─────────────────────────
var resolve = ee.FeatureCollection('RESOLVE/ECOREGIONS/2017')
  .filterBounds(region);

print('Ecoregion count in region:', resolve.size());

// ── Step 4: Per-ecoregion p90 within WDPA ───────────────────
var results = resolve.map(function(eco) {
  var ecoGeom = eco.geometry();

  var wdpaInEco = wdpa.filterBounds(ecoGeom);
  var hasPA     = wdpaInEco.size().gt(0);

  var paGeom = ee.Algorithms.If(
    hasPA,
    wdpaInEco.geometry().intersection(ecoGeom, ee.ErrorMargin(100)),
    ecoGeom  // fallback geometry (stats will be unreliable but won't crash)
  );

  var stats = ee.Algorithms.If(
    hasPA,
    currentHRC.reduceRegion({
      reducer:   ee.Reducer.percentile([75, 90, 95])
                   .combine(ee.Reducer.count(), '', true),
      geometry:  paGeom,
      scale:     11132,
      maxPixels: 1e8
    }),
    ee.Dictionary({
      hrc_score_p75:   null,
      hrc_score_p90:   null,
      hrc_score_p95:   null,
      hrc_score_count: 0
    })
  );

  stats = ee.Dictionary(stats);

  return ee.Feature(null, {
    ecoregion_id:      eco.get('ECO_ID'),
    ecoregion_name:    eco.get('ECO_NAME'),
    biome_name:        eco.get('BIOME_NAME'),
    hrc_reference_p75: stats.get('hrc_score_p75'),
    hrc_reference:     stats.get('hrc_score_p90'),
    hrc_reference_p95: stats.get('hrc_score_p95'),
    pa_pixel_count:    stats.get('hrc_score_count'),
    low_confidence:    ee.Number(stats.get('hrc_score_count')).lt(20)
  });
});

print('Ecoregion results:', results);

// ── Step 5: Map preview ──────────────────────────────────────
Map.addLayer(
  currentHRC,
  { min: 2, max: 10, palette: ['8B2500', 'D4550A', 'F4A623', 'C8D84A', '1D9E75'] },
  'HRC Score (SF Bay, Apr 2025–Mar 2026)'
);
Map.addLayer(wdpa, { color: '2E7D32' }, 'WDPA I–IV');

// ── Step 6: Export ───────────────────────────────────────────
Export.table.toDrive({
  collection:     results,
  description:    'HRC_Intact_SFBay_v1_1',
  folder:         'EarthHRC',
  fileNamePrefix: 'HRC_Intact_SFBay_v1_1',
  fileFormat:     'CSV',
  selectors:      ['ecoregion_id', 'ecoregion_name', 'biome_name',
                   'hrc_reference_p75', 'hrc_reference', 'hrc_reference_p95',
                   'pa_pixel_count', 'low_confidence']
});

print('Export task queued. Go to Tasks panel and click RUN.');
