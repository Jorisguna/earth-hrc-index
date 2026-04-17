// ============================================================
// 08_hrc_tiles_assam.js
// Earth HRC Index — Assam, India pilot region
//
// Outputs per tile:
//   longitude, latitude, hrc_score (current),
//   trend_score (24-month), trend_score_60m (60-month deseasonalised),
//   ecoregion_name, biome_name
//
// Period: June 2018 – May 2023 (60 months)
// Dataset: ECMWF/ERA5_LAND/DAILY_AGGR (Tier C)
// ============================================================

var region = ee.Geometry.Rectangle([89.6, 24.0, 96.2, 28.3]);
Map.centerObject(region, 7);

var ERA5 = 'ECMWF/ERA5_LAND/DAILY_AGGR';
var startDate = ee.Date('2018-06-01');
var N_MONTHS  = 60;

// ── Step 1: Build monthly HRC collection ─────────────────────
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

    var latentHeat = era5.select('surface_latent_heat_flux_sum').abs();
    var solarRad   = era5.select('surface_net_solar_radiation_sum').abs();
    var thermalRad = era5.select('surface_net_thermal_radiation_sum').abs();
    var netRad     = solarRad.add(thermalRad);
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

// ── Step 2: Current HRC — mean of final 3 months ─────────────
var currentHRC = monthlyCollection
  .sort('system:time_start', false)
  .limit(3)
  .select('HRC_score')
  .mean()
  .rename('hrc_score');

// ── Step 3: 24-month trend (no deseasonalisation) ────────────
// Simple regression on the most recent 24 months.
var last24 = monthlyCollection.sort('system:time_start', false).limit(24);

var trend24input = last24.map(function(img) {
  return img.select(['time', 'HRC_score']);
});

var reg24       = trend24input.reduce(ee.Reducer.linearFit());
var slope24     = reg24.select('scale').multiply(12);   // per year
var trendScore  = slope24.divide(0.5).max(-5).min(5).rename('trend_score');

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

var reg60          = anomalyCollection.select(['time', 'HRC_anomaly']).reduce(ee.Reducer.linearFit());
var slope60        = reg60.select('scale').multiply(12);
var trendScore60m  = slope60.divide(0.5).max(-5).min(5).rename('trend_score_60m');

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

var withEcoregion = ee.Join.saveFirst('ecoregion').apply({
  primary:   samplePoints,
  secondary: resolve,
  condition: ee.Filter.intersects('.geo', '.geo')
});

samplePoints = withEcoregion.map(function(f) {
  var eco = ee.Feature(f.get('ecoregion'));
  return f.set({
    ecoregion_name: eco.get('ECO_NAME'),
    biome_name:     eco.get('BIOME_NAME')
  });
});

// ── Step 7: Diagnostics ───────────────────────────────────────
print('Sample point count:', samplePoints.size());
print('HRC score range:',
  currentHRC.reduceRegion({ reducer: ee.Reducer.minMax(), geometry: region, scale: 11132, maxPixels: 1e8 })
);
print('Trend score (24m) range:',
  trendScore.reduceRegion({ reducer: ee.Reducer.minMax(), geometry: region, scale: 11132, maxPixels: 1e8 })
);
print('Trend score (60m) range:',
  trendScore60m.reduceRegion({ reducer: ee.Reducer.minMax(), geometry: region, scale: 11132, maxPixels: 1e8 })
);

// ── Step 8: Map preview ───────────────────────────────────────
Map.addLayer(
  currentHRC.clip(region),
  { min: 3, max: 9, palette: ['8B2500', 'D4550A', 'F4A623', 'C8D84A', '1D9E75'] },
  'HRC Score (current)'
);
Map.addLayer(
  trendScore60m.clip(region),
  { min: -5, max: 5, palette: ['C0392B', 'E67E22', '888888', '27AE60', '1A7A4C'] },
  'Trend Score (60-month, deseasonalised)'
);

// ── Step 9: Export ────────────────────────────────────────────
Export.table.toDrive({
  collection:     samplePoints,
  description:    'HRC_Assam_Tiles',
  folder:         'EarthHRC',
  fileNamePrefix: 'HRC_Assam_Tiles',
  fileFormat:     'CSV',
  selectors:      ['longitude', 'latitude', 'hrc_score', 'trend_score', 'trend_score_60m', 'ecoregion_name', 'biome_name']
});

print('Export task queued — go to Tasks panel and click RUN.');
