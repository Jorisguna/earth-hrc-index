// =====================================================================
// 32_hrc_v2_1_tapajos_tiles.js — v2.1 higher-fidelity showcase
// Tapajós 500-metre HRC pipeline
//
// Methodology, traps avoided, and pipeline structure are identical
// to script 31 (Île-de-France). The only differences are:
//   - Bounding box: [-55.4, -3.3, -54.5, -2.4]
//   - Region code: 'tapajos'
//   - Acceptance gate target: K67 tower (-2.857°S, -54.959°W) at 7.89
//
// See script 31 for the methodology commentary; both pipelines run
// the same canonical flow.
// =====================================================================

// ── Region & time window ─────────────────────────────────────────────
var REGION_NAME = 'tapajos';
var BBOX = ee.Geometry.Rectangle([-55.4, -3.3, -54.5, -2.4]);
var YEAR_START = '2023-01-01';
var YEAR_END   = '2024-01-01';
var SOURCE_WINDOW = '2023-01-01/2024-01-01';

Map.centerObject(BBOX, 9);

// ── 1. Latent heat from PML_V2 ───────────────────────────────────────
var pmlET = ee.ImageCollection('CAS/IGSNRR/PML/V2_v018')
  .filterDate(YEAR_START, YEAR_END)
  .filterBounds(BBOX);

print('PML_V2 composite count (expect 46):', pmlET.size());

var latentHeatAnnualJ = pmlET.map(function(img) {
  var et_mm_total = img.select(['Ec', 'Es', 'Ei'])
    .reduce(ee.Reducer.sum())
    .multiply(8);
  return et_mm_total.multiply(2.45e6);
}).sum().clip(BBOX);

print('Annual latent heat range (Tapajós — expect mean ~3.5e9 J/m²/yr):',
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

var SIGMA = 5.67e-8;

function lwUpFromBand(img, lstBandName, qcBandName) {
  var qc = img.select(qcBandName);
  var goodQuality = qc.bitwiseAnd(3).lte(1);
  var lst_K = img.select(lstBandName).multiply(0.02).updateMask(goodQuality);
  var emis = img.select('Emis_31').add(img.select('Emis_32')).divide(2)
                .multiply(0.002).add(0.49);
  // .rename() to a common band name so day + night merge homogeneously.
  return lst_K.pow(4).multiply(emis).multiply(SIGMA).rename('lw_up_W');
}

var modCombined = ee.ImageCollection('MODIS/061/MOD11A1')
  .merge(ee.ImageCollection('MODIS/061/MYD11A1'))
  .filterDate(YEAR_START, YEAR_END)
  .filterBounds(BBOX);

var dayLwUp   = modCombined.map(function(img) { return lwUpFromBand(img, 'LST_Day_1km',   'QC_Day'); });
var nightLwUp = modCombined.map(function(img) { return lwUpFromBand(img, 'LST_Night_1km', 'QC_Night'); });

var lwUpAnnualWperM2 = dayLwUp.merge(nightLwUp).mean();
var lwUpAnnualJ = lwUpAnnualWperM2.multiply(31536000);

var netLongwaveJ = lwDownAnnualJ.subtract(lwUpAnnualJ);

// ── 4. Total net radiation ───────────────────────────────────────────
var netRnAnnualJ = netShortwaveJ.add(netLongwaveJ);
var netRnSafe = netRnAnnualJ.where(netRnAnnualJ.lte(0), 0.001);

// ── 5. HRC ───────────────────────────────────────────────────────────
var hrc_ratio_unclipped = latentHeatAnnualJ.divide(netRnSafe);
var hrc = hrc_ratio_unclipped.min(1).max(0).multiply(10).rename('hrc_score');
var hrc_raw_ratio = hrc_ratio_unclipped.multiply(10).rename('hrc_raw_ratio');

print('HRC range (Tapajós — expect mean ~7.0–8.0):',
  hrc.reduceRegion({
    reducer: ee.Reducer.minMax().combine(ee.Reducer.mean(), '', true),
    geometry: BBOX, scale: 500, maxPixels: 1e9
  })
);

// ── 6. Sample to grid points at 500m for export ──────────────────────
// Each sample point is tagged with its containing RESOLVE ecoregion
// (using .filterBounds(geom).first(), safe via ee.Algorithms.If).
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

print('Sample point count (Tapajós — expect ~30,000-40,000):', samplePoints.size());

// ── 7. Map preview ───────────────────────────────────────────────────
Map.addLayer(hrc,
  { min: 0, max: 10, palette: ['8B2500','D4550A','F4A623','C8D84A','1D9E75'] },
  'HRC v2.1 (Tapajós, 500m)'
);

// Mark K67 flux tower for visual sanity check
Map.addLayer(
  ee.Geometry.Point([-54.959, -2.857]),
  { color: 'red' },
  'K67 tower (acceptance gate target = 7.89 ± 0.5)'
);

// ── 8. Export ────────────────────────────────────────────────────────
Export.table.toDrive({
  collection:     samplePoints,
  description:    'hrc_v2_1_tapajos_tiles',
  folder:         'EarthHRC',
  fileNamePrefix: 'hrc_v2_1_tapajos_tiles',
  fileFormat:     'CSV',
  selectors: [
    'longitude', 'latitude', 'hrc_score', 'hrc_raw_ratio',
    'ecoregion_id', 'ecoregion_name', 'biome_name',
    'region_code', 'data_source', 'data_resolution_m',
    'source_window', 'lst_source', 'methodology_version'
  ]
});

print('Export task queued. Go to Tasks panel and click RUN.');
