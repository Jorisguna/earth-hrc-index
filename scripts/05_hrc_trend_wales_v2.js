// ============================================================
// 05_hrc_trend_wales_v2
// Earth HRC Index — Wales trend recomputation
//
// IMPROVEMENTS OVER v1:
//   1. Window extended from 24 months to 60 months (2018-06-01 to 2023-06-30)
//
//   2. Deseasonalization before regression
//      The seasonal cycle (summer HRC ~8, winter HRC ~4) is much larger than
//      any long-term trend signal. Without removing it first, the significance
//      test compares the annual slope against seasonal noise — which means
//      everything looks insignificant. Deseasonalization subtracts the long-run
//      monthly mean (e.g. the average of all 5 Januaries) from each observation
//      so the regression sees only year-on-year change.
//
//   3. Statistical significance test on deseasonalized anomalies
//      Trends where the annual slope is smaller than the residual noise are
//      set to 0, per the whitepaper (p > 0.10 → display as 0).
//      Threshold: |slope| must exceed 0.15 × stdDev(anomalies).
//      This is calibrated for 60 monthly anomaly observations.
//
// Scientific rationale: 5-year deseasonalized regression is the standard
// approach in GLEAM and MODIS land degradation literature for isolating
// genuine land use change from climate variability.
// ============================================================

// ── Study region ─────────────────────────────────────────────
var wales = ee.Geometry.Rectangle([-5.35, 51.35, -2.65, 53.45]);
Map.centerObject(wales, 8);

// ── ERA5 dataset ─────────────────────────────────────────────
var ERA5_DATASET = 'ECMWF/ERA5_LAND/DAILY_AGGR';

// ── Time window ──────────────────────────────────────────────
var startDate = ee.Date('2018-06-01');
var N_MONTHS  = 60;  // June 2018 → May 2023 (60 months)

// ── Step 1: Compute monthly HRC images ───────────────────────
var months = ee.List.sequence(0, N_MONTHS - 1);

var monthlyCollection = ee.ImageCollection.fromImages(
  months.map(function(m) {
    m = ee.Number(m);
    var start = startDate.advance(m, 'month');
    var end   = start.advance(1, 'month');

    var era5 = ee.ImageCollection(ERA5_DATASET)
      .filterDate(start, end)
      .filterBounds(wales)
      .mean();

    var latentHeat  = era5.select('surface_latent_heat_flux_sum').abs();
    var solarRad    = era5.select('surface_net_solar_radiation_sum').abs();
    var thermalRad  = era5.select('surface_net_thermal_radiation_sum').abs();
    var netRad      = solarRad.add(thermalRad);

    var netRadSafe  = netRad.where(netRad.lte(0), 0.001);
    var ef          = latentHeat.divide(netRadSafe).min(1).max(0);
    var hrc         = ef.multiply(10).rename('HRC_score').toFloat();

    var timeBand    = ee.Image.constant(m.toFloat()).rename('time').toFloat();

    return hrc
      .addBands(timeBand)
      .clip(wales)
      .set('system:time_start', start.millis())
      .set('month_index', m);
  })
);

print('Monthly collection size (should be 60):', monthlyCollection.size());

// ── Step 2: Deseasonalize ─────────────────────────────────────
// For each calendar month (Jan=1 … Dec=12), compute the mean HRC
// across all 5 years of that month — this is the climatology.
// Subtract it from each observation to get the anomaly:
// anomaly = observed HRC − long-run mean for that calendar month.
// Result: seasonal cycle removed, only year-on-year change remains.

var calMonths = ee.List.sequence(1, 12);

// Build a dictionary mapping calendar month → mean HRC image
var climatology = ee.ImageCollection.fromImages(
  calMonths.map(function(calMon) {
    var mean = monthlyCollection
      .filter(ee.Filter.calendarRange(calMon, calMon, 'month'))
      .select('HRC_score')
      .mean()
      .rename('HRC_score');
    return mean.set('cal_month', calMon);
  })
);

// Subtract the climatological mean for each month
var anomalyCollection = monthlyCollection.map(function(img) {
  var calMon = img.date().get('month');
  var clim   = climatology
    .filter(ee.Filter.eq('cal_month', calMon))
    .first()
    .select('HRC_score');

  var anomaly = img.select('HRC_score')
    .subtract(clim)
    .rename('HRC_anomaly')
    .toFloat();

  return anomaly
    .addBands(img.select('time'))
    .copyProperties(img, ['system:time_start', 'month_index']);
});

// ── Step 3: Linear regression on anomalies ───────────────────
// Now regressing year-on-year HRC change against time.
// 'scale' = slope in HRC anomaly units per month.
var regression = anomalyCollection
  .select(['time', 'HRC_anomaly'])
  .reduce(ee.Reducer.linearFit());

// Annualise slope
var slopePerYear = regression.select('scale').multiply(12);

// ── Step 4: Statistical significance test ────────────────────
// Noise proxy: stdDev of the anomaly values (after seasonal removal).
// This is now a much smaller number than the raw monthly stdDev —
// it represents genuine interannual variability, not the seasonal cycle.
// Threshold: |annual slope| > 0.15 × anomaly stdDev
// (calibrated for 60-point deseasonalized series, ≈ p 0.10 criterion)
var anomalyStdDev = anomalyCollection
  .select('HRC_anomaly')
  .reduce(ee.Reducer.stdDev());

var isSignificant = slopePerYear.abs()
  .gt(anomalyStdDev.multiply(0.15));

// ── Step 5: Normalise to −5 … +5 ─────────────────────────────
// Whitepaper: 0.5 HRC units/year = trend score of 1.
var trendRaw   = slopePerYear.divide(0.5).max(-5).min(5);
var trendScore = trendRaw.multiply(isSignificant).rename('trend_score');

// ── Step 6: Current HRC — mean of final 3 months ─────────────
var currentHRC = monthlyCollection
  .sort('system:time_start', false)
  .limit(3)
  .select('HRC_score')
  .mean()
  .rename('hrc_score');

// ── Step 7: Sample to points for export ──────────────────────
var outputImage  = currentHRC.addBands(trendScore);

var samplePoints = outputImage.sample({
  region:     wales,
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

print('Sample point count:', samplePoints.size());

// ── Step 8: Diagnostics ───────────────────────────────────────
print('Annual slope range (HRC anomaly/year):',
  slopePerYear.reduceRegion({
    reducer: ee.Reducer.minMax(), geometry: wales, scale: 11132, maxPixels: 1e8
  })
);

print('Anomaly stdDev range (after deseasonalisation):',
  anomalyStdDev.reduceRegion({
    reducer: ee.Reducer.minMax(), geometry: wales, scale: 11132, maxPixels: 1e8
  })
);

print('Fraction of pixels with significant trend (0–1):',
  isSignificant.reduceRegion({
    reducer: ee.Reducer.mean(), geometry: wales, scale: 11132, maxPixels: 1e8
  })
);

print('Trend score range:',
  trendScore.reduceRegion({
    reducer: ee.Reducer.minMax(), geometry: wales, scale: 11132, maxPixels: 1e8
  })
);

// ── Step 9: Map preview ───────────────────────────────────────
Map.addLayer(
  currentHRC.clip(wales),
  { min: 3, max: 9, palette: ['8B2500', 'D4550A', 'F4A623', 'C8D84A', '1D9E75'] },
  'HRC Score (current)'
);

Map.addLayer(
  trendScore.clip(wales),
  { min: -5, max: 5, palette: ['C0392B', 'E67E22', '888888', '27AE60', '1A7A4C'] },
  'Trend Score (60-month, deseasonalised)'
);

Map.addLayer(
  isSignificant.clip(wales),
  { min: 0, max: 1, palette: ['333333', 'C8D84A'] },
  'Significant pixels (green = yes)',
  false
);

// ── Step 10: Export ───────────────────────────────────────────
Export.table.toDrive({
  collection:     samplePoints,
  description:    'HRC_Wales_Trend_60months',
  folder:         'EarthHRC',
  fileNamePrefix: 'HRC_Wales_Trend_60months',
  fileFormat:     'CSV',
  selectors:      ['longitude', 'latitude', 'hrc_score', 'trend_score']
});

print('Export task queued. Go to Tasks panel and click RUN.');
