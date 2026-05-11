// =====================================================================
// 31_hrc_v2_1_idf_tiles.js — v2.1 higher-fidelity showcase
// Île-de-France 500-metre HRC pipeline
//
// METHODOLOGY (per docs HRC_higher_fidelity_methodology_v2_1.md §4):
//
//   HRC = 10 × annual_latent_heat / annual_net_radiation, clipped [0, 10]
//
//   Latent heat:  PML_V2 v018 (CAS/IGSNRR/PML/V2_v018) at 500 m
//                 Σ_46 composites of (Ec + Es + Ei) × 8 days × 2.45e6 J/m²/mm
//
//   Net Rn:       SW_down (ERA5, 9km) × (1 − α from MCD43A3, 500m)
//                 + LW_down (ERA5, 9km)
//                 − LW_up (σ × ε × LST^4 from MOD11A1+MYD11A1, 1km)
//
//   Time window:  calendar year 2023 (PML_V2 v018 ends 2023-12-27)
//
// CRITICAL TRAPS AVOIDED (per process guide §6 and §8):
//
//   1. PML_V2 unit: bands are mm/day averaged over 8-day composite,
//      NOT mm/8day total. Multiply by 8 to get per-composite mm.
//   2. LW_up Jensen's inequality: compute σ×ε×T^4 SCENE-BY-SCENE,
//      then time-average. Never average T then raise to 4.
//   3. MOD11A1 sample size: production uses Terra + Aqua + day + night
//      to get ~300 valid days/year (not the ~37 of single-satellite-day).
//
// OUTPUT: longitude, latitude, hrc_score, hrc_raw_ratio (unclipped),
//         data_source, data_resolution_m, source_window, lst_source,
//         region_code
// =====================================================================

// ── Region & time window ─────────────────────────────────────────────
var REGION_NAME = 'idf';
var BBOX = ee.Geometry.Rectangle([2.4, 48.3, 3.2, 48.7]);
var YEAR_START = '2023-01-01';
var YEAR_END   = '2024-01-01';
var SOURCE_WINDOW = '2023-01-01/2024-01-01';

Map.centerObject(BBOX, 9);

// ── 1. Latent heat from PML_V2 ───────────────────────────────────────
// Each composite = mm/day averaged over 8 days. ×8 gives per-composite mm.
// ×2.45e6 J/m²/mm gives J/m² per composite. Sum across all 46 composites
// for annual J/m²/yr.
var pmlET = ee.ImageCollection('CAS/IGSNRR/PML/V2_v018')
  .filterDate(YEAR_START, YEAR_END)
  .filterBounds(BBOX);

print('PML_V2 composite count (expect 46):', pmlET.size());

var latentHeatAnnualJ = pmlET.map(function(img) {
  var et_mm_total = img.select(['Ec', 'Es', 'Ei'])
    .reduce(ee.Reducer.sum())
    .multiply(8);  // mm/day → mm per 8-day composite
  return et_mm_total.multiply(2.45e6);  // mm → J/m²
}).sum().clip(BBOX);

print('Annual latent heat range (expect mean ~2.0e9 J/m²/yr):',
  latentHeatAnnualJ.reduceRegion({
    reducer: ee.Reducer.minMax().combine(ee.Reducer.mean(), '', true),
    geometry: BBOX, scale: 500, maxPixels: 1e9
  })
);

// ── 2. Net shortwave: ERA5 SW_down × (1 − MCD43A3 albedo) ────────────
var swDownAnnualJ = ee.ImageCollection('ECMWF/ERA5_LAND/MONTHLY_AGGR')
  .filterDate(YEAR_START, YEAR_END)
  .select('surface_solar_radiation_downwards_sum')
  .sum()
  .clip(BBOX);

var albedoAnnual = ee.ImageCollection('MODIS/061/MCD43A3')
  .filterDate(YEAR_START, YEAR_END)
  .filterBounds(BBOX)
  .map(function(img) {
    // MCD43A3 quality: 0 = best (mandatory)
    var qa = img.select('BRDF_Albedo_Band_Mandatory_Quality_shortwave');
    var albedo = img.select('Albedo_BSA_shortwave').multiply(0.001);
    return albedo.updateMask(qa.eq(0));
  })
  .mean()
  .clip(BBOX);

var netShortwaveJ = swDownAnnualJ.multiply(ee.Image(1).subtract(albedoAnnual));

// ── 3. Net longwave: LW_down − LW_up ─────────────────────────────────
var lwDownAnnualJ = ee.ImageCollection('ECMWF/ERA5_LAND/MONTHLY_AGGR')
  .filterDate(YEAR_START, YEAR_END)
  .select('surface_thermal_radiation_downwards_sum')
  .sum()
  .clip(BBOX);

// LW_up: combine Terra + Aqua, both day and night, compute σ×ε×T^4
// SCENE-BY-SCENE (Jensen's inequality), then time-average.
var SIGMA = 5.67e-8;

function lwUpFromBand(img, lstBandName, qcBandName) {
  var qc = img.select(qcBandName);
  // QC bits 0-1: 00 = best, 01 = produced; 10/11 = not produced.
  // lte(1) keeps both produced categories.
  var goodQuality = qc.bitwiseAnd(3).lte(1);
  var lst_K = img.select(lstBandName).multiply(0.02).updateMask(goodQuality);
  // Emissivity: average of band 31 + band 32, scale + offset
  var emis = img.select('Emis_31').add(img.select('Emis_32')).divide(2)
                .multiply(0.002).add(0.49);
  // Rename to a common band so day + night images merge cleanly.
  // Without .rename(), the output band inherits the LST band name and
  // dayLwUp.merge(nightLwUp).mean() fails with a homogeneity error.
  return lst_K.pow(4).multiply(emis).multiply(SIGMA).rename('lw_up_W');
}

var modCombined = ee.ImageCollection('MODIS/061/MOD11A1')
  .merge(ee.ImageCollection('MODIS/061/MYD11A1'))
  .filterDate(YEAR_START, YEAR_END)
  .filterBounds(BBOX);

var dayLwUp   = modCombined.map(function(img) { return lwUpFromBand(img, 'LST_Day_1km',   'QC_Day'); });
var nightLwUp = modCombined.map(function(img) { return lwUpFromBand(img, 'LST_Night_1km', 'QC_Night'); });

// Time-mean across all valid day + night observations from both satellites.
// Result is annual mean LW_up in W/m².
var lwUpAnnualWperM2 = dayLwUp.merge(nightLwUp).mean();

// Convert annual mean W/m² to annual J/m²/yr (× seconds in year)
var lwUpAnnualJ = lwUpAnnualWperM2.multiply(31536000);  // 365 × 86400

var netLongwaveJ = lwDownAnnualJ.subtract(lwUpAnnualJ);

// ── 4. Total net radiation ───────────────────────────────────────────
var netRnAnnualJ = netShortwaveJ.add(netLongwaveJ);
var netRnSafe = netRnAnnualJ.where(netRnAnnualJ.lte(0), 0.001);

// ── 5. HRC ───────────────────────────────────────────────────────────
var hrc_ratio_unclipped = latentHeatAnnualJ.divide(netRnSafe);
var hrc = hrc_ratio_unclipped.min(1).max(0).multiply(10).rename('hrc_score');
var hrc_raw_ratio = hrc_ratio_unclipped.multiply(10).rename('hrc_raw_ratio');

print('HRC range (IDF — expect mean ~4.5–5.5):',
  hrc.reduceRegion({
    reducer: ee.Reducer.minMax().combine(ee.Reducer.mean(), '', true),
    geometry: BBOX, scale: 500, maxPixels: 1e9
  })
);

// ── 6. Sample to grid points at 500m for export ──────────────────────
// Sampling at scale=500 captures the native PML_V2 / MCD43A3 resolution.
// The H3 res 8 indexing happens in the front-end App.jsx based on
// data_resolution_m = 500.
//
// Each sample point is also tagged with its containing RESOLVE
// ecoregion (using .filterBounds(geom).first() — safe under
// ee.Algorithms.If when no ecoregion contains the point, e.g. over water).
var outputImage = hrc.addBands(hrc_raw_ratio);

var ecoregions = ee.FeatureCollection('RESOLVE/ECOREGIONS/2017')
  .filterBounds(BBOX);

var samplePoints = outputImage.sample({
  region:     BBOX,
  scale:      500,
  projection: 'EPSG:4326',
  geometries: true,
  seed:       42
}).map(function(f) {
  var coords = f.geometry().coordinates();
  var geom = f.geometry();
  var eco  = ecoregions.filterBounds(geom).first();
  return f.set({
    longitude:           ee.Number(coords.get(0)),
    latitude:            ee.Number(coords.get(1)),
    ecoregion_name:      ee.Algorithms.If(eco, eco.get('ECO_NAME'),   null),
    ecoregion_id:        ee.Algorithms.If(eco, eco.get('ECO_ID'),     null),
    biome_name:          ee.Algorithms.If(eco, eco.get('BIOME_NAME'), null),
    region_code:         REGION_NAME,
    data_source:         'PML_V2_500m',
    data_resolution_m:   500,
    source_window:       SOURCE_WINDOW,
    lst_source:          'mixed_Terra_Aqua_day_night',
    methodology_version: 'v2.1_higher_fidelity'
  });
});

print('Sample point count (IDF — expect ~10,000):', samplePoints.size());

// ── 7. Map preview ───────────────────────────────────────────────────
Map.addLayer(hrc,
  { min: 0, max: 10, palette: ['8B2500','D4550A','F4A623','C8D84A','1D9E75'] },
  'HRC v2.1 (IDF, 500m)'
);

// Mark FR-Fon flux tower for visual sanity check
Map.addLayer(
  ee.Geometry.Point([2.780, 48.476]),
  { color: 'red' },
  'FR-Fon tower (acceptance gate target = 5.04 ± 0.5)'
);

// ── 8. Export ────────────────────────────────────────────────────────
Export.table.toDrive({
  collection:     samplePoints,
  description:    'hrc_v2_1_idf_tiles',
  folder:         'EarthHRC',
  fileNamePrefix: 'hrc_v2_1_idf_tiles',
  fileFormat:     'CSV',
  selectors: [
    'longitude', 'latitude', 'hrc_score', 'hrc_raw_ratio',
    'ecoregion_id', 'ecoregion_name', 'biome_name',
    'region_code', 'data_source', 'data_resolution_m',
    'source_window', 'lst_source', 'methodology_version'
  ]
});

print('Export task queued. Go to Tasks panel and click RUN.');
