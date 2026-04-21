// ============================================================
// 25_hrc_tiles_wales_v2_0.js
// Earth HRC Index — Tile Recompute — Wales — v2.0
//
// Formula: ratio of annual sums (canonical EF definition)
//   HRC = 10 × Σ|λE_monthly| / Σ(Rn_monthly)
//   Matches GLEAM, FLUXNET, MODIS MOD16 annual EF convention.
//   Supersedes v1.1 (mean of monthly EFs — retired).
//
// Dataset: ECMWF/ERA5_LAND/MONTHLY_AGGR (Tier C)
// Window:  Jan 2025 – Jan 2026 (12 months)
// Scale:   11132m (ERA5 native)
//
// Output columns:
//   longitude, latitude, HRC_score, evaporative_fraction,
//   latent_heat_flux, net_radiation, solar_radiation,
//   thermal_radiation, soil_moisture, total_evaporation,
//   ecoregion_name, ecoregion_id, biome_name, realm,
//   confidence_tier, trend_score, computation_window, hrc_formula
//
// Verify: Wales mean HRC should be ~8.5–9.0
//         If below 5.0, thermal radiation sign is wrong
// ============================================================

var region    = ee.Geometry.Rectangle([-5.35, 51.35, -2.65, 53.45]);
var startDate = ee.Date('2025-01-01');
var endDate   = ee.Date('2026-01-01');

Map.centerObject(region, 8);

// ── Step 1: Compute HRC (ratio of annual sums) ───────────────
var era5 = ee.ImageCollection('ECMWF/ERA5_LAND/MONTHLY_AGGR')
  .filterDate(startDate, endDate)
  .filterBounds(region);

// Sum 12 monthly fluxes
var latentHeat = era5.select('surface_latent_heat_flux_sum')
                     .map(function(img) { return img.abs(); })
                     .sum().clip(region);

var solarRad   = era5.select('surface_net_solar_radiation_sum')
                     .sum().clip(region);
var thermalRad = era5.select('surface_net_thermal_radiation_sum')
                     .sum().clip(region);

// CRITICAL: thermal radiation is NEGATIVE — never .abs() it
var netRad     = solarRad.add(thermalRad);
var netRadSafe = netRad.where(netRad.lte(0), 0.001);

var ef  = latentHeat.divide(netRadSafe).min(1).max(0);
var hrc = ef.multiply(10).rename('HRC_score').toFloat();

// Additional variables
var soilMoisture = era5.select('volumetric_soil_water_layer_1')
                       .mean().clip(region).rename('soil_moisture');
var totalEvap    = era5.select('total_evaporation_sum')
                       .sum().clip(region).rename('total_evaporation');

// ── Step 2: Sanity check ─────────────────────────────────────
print('HRC range (Wales — expect mean ~8.5–9.0):',
  hrc.reduceRegion({
    reducer: ee.Reducer.minMax().combine(ee.Reducer.mean(), '', true),
    geometry: region, scale: 11132, maxPixels: 1e8
  })
);

// ── Step 3: Stack bands for sampling ─────────────────────────
var stack = hrc
  .addBands(ef.rename('evaporative_fraction'))
  .addBands(latentHeat.rename('latent_heat_flux'))
  .addBands(netRad.rename('net_radiation'))
  .addBands(solarRad.rename('solar_radiation'))
  .addBands(thermalRad.rename('thermal_radiation'))
  .addBands(soilMoisture)
  .addBands(totalEvap);

// ── Step 4: Sample at ERA5 grid ──────────────────────────────
var ecoregions = ee.FeatureCollection('RESOLVE/ECOREGIONS/2017')
  .filterBounds(region);

var samplePoints = stack.sample({
  region:     region,
  scale:      11132,
  geometries: true,
  seed:       42
});

// ── Step 5: Join ecoregion to each point ─────────────────────
var withEco = samplePoints.map(function(point) {
  var geom = point.geometry();
  var eco  = ecoregions.filterBounds(geom).first();
  return point.set({
    latitude:          geom.coordinates().get(1),
    longitude:         geom.coordinates().get(0),
    ecoregion_name:    ee.Algorithms.If(eco, eco.get('ECO_NAME'),   null),
    ecoregion_id:      ee.Algorithms.If(eco, eco.get('ECO_ID'),     null),
    biome_name:        ee.Algorithms.If(eco, eco.get('BIOME_NAME'), null),
    realm:             ee.Algorithms.If(eco, eco.get('REALM'),      null),
    confidence_tier:   'C',
    trend_score:       0,
    computation_window: '2025-01-01/2026-01-01',
    hrc_formula:       'ratio_of_annual_sums_v2.0'
  });
});

print('Total sample points:', withEco.size());

// ── Step 6: Map preview ──────────────────────────────────────
Map.addLayer(
  hrc,
  { min: 0, max: 10, palette: ['d73027', 'fee08b', '1a9850'] },
  'HRC v2.0 (Wales)'
);

// ── Step 7: Export ───────────────────────────────────────────
Export.table.toDrive({
  collection:     withEco,
  description:    'tiles_wales_v2_0',
  folder:         'EarthHRC',
  fileNamePrefix: 'tiles_wales_v2_0',
  fileFormat:     'CSV'
});

print('Export task queued. Go to Tasks panel and click RUN.');
