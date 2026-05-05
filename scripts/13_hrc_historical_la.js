// =====================================================================
// 13_hrc_historical_la.js — v2.1
// Heat Regulation Capacity Historical Baseline — Los Angeles
//
// FIRST IMPLEMENTATION for LA. The v2.0 pilot deliberately skipped LA
// historical to avoid encoding the deprecated v2.0 prototype methodology
// into a third region. This script is born v2.1 — methodology aligned
// with the v2.0 current HRC score from day one.
//
// METHODOLOGY (per docs/historical_v2_1_methodology.md):
//   For each year y in 2001–2010:
//     HRC_annual_y = 10 × Σ|λE_y,m| / Σ(R_solar_y,m + R_thermal_y,m)
//   HRC_historical_reference = mean of the 10 annual values.
//
// Bounding box matches the v2.0 LA tile import:
//   [-119.0, 33.6, -117.4, 34.4]
//
// Sampling: native ERA5-Land grid (scale 11132), lat/lon emitted at
//   EPSG:4326 for 5dp matching against the live hrc_tiles table.
//
// Notes on LA confidence:
//   The Mojave Desert subset of this region has fewer ERA5 ground stations
//   than coastal LA. Tiles are flagged historical_confidence='medium-low'
//   in the import SQL to surface this in the user interface.
// =====================================================================

var region     = ee.Geometry.Rectangle([-119.0, 33.6, -117.4, 34.4]);
var regionName = 'la';
var years      = ee.List.sequence(2001, 2010);

Map.centerObject(region, 8);

// ── Per-year HRC: identical formula to v2.0 current score ────────────
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

// ── 10-year mean ─────────────────────────────────────────────────────
var annualHRCs = ee.ImageCollection.fromImages(years.map(computeAnnualHRC));

var historicalBaseline = annualHRCs.mean()
  .rename('hrc_historical_reference')
  .toFloat()
  .clip(region);

print('Historical baseline range (LA — expect mean ~2.8–3.5):',
  historicalBaseline.reduceRegion({
    reducer: ee.Reducer.minMax().combine(ee.Reducer.mean(), '', true),
    geometry: region, scale: 11132, maxPixels: 1e8
  })
);

// ── Sample on native ERA5-Land grid, emit lat/lon for 5dp matching ───
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

print('Sample point count (LA — expect ~98):', historicalFC.size());

// ── Map preview ──────────────────────────────────────────────────────
Map.addLayer(historicalBaseline,
  { min: 0, max: 10, palette: ['8B2500','D4550A','F4A623','C8D84A','1D9E75'] },
  'HRC historical 2001–2010 (' + regionName + ')'
);

// ── Export ───────────────────────────────────────────────────────────
Export.table.toDrive({
  collection:     historicalFC,
  description:    'hrc_historical_v2_1_' + regionName,
  folder:         'EarthHRC',
  fileNamePrefix: 'hrc_historical_v2_1_' + regionName,
  fileFormat:     'CSV',
  selectors:      ['longitude', 'latitude', 'hrc_historical_reference']
});

print('Export task queued. Go to Tasks panel and click RUN.');
