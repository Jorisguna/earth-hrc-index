// ============================================================
// 11_hrc_historical_assam.js
// Earth HRC Index — Historical baseline for Assam, India
//
// Computes the spring pre-monsoon (March–May) mean HRC per tile
// for the historical period 2001–2010, matching the seasonal
// window of the current HRC score (mean of final 3 months of
// the Jun 2018–May 2023 collection = March–May 2023).
//
// Output per tile: longitude, latitude, hrc_historical
//   → load into hrc_historical_reference column in Supabase
//
// Period: 2001–2010, March–May only (30 months)
// Dataset: ECMWF/ERA5_LAND/DAILY_AGGR (Tier C)
// Region: Assam, India
// ============================================================

var region = ee.Geometry.Rectangle([89.6, 24.0, 96.2, 28.3]);
Map.centerObject(region, 7);

var ERA5 = 'ECMWF/ERA5_LAND/DAILY_AGGR';

// ── Step 1: Build monthly HRC for March–May of each year 2001–2010 ──
var years  = ee.List.sequence(2001, 2010);
var months = ee.List([3, 4, 5]);  // March, April, May

var springImages = ee.ImageCollection.fromImages(
  years.map(function(yr) {
    return months.map(function(mo) {
      yr = ee.Number(yr);
      mo = ee.Number(mo);
      var start = ee.Date.fromYMD(yr, mo, 1);
      var end   = start.advance(1, 'month');

      var era5 = ee.ImageCollection(ERA5)
        .filterDate(start, end)
        .filterBounds(region)
        .mean();

      // True net radiation = net solar + net thermal.
      // surface_net_thermal_radiation_sum is negative (net outgoing longwave),
      // so adding it (NOT abs-ing it) gives the physically correct Rn.
      var latentHeat = era5.select('surface_latent_heat_flux_sum').abs();
      var netRad     = era5.select('surface_net_solar_radiation_sum')
                        .add(era5.select('surface_net_thermal_radiation_sum'));
      var netRadSafe = netRad.where(netRad.lte(0), 0.001);
      var ef         = latentHeat.divide(netRadSafe).min(1).max(0);
      var hrc        = ef.multiply(10).rename('hrc_historical').toFloat();

      return hrc
        .clip(region)
        .set('system:time_start', start.millis())
        .set('year', yr)
        .set('month', mo);
    });
  }).flatten()
);

print('Spring HRC image count (should be 30):', springImages.size());

// ── Step 2: Mean historical spring HRC per pixel ──────────────
var historicalHRC = springImages.mean().rename('hrc_historical');

// ── Step 3: Diagnostics ───────────────────────────────────────
// Expect ~6–8 for lowland moist forest, lower for alpine north
print('Historical spring HRC range (expect ~5–9 for Assam):',
  historicalHRC.reduceRegion({
    reducer: ee.Reducer.minMax().combine(ee.Reducer.mean(), '', true),
    geometry: region,
    scale: 11132,
    maxPixels: 1e8
  })
);

// ── Step 4: Sample to grid points (same scale as main scripts) ─
var samplePoints = historicalHRC.sample({
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

print('Sample point count:', samplePoints.size());

// ── Step 5: Map preview ───────────────────────────────────────
Map.addLayer(
  historicalHRC.clip(region),
  { min: 2, max: 9, palette: ['8B2500', 'D4550A', 'F4A623', 'C8D84A', '1D9E75'] },
  'Historical Spring HRC (2001–2010, Mar–May)'
);

// ── Step 6: Export ────────────────────────────────────────────
Export.table.toDrive({
  collection:     samplePoints,
  description:    'HRC_Historical_Assam',
  folder:         'EarthHRC',
  fileNamePrefix: 'HRC_Historical_Assam',
  fileFormat:     'CSV',
  selectors:      ['longitude', 'latitude', 'hrc_historical']
});

print('Export task queued — go to Tasks panel and click RUN.');
