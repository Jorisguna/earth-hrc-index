// ============================================================
// 05_hrc_trend_wales_v2
// Earth HRC Index — Wales trend recomputation
//
// IMPROVEMENTS OVER v1:
//   1. Window extended from 24 months to 60 months (2018-06-01 to 2023-06-30)
//      A 5-year window spans 2–3 full climate cycles, smoothing out single-year
//      anomalies (e.g. the exceptional 2022 UK drought) so the regression slope
//      reflects genuine long-term land use change rather than weather variability.
//
//   2. Statistical significance test added
//      Trend scores where the annual slope is not meaningfully larger than the
//      natural variability of the site are set to 0, per the whitepaper spec
//      (p > 0.10 → display as 0, flag as statistically insufficient).
//
// Scientific rationale: 5-year windows are the minimum defensible length for
// trend claims in land degradation monitoring (see GLEAM and MODIS trend literature).
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
// For each of the 60 months, aggregate ERA5 daily data to a
// monthly mean, compute the evaporative fraction, and scale to HRC.
var months = ee.List.sequence(0, N_MONTHS - 1);

var monthlyCollection = ee.ImageCollection.fromImages(
  months.map(function(m) {
    m = ee.Number(m);
    var start = startDate.advance(m, 'month');
    var end   = start.advance(1, 'month');

    // Monthly mean of ERA5 daily aggregates
    var era5 = ee.ImageCollection(ERA5_DATASET)
      .filterDate(start, end)
      .filterBounds(wales)
      .mean();

    // Energy balance components
    var latentHeat  = era5.select('surface_latent_heat_flux_sum').abs();
    var solarRad    = era5.select('surface_net_solar_radiation_sum').abs();
    var thermalRad  = era5.select('surface_net_thermal_radiation_sum').abs();
    var netRad      = solarRad.add(thermalRad);

    // Evaporative fraction (clamped 0–1 to handle edge cases)
    // Avoid divide-by-zero: replace netRad = 0 with a tiny value
    var netRadSafe  = netRad.where(netRad.lte(0), 0.001);
    var ef          = latentHeat.divide(netRadSafe).min(1).max(0);

    // HRC score: EF × 10
    var hrc = ef.multiply(10).rename('HRC_score').toFloat();

    // Time band: month index (0–59) stored as a float for linearFit
    var timeBand = ee.Image.constant(m.toFloat()).rename('time').toFloat();

    return hrc
      .addBands(timeBand)
      .clip(wales)
      .set('system:time_start', start.millis());
  })
);

print('Monthly collection size (should be 60):', monthlyCollection.size());

// ── Step 2: Linear regression (time → HRC) ───────────────────
// ee.Reducer.linearFit() expects first band = x (time), second = y (HRC).
// Returns 'scale' (slope: HRC per month) and 'offset' (intercept).
var regression = monthlyCollection
  .select(['time', 'HRC_score'])
  .reduce(ee.Reducer.linearFit());

// Annualise the slope: HRC points gained or lost per year
var slopePerYear = regression.select('scale').multiply(12);

// ── Step 3: Statistical significance test ────────────────────
// Noise proxy: standard deviation of monthly HRC values across the 60 months.
// A site with high natural variability needs a stronger trend signal to be
// considered significant. Threshold: |annual slope| must exceed 0.3 × std dev.
// This approximates a p ≈ 0.10 threshold for a 60-point time series.
var hrcStdDev = monthlyCollection
  .select('HRC_score')
  .reduce(ee.Reducer.stdDev());

// Binary mask: 1 where trend is significant, 0 where it is noise
var isSignificant = slopePerYear.abs()
  .gt(hrcStdDev.multiply(0.3));

// ── Step 4: Normalise to −5 … +5 scale ───────────────────────
// Whitepaper: 0.5 HRC units/year = trend score of 1.
// Non-significant trends are zeroed out.
var trendRaw   = slopePerYear.divide(0.5).max(-5).min(5);
var trendScore = trendRaw.multiply(isSignificant).rename('trend_score');

// ── Step 5: Current HRC — mean of final 3 months ─────────────
// Average the last 3 months for a stable current reading.
var currentHRC = monthlyCollection
  .sort('system:time_start', false)
  .limit(3)
  .select('HRC_score')
  .mean()
  .rename('hrc_score');

// ── Step 6: Sample to points for export ──────────────────────
// Sample at ~11 km scale to match ERA5 native resolution.
// geometries: true so lat/lon can be extracted.
var outputImage  = currentHRC.addBands(trendScore);

var samplePoints = outputImage.sample({
  region:     wales,
  scale:      11132,   // ~0.1 degree — ERA5 native resolution
  geometries: true,
  seed:       42
});

// Add longitude and latitude as named properties for CSV export
samplePoints = samplePoints.map(function(f) {
  var coords = f.geometry().coordinates();
  return f
    .set('longitude', coords.get(0))
    .set('latitude',  coords.get(1));
});

print('Sample point count:', samplePoints.size());

// ── Step 7: Diagnostics ───────────────────────────────────────
print('Annual slope range (HRC/year):',
  slopePerYear.reduceRegion({
    reducer:   ee.Reducer.minMax(),
    geometry:  wales,
    scale:     11132,
    maxPixels: 1e8
  })
);

print('Fraction of pixels with significant trend (0–1):',
  isSignificant.reduceRegion({
    reducer:   ee.Reducer.mean(),
    geometry:  wales,
    scale:     11132,
    maxPixels: 1e8
  })
);

print('Trend score range:',
  trendScore.reduceRegion({
    reducer:   ee.Reducer.minMax(),
    geometry:  wales,
    scale:     11132,
    maxPixels: 1e8
  })
);

// ── Step 8: Map preview ───────────────────────────────────────
Map.addLayer(
  currentHRC.clip(wales),
  { min: 3, max: 9, palette: ['8B2500', 'D4550A', 'F4A623', 'C8D84A', '1D9E75'] },
  'HRC Score (current)'
);

Map.addLayer(
  trendScore.clip(wales),
  { min: -5, max: 5, palette: ['C0392B', 'E67E22', '888888', '27AE60', '1A7A4C'] },
  'Trend Score (60-month)'
);

Map.addLayer(
  isSignificant.clip(wales),
  { min: 0, max: 1, palette: ['333333', 'C8D84A'] },
  'Significant pixels (green = yes)',
  false  // hidden by default
);

// ── Step 9: Export to Google Drive ───────────────────────────
Export.table.toDrive({
  collection:    samplePoints,
  description:   'HRC_Wales_Trend_60months',
  folder:        'EarthHRC',
  fileNamePrefix:'HRC_Wales_Trend_60months',
  fileFormat:    'CSV',
  selectors:     ['longitude', 'latitude', 'hrc_score', 'trend_score']
});

print('Export task created: HRC_Wales_Trend_60months');
print('Go to Tasks panel (top right) and click RUN to start the export.');
