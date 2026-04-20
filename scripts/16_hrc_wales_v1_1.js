// ============================================================
// 16_hrc_wales_v1_1.js
// Earth HRC Index — Wales — Methodology v1.1
//
// Change from v1.0:
//   hrc_score is now the arithmetic mean of 12 monthly HRC values
//   over the trailing 12-month window (Apr 2025 – Mar 2026),
//   eliminating seasonal flux artefacts.
//
// Trend scores are recomputed over a fresh 60-month window
//   (Apr 2021 – Mar 2026) for consistency.
//
// Outputs per tile:
//   longitude, latitude,
//   hrc_score          (12-month mean, Apr 2025 – Mar 2026)
//   trend_score        (24-month linear trend, annualised)
//   trend_score_60m    (60-month deseasonalised trend, annualised)
//   ecoregion_name, biome_name
//
// Period:  Apr 2021 – Mar 2026  (60 months)
// Dataset: ECMWF/ERA5_LAND/DAILY_AGGR (Tier C)
// ============================================================

var region    = ee.Geometry.Rectangle([-5.35, 51.35, -2.65, 53.45]);
var ERA5      = 'ECMWF/ERA5_LAND/DAILY_AGGR';
var startDate = ee.Date('2021-04-01');   // 60-month window start
var N_MONTHS  = 60;

Map.centerObject(region, 8);

// ── Step 1: Build 60-month monthly HRC collection ────────────
var months = ee.List.sequence(0, N_MONTHS - 1);

var monthlyCollection = ee.ImageCollection.fromImages(
  months.map(function(m) {
    m = ee.Number(m);
    var start = startDate.advance(m, 'month');
    var end   = start.advance(1, 'month');

    var era5 = ee.ImageCollection(ERA5)
      .filterDate(start, end)
      .filterBounds(region)
      .mean();

    // Correct formula: thermal radiation stays negative — never .abs() it.
    var latentHeat = era5.select('surface_latent_heat_flux_sum').abs();
    var netRad     = era5.select('surface_net_solar_radiation_sum')
                      .add(era5.select('surface_net_thermal_radiation_sum'));
    var netRadSafe = netRad.where(netRad.lte(0), 0.001);
    var ef         = latentHeat.divide(netRadSafe).min(1).max(0);
    var hrc        = ef.multiply(10).rename('HRC_score').toFloat();
    var timeBand   = ee.Image.constant(m.toFloat()).rename('time').toFloat();

    return hrc.addBands(timeBand)
      .clip(region)
      .set('system:time_start', start.millis())
      .set('month_index', m);
  })
);

print('Monthly collection size (should be 60):', monthlyCollection.size());

// ── Step 2: Current HRC — mean of last 12 months (v1.1 rule) ─
// Window: Apr 2025 – Mar 2026
var currentHRC = monthlyCollection
  .sort('system:time_start', false)
  .limit(12)
  .select('HRC_score')
  .mean()
  .rename('hrc_score');

// ── Step 3: 24-month trend (no deseasonalisation) ────────────
var last24 = monthlyCollection.sort('system:time_start', false).limit(24);

var trendInput24 = last24.map(function(img) {
  return img.select(['time', 'HRC_score']);
});

var reg24      = trendInput24.reduce(ee.Reducer.linearFit());
var slope24    = reg24.select('scale').multiply(12);
var trendScore = slope24.divide(0.5).max(-5).min(5).rename('trend_score');

// ── Step 4: 60-month deseasonalised trend ────────────────────
var calMonths = ee.List.sequence(1, 12);

var climatology = ee.ImageCollection.fromImages(
  calMonths.map(function(calMon) {
    return monthlyCollection
      .filter(ee.Filter.calendarRange(calMon, calMon, 'month'))
      .select('HRC_score').mean().rename('HRC_score')
      .set('cal_month', calMon);
  })
);

var anomalyCollection = monthlyCollection.map(function(img) {
  var calMon  = img.date().get('month');
  var clim    = climatology.filter(ee.Filter.eq('cal_month', calMon)).first().select('HRC_score');
  var anomaly = img.select('HRC_score').subtract(clim).rename('HRC_anomaly').toFloat();
  return anomaly.addBands(img.select('time'))
    .copyProperties(img, ['system:time_start', 'month_index']);
});

var reg60         = anomalyCollection.select(['time', 'HRC_anomaly']).reduce(ee.Reducer.linearFit());
var slope60       = reg60.select('scale').multiply(12);
var trendScore60m = slope60.divide(0.5).max(-5).min(5).rename('trend_score_60m');

// ── Step 5: Sample to grid points ────────────────────────────
var outputImage = currentHRC
  .addBands(trendScore)
  .addBands(trendScore60m);

var samplePoints = outputImage.sample({
  region:     region,
  scale:      11132,
  geometries: true,
  seed:       42
});

samplePoints = samplePoints.map(function(f) {
  var coords = f.geometry().coordinates();
  return f
    .set('longitude', coords.get(0))
    .set('latitude',  coords.get(1));
});

// ── Step 6: Add ecoregion from RESOLVE 2017 ──────────────────
var resolve = ee.FeatureCollection('RESOLVE/ECOREGIONS/2017');

samplePoints = samplePoints.map(function(f) {
  var eco = resolve.filterBounds(f.geometry()).first();
  return f.set({
    ecoregion_name: ee.Algorithms.If(eco, eco.get('ECO_NAME'), null),
    biome_name:     ee.Algorithms.If(eco, eco.get('BIOME_NAME'), null)
  });
});

// ── Step 7: Diagnostics ───────────────────────────────────────
print('Sample point count:', samplePoints.size());
print('HRC score range (v1.1, 12-month mean):',
  currentHRC.reduceRegion({ reducer: ee.Reducer.minMax().combine(ee.Reducer.mean(), '', true), geometry: region, scale: 11132, maxPixels: 1e8 })
);
print('Trend score (24m) range:',
  trendScore.reduceRegion({ reducer: ee.Reducer.minMax(), geometry: region, scale: 11132, maxPixels: 1e8 })
);

// ── Step 8: Map preview ───────────────────────────────────────
Map.addLayer(
  currentHRC.clip(region),
  { min: 2, max: 8, palette: ['8B2500', 'D4550A', 'F4A623', 'C8D84A', '1D9E75'] },
  'HRC Score v1.1 (Wales, 12-month mean)'
);

// ── Step 9: Export ────────────────────────────────────────────
Export.table.toDrive({
  collection:     samplePoints,
  description:    'HRC_Wales_v1_1',
  folder:         'EarthHRC',
  fileNamePrefix: 'HRC_Wales_v1_1',
  fileFormat:     'CSV',
  selectors:      ['longitude', 'latitude', 'hrc_score', 'trend_score', 'trend_score_60m', 'ecoregion_name', 'biome_name']
});

print('Export task queued — go to Tasks panel and click RUN.');
