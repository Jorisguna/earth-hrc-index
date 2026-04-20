// ============================================================
// 13_hrc_ceiling_wales.js
// Earth HRC Index — Penman-Monteith physical ceiling — Wales
//
// Computes the theoretical maximum HRC score each tile's local
// climate can support, using the FAO-56 Penman-Monteith reference
// ET equation applied to ERA5-Land climate variables.
//
// The PM ceiling is the hard upper bound on evaporative cooling
// that the available energy and climate allow, regardless of
// land cover. It answers: "What is the most this climate could
// ever cool, if the land were at perfect biological performance?"
//
// ── HOW TO RUN ──────────────────────────────────────────────
// Run this script three times, changing the three variables
// at the top (region, regionName, exportName) each time:
//
//   Run 1 — Wales
//     region     = ee.Geometry.Rectangle([-5.35, 51.35, -2.65, 53.45])
//     regionName = 'Wales'
//     exportName = 'HRC_Ceiling_Wales'
//
//   Run 2 — Assam
//     region     = ee.Geometry.Rectangle([89.6, 24.0, 96.2, 28.3])
//     regionName = 'Assam'
//     exportName = 'HRC_Ceiling_Assam'
//
//   Run 3 — SF Bay
//     region     = ee.Geometry.Rectangle([-123.0, 37.0, -121.2, 38.6])
//     regionName = 'SFBay'
//     exportName = 'HRC_Ceiling_SFBay'
//
// Output per tile: longitude, latitude, hrc_ceiling_reference
//   → load into hrc_ceiling_reference column in Supabase
//   → then run scripts/compute_ceiling_gap.sql to derive
//     restoration_gap_ceiling
//
// Period: June 2018 – May 2023 (60 months — same window as
//         current HRC and 60-month trend, so ceiling and score
//         are directly comparable)
// Dataset: ECMWF/ERA5_LAND/DAILY_AGGR (Tier C)
// ============================================================

var region     = ee.Geometry.Rectangle([-5.35, 51.35, -2.65, 53.45]);
var regionName = 'Wales';
var exportName = 'HRC_Ceiling_Wales';

Map.centerObject(region, 8);

// ── ERA5 climate variables — 60-month mean ───────────────────
var era5 = ee.ImageCollection('ECMWF/ERA5_LAND/DAILY_AGGR')
  .filterDate('2018-06-01', '2023-06-01')
  .filterBounds(region);

// Temperature (K → °C)
var tempC   = era5.select('temperature_2m').mean().subtract(273.15);
var tempMax = era5.select('temperature_2m_max').mean().subtract(273.15);
var tempMin = era5.select('temperature_2m_min').mean().subtract(273.15);

// Dewpoint → actual vapour pressure (kPa)
var dewC = era5.select('dewpoint_temperature_2m').mean().subtract(273.15);

// Wind speed from u/v components (m/s at 10m, adjust to 2m height)
// FAO-56 uses wind at 2m: u2 = u10 × (4.87 / ln(67.8 × 10 − 5.42))
//                             = u10 × 0.748
var windU = era5.select('u_component_of_wind_10m').mean();
var windV = era5.select('v_component_of_wind_10m').mean();
var windSpeed10 = windU.pow(2).add(windV.pow(2)).sqrt();
var windSpeed2  = windSpeed10.multiply(0.748);

// Net radiation (same formula as current HRC — thermal is negative)
var netRad = era5.select('surface_net_solar_radiation_sum').mean()
               .add(era5.select('surface_net_thermal_radiation_sum').mean());
// Convert J/m²/day → W/m² (divide by 86400)
var netRadWm2 = netRad.divide(86400);
// Only positive net radiation supports evaporation
var netRadSafe = netRadWm2.where(netRadWm2.lte(0), 0.001);

// ── FAO-56 Penman-Monteith implementation ────────────────────
// All pressures in kPa.

// Saturation vapour pressure (kPa) from Tmax and Tmin
var esTmax = tempMax.multiply(17.27).divide(tempMax.add(237.3)).exp().multiply(0.6108);
var esTmin = tempMin.multiply(17.27).divide(tempMin.add(237.3)).exp().multiply(0.6108);
var es = esTmax.add(esTmin).divide(2);  // mean saturation VP

// Actual vapour pressure from dewpoint
var ea = dewC.multiply(17.27).divide(dewC.add(237.3)).exp().multiply(0.6108);

// Slope of saturation VP curve (kPa/°C) at mean temp
var delta = es.multiply(4098).divide(tempC.add(237.3).pow(2));

// Psychrometric constant (kPa/°C) — 0.0665 at sea level; ERA5 is gridded
// globally so use a fixed value (small error vs. altitude correction).
var gamma = ee.Image.constant(0.0665);

// FAO-56 ETo formula (mm/day):
// ETo = (0.408 × Δ × Rn + γ × (900 / (T + 273)) × u2 × (es − ea))
//       ÷ (Δ + γ × (1 + 0.34 × u2))
//
// Rn here in MJ/m²/day: convert W/m² → MJ/m²/day (× 86400 / 1e6)
var netRadMJday = netRadSafe.multiply(86400).divide(1e6);

var numerator = delta.multiply(0.408).multiply(netRadMJday)
  .add(
    gamma
      .multiply(ee.Image.constant(900))
      .divide(tempC.add(273))
      .multiply(windSpeed2)
      .multiply(es.subtract(ea))
  );

var denominator = delta.add(
  gamma.multiply(windSpeed2.multiply(0.34).add(1))
);

var etoMmDay = numerator.divide(denominator);  // reference ET in mm/day

// ── Convert PM-ET to HRC ceiling ────────────────────────────
// Latent heat of vaporisation λ ≈ 2.45 MJ/kg at ~20°C.
// 1 mm/day water = 1 kg/m²/day → λE = 1 × 2.45 MJ/m²/day
//               = 2.45 × 1e6 / 86400 W/m² ≈ 28.35 W/m²
var etLatentHeatWm2 = etoMmDay.multiply(28.35);

// EF ceiling = PM latent heat / net radiation
// Capped at 1.0 — ET cannot exceed available energy
var efCeiling = etLatentHeatWm2.divide(netRadSafe).min(1.0).max(0);

var hrcCeiling = efCeiling.multiply(10)
  .rename('hrc_ceiling_reference')
  .toFloat()
  .clip(region);

// ── Diagnostics ──────────────────────────────────────────────
print('PM ceiling range for ' + regionName,
  hrcCeiling.reduceRegion({
    reducer: ee.Reducer.minMax().combine(ee.Reducer.mean(), '', true),
    geometry: region,
    scale: 11132,
    maxPixels: 1e8
  })
);

// ── Sample to grid points ────────────────────────────────────
var samplePoints = hrcCeiling.sample({
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

// ── Map preview ──────────────────────────────────────────────
Map.addLayer(
  hrcCeiling,
  { min: 4, max: 10, palette: ['8B2500', 'D4550A', 'F4A623', 'C8D84A', '1D9E75'] },
  'PM Ceiling HRC (' + regionName + ')'
);

// ── Export ───────────────────────────────────────────────────
Export.table.toDrive({
  collection:     samplePoints,
  description:    exportName,
  folder:         'EarthHRC',
  fileNamePrefix: exportName,
  fileFormat:     'CSV',
  selectors:      ['longitude', 'latitude', 'hrc_ceiling_reference']
});

print('Export task queued. Go to Tasks panel and click RUN.');
