// =====================================================================
// 32_hrc_v2_1_tapajos_tiles_v2_1_2.js — v2.1 higher-fidelity showcase
// Tapajós 500-metre Heat Regulation Capacity pipeline
//
// v2.1.2 (May 2026): adds latent_heat_flux_annual_wm2 — absolute
//   latent heat flux magnitude diagnostic, in watts per square metre.
//   Companion field to Heat Regulation Capacity ratio; see the
//   Île-de-France script (31_*) and
//   HRC_absolute_latent_heat_flux_handoff_v1_0.md for full rationale.
//
// v2.1.1 (May 2026): land-surface-temperature day/night equal-weight fix.
//
// Methodology, traps avoided, and pipeline structure are identical to
// script 31 (Île-de-France). Only differences:
//   - Bounding box: [-55.4, -3.3, -54.5, -2.4]
//   - Region code: 'tapajos'
//   - Acceptance gate target: K67 tower (-2.857°S, -54.959°W)
//   - Heat Regulation Capacity matched-methodology reference: 7.65 ± 2.0
//     (with documented Penman-Monteith-Leuning underestimate in dense
//     humid tropical evergreen forest — methodology paper §7.6)
//   - Latent heat flux gate (new v2.1.2): 88–100 W/m² at K67 pixel;
//     60–90 W/m² regional mean.
//
// See script 31 for the full methodology commentary; both pipelines run
// the same canonical flow.
// =====================================================================

// ── Region & time window ─────────────────────────────────────────────
var REGION_NAME = 'tapajos';
var BBOX = ee.Geometry.Rectangle([-55.4, -3.3, -54.5, -2.4]);
var YEAR_START = '2023-01-01';
var YEAR_END   = '2024-01-01';
var SOURCE_WINDOW = '2023-01-01/2024-01-01';

Map.centerObject(BBOX, 9);

// ── 1. Latent heat from Penman-Monteith-Leuning V2 ───────────────────
var pmlET = ee.ImageCollection('CAS/IGSNRR/PML/V2_v018')
  .filterDate(YEAR_START, YEAR_END)
  .filterBounds(BBOX);

print('Penman-Monteith-Leuning V2 composite count (expect 46):', pmlET.size());

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

// ── 1b. NEW v2.1.2 — absolute latent heat flux magnitude diagnostic ──
// Annual mean latent heat flux in watts per square metre. See script 31
// or HRC_absolute_latent_heat_flux_handoff_v1_0.md for full rationale.
//   2.45e6 J/m²/mm ÷ 31,536,000 s/yr = 0.0777 W/m² per (mm/yr)
var SECONDS_PER_YEAR = 31536000;  // 365 × 86400, non-leap year

var latentHeatFluxAnnualWm2 = latentHeatAnnualJ
  .divide(SECONDS_PER_YEAR)
  .rename('latent_heat_flux_annual_wm2');

// Acceptance gate read 1 of 2 — K67 tower pixel (BR-Sa1)
// Target: 88 to 100 W/m² (Penman-Monteith-Leuning V2 satellite value;
// matches tower uncorrected value within published tolerance).
// Case study predicts ~94 W/m² (3.31 mm/day × 28.36 = 93.87).
// Tower uncorrected reference: 93.0 W/m² (10-year record, 175,296 obs).
print('Latent heat flux at K67 tower pixel (gate 88–100 W/m², predicted ~94):',
  latentHeatFluxAnnualWm2.reduceRegion({
    reducer: ee.Reducer.first(),
    geometry: ee.Geometry.Point([-54.959, -2.857]),
    scale:    500,
    maxPixels: 1e9
  })
);

// Acceptance gate read 2 of 2 — Tapajós regional mean
// Target: 60 to 90 W/m² (mixed primary-and-disturbed forest landscape).
print('Regional mean latent heat flux (Tapajós, gate 60–90 W/m²):',
  latentHeatFluxAnnualWm2.reduceRegion({
    reducer: ee.Reducer.mean(),
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
  return lst_K.pow(4).multiply(emis).multiply(SIGMA).rename('lw_up_W');
}

var modCombined = ee.ImageCollection('MODIS/061/MOD11A1')
  .merge(ee.ImageCollection('MODIS/061/MYD11A1'))
  .filterDate(YEAR_START, YEAR_END)
  .filterBounds(BBOX);

var dayLwUp   = modCombined.map(function(img) { return lwUpFromBand(img, 'LST_Day_1km',   'QC_Day'); });
var nightLwUp = modCombined.map(function(img) { return lwUpFromBand(img, 'LST_Night_1km', 'QC_Night'); });

// ─── v2.1.1 land-surface-temperature balance fix ─────────────────────
var lwUpDayMean = dayLwUp.mean();
var lwUpNightMean = nightLwUp.mean();
var lwUpAnnualWperM2 = lwUpDayMean.add(lwUpNightMean).divide(2);
// ────────────────────────────────────────────────────────────────────

var lwUpAnnualJ = lwUpAnnualWperM2.multiply(SECONDS_PER_YEAR);

var netLongwaveJ = lwDownAnnualJ.subtract(lwUpAnnualJ);

// ── 4. Total net radiation ───────────────────────────────────────────
var netRnAnnualJ = netShortwaveJ.add(netLongwaveJ);
var netRnSafe = netRnAnnualJ.where(netRnAnnualJ.lte(0), 0.001);

// ── 5. Heat Regulation Capacity ──────────────────────────────────────
var hrc_ratio_unclipped = latentHeatAnnualJ.divide(netRnSafe);
var hrc = hrc_ratio_unclipped.min(1).max(0).multiply(10).rename('hrc_score');
var hrc_raw_ratio = hrc_ratio_unclipped.multiply(10).rename('hrc_raw_ratio');

print('Heat Regulation Capacity range (Tapajós — expect mean ~6.5–7.5 post-fix):',
  hrc.reduceRegion({
    reducer: ee.Reducer.minMax().combine(ee.Reducer.mean(), '', true),
    geometry: BBOX, scale: 500, maxPixels: 1e9
  })
);

// ── 5b. K67 acceptance-gate read (single pixel diagnostic) ───────────
print('Heat Regulation Capacity at K67 (matched-methodology target 7.65; predicted ~5.66):',
  hrc.reduceRegion({
    reducer: ee.Reducer.first(),
    geometry: ee.Geometry.Point([-54.959, -2.857]),
    scale:    500,
    maxPixels: 1e9
  })
);

print('Raw unclipped Heat Regulation Capacity ratio at K67 (sanity check):',
  hrc_raw_ratio.reduceRegion({
    reducer: ee.Reducer.first(),
    geometry: ee.Geometry.Point([-54.959, -2.857]),
    scale:    500,
    maxPixels: 1e9
  })
);

// ── 6. Sample to grid points at 500m for export ──────────────────────
// MODIFIED v2.1.2: latentHeatFluxAnnualWm2 added to the output bands.
var outputImage = hrc
  .addBands(hrc_raw_ratio)
  .addBands(latentHeatFluxAnnualWm2);  // NEW v2.1.2

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
    lst_source:          'mixed_Terra_Aqua_day_night_equal_weight',
    methodology_version: 'v2.1.2_higher_fidelity'  // bumped from v2.1.1
  });
});

print('Sample point count (Tapajós — expect ~30,000-40,000):', samplePoints.size());

// ── 7. Map preview ───────────────────────────────────────────────────
Map.addLayer(hrc,
  { min: 0, max: 10, palette: ['8B2500','D4550A','F4A623','C8D84A','1D9E75'] },
  'Heat Regulation Capacity v2.1.2 (Tapajós, 500m)'
);

// Optional cooling-work magnitude visualisation.
Map.addLayer(latentHeatFluxAnnualWm2,
  { min: 0, max: 130, palette: ['ffffff','c8e0ec','7fb3d5','2874a6','1b4f72'] },
  'Latent heat flux W/m² v2.1.2 (Tapajós, 500m)',
  false
);

// Mark K67 flux tower for visual sanity check
Map.addLayer(
  ee.Geometry.Point([-54.959, -2.857]),
  { color: 'red' },
  'K67 tower (Heat Regulation Capacity gate 7.65 ± 2.0; cooling-work gate 88–100 W/m²)'
);

// ── 8. Export ────────────────────────────────────────────────────────
// MODIFIED v2.1.2: latent_heat_flux_annual_wm2 added to selectors list.
Export.table.toDrive({
  collection:     samplePoints,
  description:    'hrc_v2_1_tapajos_tiles',
  folder:         'EarthHRC',
  fileNamePrefix: 'hrc_v2_1_tapajos_tiles_v2_1_2',
  fileFormat:     'CSV',
  selectors: [
    'longitude', 'latitude',
    'hrc_score', 'hrc_raw_ratio',
    'latent_heat_flux_annual_wm2',   // NEW v2.1.2
    'ecoregion_id', 'ecoregion_name', 'biome_name',
    'region_code', 'data_source', 'data_resolution_m',
    'source_window', 'lst_source', 'methodology_version'
  ]
});

print('Export task queued. Go to Tasks panel and click RUN.');
print('Filename prefix on Drive: hrc_v2_1_tapajos_tiles_v2_1_2.csv');
