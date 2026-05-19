// =====================================================================
// 31_hrc_v2_1_idf_tiles_v2_2.js — v2.2 higher-fidelity Île-de-France
//
// v2.2 (May 2026) — Albedo modifier production deployment.
//   Promotes the existing Tier B Albedo_deficit term into Tier A as an
//   ecoregion-relative ecosystem-health modifier, gated by a per-ecoregion
//   trust-the-data check (handoff §3, §4). Carries forward every v2.1.2
//   field (hrc_score, hrc_raw_ratio, latent_heat_flux_annual_wm2) and
//   adds eight new columns (per migration 008).
//
// HANDOFF:    docs/HRC_albedo_modifier_claude_code_handoff_v1_2.md §7.2.
// MIGRATION:  scripts/migrations/008_albedo_modifier_v2_2.sql.
// REFERENCE:  scripts/38_albedo_reference_idf_v2_2.js (same logic inlined
//             here so the tile job is self-contained — no manual asset
//             upload of reference CSV is required).
// PRODUCTION WEIGHT: w = 0.20 (project owner decision 2026-05-18).
//
// FORMULA (handoff §2):
//   EF                  = clip(latent_heat / net_radiation, 0, 1)
//   deficit_raw         = pixel_albedo − albedo_ref_p50
//   albedo_deficit_norm = clip(max(deficit_raw, 0) / albedo_ref_p50, 0, 1)
//   hrc_score_v2_2_enabled  = 10 × EF × (1 − W × albedo_deficit_norm)
//   hrc_score_v2_2_disabled = 10 × EF       (identical to v2.1.1)
//
// DISABLE RULE (handoff §4.2):
//   The modifier is disabled per-ecoregion if any of:
//     - centroid count < 20 after trust filter
//     - IQR of surviving centroid albedos >= 0.10
//     - PA coverage of bbox-local ecoregion < 5%
//     - biome is cryosphere (BIOME_NUM == 11; Phase 2 deferral)
//   Disabled tiles emit albedo_modifier_status='disabled' with a populated
//   albedo_modifier_disabled_reason. No silent disables.
//
// OUTPUT (matches migration 008 columns + v2.1.2 carry-forward):
//   longitude, latitude,
//   hrc_score, hrc_raw_ratio, latent_heat_flux_annual_wm2,    (v2.1.2 carry-forward)
//   pixel_albedo, albedo_ref_p50, albedo_deficit_norm,        (NEW v2.2)
//   albedo_modifier_status, albedo_modifier_disabled_reason,  (NEW v2.2)
//   hrc_score_v2_2, albedo_data_source, reference_p90_v2_2,   (NEW v2.2)
//   ecoregion_id, ecoregion_name, biome_name,
//   region_code, data_source, data_resolution_m,
//   source_window, lst_source, methodology_version
// =====================================================================

// ── Region & time window ─────────────────────────────────────────────
var REGION_NAME    = 'idf';
var BBOX           = ee.Geometry.Rectangle([2.4, 48.3, 3.2, 48.7]);
var YEAR_START     = '2023-01-01';
var YEAR_END       = '2024-01-01';
var SOURCE_WINDOW  = '2023-01-01/2024-01-01';
var ALBEDO_SOURCE  = 'MCD43A3_061';
var LANDCOVER_YEAR = '2023-01-01';

// v2.2 production weight (handoff §11)
var W = 0.20;

// Trust-the-data thresholds (handoff §4)
var MIN_CENTROIDS         = 20;
var MAX_REFERENCE_IQR     = 0.10;
var MIN_PA_COVERAGE_FRAC  = 0.05;
var WETLAND_BUFFER_RADIUS = 500;
var WETLAND_BUFFER_MAX    = 0.25;
// v2.2.1 — 1 km cropland/urban buffer (mirrors script 38)
var CROPLAND_BUFFER_RADIUS = 1000;
var CROPLAND_BUFFER_MAX    = 0.25;

Map.centerObject(BBOX, 9);

// ─────────────────────────────────────────────────────────────────────
// PART A — v2.1.2 carry-forward (latent heat, radiation, HRC ratio).
// Identical to script 31_..._v2_1_2.js; do not change without a paired
// update there.
// ─────────────────────────────────────────────────────────────────────

var pmlET = ee.ImageCollection('CAS/IGSNRR/PML/V2_v018')
  .filterDate(YEAR_START, YEAR_END)
  .filterBounds(BBOX);

var latentHeatAnnualJ = pmlET.map(function(img) {
  var et_mm_total = img.select(['Ec', 'Es', 'Ei'])
    .reduce(ee.Reducer.sum())
    .multiply(8);
  return et_mm_total.multiply(2.45e6);
}).sum().clip(BBOX);

var SECONDS_PER_YEAR = 31536000;
var latentHeatFluxAnnualWm2 = latentHeatAnnualJ
  .divide(SECONDS_PER_YEAR)
  .rename('latent_heat_flux_annual_wm2');

var swDownAnnualJ = ee.ImageCollection('ECMWF/ERA5_LAND/MONTHLY_AGGR')
  .filterDate(YEAR_START, YEAR_END)
  .select('surface_solar_radiation_downwards_sum')
  .sum().clip(BBOX);

var albedoAnnual = ee.ImageCollection('MODIS/061/MCD43A3')
  .filterDate(YEAR_START, YEAR_END)
  .filterBounds(BBOX)
  .map(function(img) {
    var qa = img.select('BRDF_Albedo_Band_Mandatory_Quality_shortwave');
    return img.select('Albedo_BSA_shortwave').multiply(0.001)
              .updateMask(qa.eq(0));
  })
  .mean().clip(BBOX).rename('albedo');

var netShortwaveJ = swDownAnnualJ.multiply(ee.Image(1).subtract(albedoAnnual));

var lwDownAnnualJ = ee.ImageCollection('ECMWF/ERA5_LAND/MONTHLY_AGGR')
  .filterDate(YEAR_START, YEAR_END)
  .select('surface_thermal_radiation_downwards_sum')
  .sum().clip(BBOX);

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
var lwUpAnnualWperM2 = dayLwUp.mean().add(nightLwUp.mean()).divide(2);
var lwUpAnnualJ = lwUpAnnualWperM2.multiply(SECONDS_PER_YEAR);
var netLongwaveJ = lwDownAnnualJ.subtract(lwUpAnnualJ);

var netRnAnnualJ = netShortwaveJ.add(netLongwaveJ);
var netRnSafe    = netRnAnnualJ.where(netRnAnnualJ.lte(0), 0.001);

var ef_unclipped = latentHeatAnnualJ.divide(netRnSafe);
var ef = ef_unclipped.min(1).max(0).rename('ef');
var hrc = ef.multiply(10).rename('hrc_score');
var hrc_raw_ratio = ef_unclipped.multiply(10).rename('hrc_raw_ratio');

// ─────────────────────────────────────────────────────────────────────
// PART B — Per-ecoregion v2.2 albedo reference (inline; same logic as
// script 38). Produces an ee.Dictionary keyed by ecoregion id string,
// each value being a sub-dictionary with the per-ecoregion fields
// (albedo_ref_p50, status, disabled_reason, reference_p90_v2_2).
// ─────────────────────────────────────────────────────────────────────

var landcover = ee.ImageCollection('MODIS/061/MCD12Q1')
  .filterDate(LANDCOVER_YEAR, '2024-01-01')
  .first()
  .select('LC_Type1')
  .clip(BBOX);
var wetlandOrWater  = landcover.eq(11).or(landcover.eq(17)).rename('wet');
var croplandOrUrban = landcover.eq(12).or(landcover.eq(13)).or(landcover.eq(14)).rename('cul');

var resolve = ee.FeatureCollection('RESOLVE/ECOREGIONS/2017').filterBounds(BBOX);

var wdpaIDF = ee.FeatureCollection('WCMC/WDPA/current/polygons')
  .filterBounds(BBOX)
  .filter(ee.Filter.inList('IUCN_CAT', ['Ia', 'Ib', 'II', 'III', 'IV', 'V', 'VI']))
  .filter(ee.Filter.eq('STATUS', 'Designated'));

var REJECT_LC_CLASSES = [12, 13, 14, 17];

var centroidsRaw = wdpaIDF.map(function(pa) {
  var centroid   = pa.geometry().centroid(ee.ErrorMargin(100));
  var wetBuffer  = centroid.buffer(WETLAND_BUFFER_RADIUS);
  var cropBuffer = centroid.buffer(CROPLAND_BUFFER_RADIUS);

  var albedoVal = albedoAnnual.reduceRegion({
    reducer: ee.Reducer.first(), geometry: centroid, scale: 500, maxPixels: 1e4
  }).get('albedo');
  var efVal = ef.reduceRegion({
    reducer: ee.Reducer.first(), geometry: centroid, scale: 500, maxPixels: 1e4
  }).get('ef');
  var lcVal = landcover.reduceRegion({
    reducer: ee.Reducer.first(), geometry: centroid, scale: 500, maxPixels: 1e4
  }).get('LC_Type1');
  var wetlandFrac = wetlandOrWater.reduceRegion({
    reducer: ee.Reducer.mean(), geometry: wetBuffer, scale: 500, maxPixels: 1e4
  }).get('wet');
  var croplandFrac = croplandOrUrban.reduceRegion({
    reducer: ee.Reducer.mean(), geometry: cropBuffer, scale: 500, maxPixels: 1e4
  }).get('cul');

  var eco = resolve.filterBounds(centroid).first();
  return ee.Feature(centroid, {
    pa_name:              pa.get('NAME'),
    iucn_cat:             pa.get('IUCN_CAT'),
    albedo:               albedoVal,
    ef:                   efVal,
    lc_type1:             lcVal,
    wetland_buffer_frac:  wetlandFrac,
    cropland_buffer_frac: croplandFrac,
    ecoregion_id:         ee.Algorithms.If(eco, eco.get('ECO_ID'),   null),
    ecoregion_name:       ee.Algorithms.If(eco, eco.get('ECO_NAME'), null)
  });
});

var centroidsKept = centroidsRaw.map(function(f) {
  var albedoVal = f.get('albedo');
  var efVal     = f.get('ef');
  var lc       = ee.Number(ee.Algorithms.If(f.get('lc_type1'), f.get('lc_type1'), -1));
  var wetFrac  = ee.Number(ee.Algorithms.If(f.get('wetland_buffer_frac'),
                                             f.get('wetland_buffer_frac'), 0));
  var cropFrac = ee.Number(ee.Algorithms.If(f.get('cropland_buffer_frac'),
                                             f.get('cropland_buffer_frac'), 0));
  var albedoMissing = ee.Algorithms.IsEqual(albedoVal, null);
  var efMissing     = ee.Algorithms.IsEqual(efVal, null);
  var lcRejected    = ee.List(REJECT_LC_CLASSES).contains(lc);
  var wetRejected   = wetFrac.gt(WETLAND_BUFFER_MAX);
  var cropRejected  = cropFrac.gt(CROPLAND_BUFFER_MAX);
  var keep = ee.Algorithms.If(albedoMissing, false,
              ee.Algorithms.If(efMissing,        false,
               ee.Algorithms.If(lcRejected,      false,
                ee.Algorithms.If(cropRejected,   false,
                 ee.Algorithms.If(wetRejected,   false, true)))));
  return f.set({ keep: keep });
}).filter(ee.Filter.eq('keep', true));

// Per-ecoregion: p50 albedo + trust gate + reference_p90_v2_2.
var ecoRef = resolve.map(function(eco) {
  var ecoGeom      = eco.geometry();
  var ecoGeomLocal = ecoGeom.intersection(BBOX, ee.ErrorMargin(50));
  var ecoArea_m2   = ecoGeomLocal.area(10);

  var samplesInEco = centroidsKept.filterBounds(ecoGeom);
  var n = samplesInEco.size();
  var hasMin = n.gte(MIN_CENTROIDS);

  var stats = ee.Dictionary(ee.Algorithms.If(
    hasMin,
    samplesInEco.reduceColumns({
      reducer:   ee.Reducer.percentile([25, 50, 75]),
      selectors: ['albedo']
    }),
    ee.Dictionary({ p25: null, p50: null, p75: null })
  ));
  var p25 = stats.get('p25');
  var p50 = stats.get('p50');
  var p75 = stats.get('p75');

  var iqr = ee.Number(ee.Algorithms.If(
    ee.Algorithms.IsEqual(p25, null), 999,
    ee.Number(p75).subtract(ee.Number(p25))
  ));

  var paInEco = wdpaIDF.filterBounds(ecoGeomLocal).map(function(pa) {
    return ee.Feature(pa.geometry().intersection(ecoGeomLocal, ee.ErrorMargin(50)));
  });
  var paArea_m2 = paInEco.geometry().dissolve(ee.ErrorMargin(50)).area(10);
  var paCoverage = ee.Number(paArea_m2).divide(ecoArea_m2);

  var biomeNum = ee.Number(eco.get('BIOME_NUM'));
  var isCryosphere = biomeNum.eq(11);

  var gateInsufficient = n.lt(MIN_CENTROIDS);
  var gateNoisy        = iqr.gte(MAX_REFERENCE_IQR);
  var gateLowPA        = paCoverage.lt(MIN_PA_COVERAGE_FRAC);

  var status = ee.Algorithms.If(gateInsufficient, 'disabled',
                ee.Algorithms.If(gateNoisy,        'disabled',
                 ee.Algorithms.If(gateLowPA,       'disabled',
                  ee.Algorithms.If(isCryosphere,   'disabled', 'enabled'))));
  var reason = ee.Algorithms.If(gateInsufficient, 'insufficient_samples',
                ee.Algorithms.If(gateNoisy,        'noisy_reference',
                 ee.Algorithms.If(gateLowPA,       'low_pa_coverage',
                  ee.Algorithms.If(isCryosphere,   'cryosphere_biome_phase2_deferred',
                                                   null))));

  // reference_p90_v2_2 — p90 of per-centroid v2.2 scores (enabled only).
  var p50Safe = ee.Number(ee.Algorithms.If(
    ee.Algorithms.IsEqual(p50, null), 0.001, p50));
  var scored = samplesInEco.map(function(f) {
    var a = ee.Number(f.get('albedo'));
    var efC = ee.Number(f.get('ef'));
    var dnorm = a.subtract(p50Safe).divide(p50Safe).max(0).min(1);
    var v22 = efC.multiply(10).multiply(ee.Number(1).subtract(dnorm.multiply(W)));
    return f.set({ hrc_v2_2: v22 });
  });
  var refP90V22 = ee.Algorithms.If(
    ee.String(status).compareTo('enabled').eq(0),
    scored.reduceColumns({
      reducer: ee.Reducer.percentile([90]), selectors: ['hrc_v2_2']
    }).get('p90'),
    null
  );

  return ee.Feature(null, {
    ecoregion_id:                     eco.get('ECO_ID'),
    albedo_ref_p50:                   p50,
    albedo_modifier_status:           status,
    albedo_modifier_disabled_reason:  reason,
    reference_p90_v2_2:               refP90V22
  });
});

print('Per-ecoregion v2.2 reference (IDF, inline):', ecoRef);

// ─────────────────────────────────────────────────────────────────────
// PART C — Sample per-tile and join with the per-ecoregion reference,
// then compute albedo_deficit_norm and hrc_score_v2_2.
// ─────────────────────────────────────────────────────────────────────

// Stack tile-level bands. pixel_albedo joins as a band; the ecoregion
// reference values are joined per-feature after sampling.
var outputImage = hrc
  .addBands(hrc_raw_ratio)
  .addBands(latentHeatFluxAnnualWm2)
  .addBands(ef)
  .addBands(albedoAnnual.rename('pixel_albedo'));

var ecoregions = ee.FeatureCollection('RESOLVE/ECOREGIONS/2017').filterBounds(BBOX);

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
    longitude:     ee.Number(coords.get(0)),
    latitude:      ee.Number(coords.get(1)),
    ecoregion_id:  ee.Algorithms.If(eco, eco.get('ECO_ID'),     null),
    ecoregion_name:ee.Algorithms.If(eco, eco.get('ECO_NAME'),   null),
    biome_name:    ee.Algorithms.If(eco, eco.get('BIOME_NAME'), null)
  });
});

// Server-side join: each tile gets its ecoregion's reference attached.
// ee.Filter.equals on ecoregion_id pairs tiles to ecoRef rows; saveFirst
// attaches the matched ecoRef Feature under the property 'ref'.
var joined = ee.Join.saveFirst({matchKey: 'ref'}).apply({
  primary:   samplePoints,
  secondary: ecoRef,
  condition: ee.Filter.equals({leftField: 'ecoregion_id', rightField: 'ecoregion_id'})
});

// Compute albedo_deficit_norm and hrc_score_v2_2 per tile, taking
// the disabled-fallback when the ecoregion's modifier is off.
var withV22 = joined.map(function(f) {
  var ref = ee.Feature(f.get('ref'));
  var status = ref.get('albedo_modifier_status');
  var reason = ref.get('albedo_modifier_disabled_reason');
  var p50    = ref.get('albedo_ref_p50');
  var refP90 = ref.get('reference_p90_v2_2');

  // Raw getters — values may be null if the tile is outside any ecoregion
  // or if the source bands had no valid value at the sample point.
  var pa      = f.get('pixel_albedo');
  var efVal   = ee.Number(f.get('ef'));
  var hrcV211 = ee.Number(f.get('hrc_score'));

  // Default to disabled-style values; overwrite if enabled.
  var statusStr = ee.String(ee.Algorithms.If(status, status, 'disabled'));
  var enabled   = statusStr.compareTo('enabled').eq(0);

  // ee.Algorithms.IsEqual returns a ComputedObject (no .not() method).
  // Convert each null-check into an ee.Number 0/1 so .and() chains work.
  // canCompute = enabled AND pa not null AND p50 not null.
  var paOk  = ee.Number(ee.Algorithms.If(ee.Algorithms.IsEqual(pa,  null), 0, 1));
  var p50Ok = ee.Number(ee.Algorithms.If(ee.Algorithms.IsEqual(p50, null), 0, 1));
  var canCompute = enabled.and(paOk).and(p50Ok);

  // Safe numerics: when either input is null we substitute placeholders
  // that make the arithmetic legal (dnormSafe → 0, v22Enabled → 10×EF).
  // The final value is gated by canCompute, so the placeholders never
  // leak into output rows.
  var paSafe  = ee.Number(ee.Algorithms.If(ee.Algorithms.IsEqual(pa,  null), 0,     pa));
  var p50Safe = ee.Number(ee.Algorithms.If(ee.Algorithms.IsEqual(p50, null), 0.001, p50));
  var dnormSafe = paSafe.subtract(p50Safe).divide(p50Safe).max(0).min(1);

  var dnorm = ee.Algorithms.If(canCompute, dnormSafe, null);

  // hrc_score_v2_2 = enabled? 10×EF×(1−W×dnorm) : 10×EF (== v2.1.1).
  var v22Enabled = efVal.multiply(10)
                        .multiply(ee.Number(1).subtract(dnormSafe.multiply(W)));
  var v22 = ee.Algorithms.If(canCompute, v22Enabled, hrcV211);

  // When disabled, drop reference_p90_v2_2 so the import never
  // back-fills the column for a disabled tile.
  var refP90Out = ee.Algorithms.If(enabled, refP90, null);

  return f.set({
    pixel_albedo:                     pa,
    albedo_ref_p50:                   p50,
    albedo_deficit_norm:              dnorm,
    albedo_modifier_status:           statusStr,
    albedo_modifier_disabled_reason:  reason,
    hrc_score_v2_2:                   v22,
    albedo_data_source:               ALBEDO_SOURCE,
    reference_p90_v2_2:               refP90Out,

    region_code:                      REGION_NAME,
    data_source:                      'PML_V2_500m',
    data_resolution_m:                500,
    source_window:                    SOURCE_WINDOW,
    lst_source:                       'mixed_Terra_Aqua_day_night_equal_weight',
    methodology_version:              'v2.2_higher_fidelity'
  });
});

print('Sample point count (IDF — expect ~10,000):', withV22.size());

// Read-1 acceptance gate: FR-Fon tower pixel v2.2 score vs v2.1.1.
// Hard gate from handoff §7.3: within 0.5. Phase 0 measured |Δ|=0.04 at
// w=0.15 with measured deficit 0.05; at w=0.20 the projected drift is
// ~0.057 — still well inside the 0.5 production gate.
var frFon = ee.Geometry.Point([2.780, 48.476]);
print('FR-Fon tower v2.2 readout (gate: |v2.2 − v2.1.1| ≤ 0.5):',
  withV22.filterBounds(frFon).limit(1).first()
);

// ── Map preview ──────────────────────────────────────────────────────
var v22Image = outputImage.select('hrc_score').rename('hrc_score_v2_2');
Map.addLayer(hrc,
  { min: 0, max: 10, palette: ['8B2500','D4550A','F4A623','C8D84A','1D9E75'] },
  'HRC v2.1.1 (IDF, 500m)'
);
Map.addLayer(albedoAnnual,
  { min: 0.05, max: 0.30, palette: ['1d4f72','7fb3d5','c8e0ec','ffd5a0','c87b3a'] },
  'MCD43A3 pixel albedo (IDF, 2023)',
  false
);
Map.addLayer(frFon, { color: 'red' }, 'FR-Fon tower (v2.2 hard gate)');

// ── Export ───────────────────────────────────────────────────────────
Export.table.toDrive({
  collection:     withV22,
  description:    'hrc_v2_2_idf_tiles',
  folder:         'EarthHRC',
  fileNamePrefix: 'hrc_v2_2_idf_tiles',
  fileFormat:     'CSV',
  selectors: [
    'longitude', 'latitude',
    'hrc_score', 'hrc_raw_ratio', 'latent_heat_flux_annual_wm2',
    'pixel_albedo', 'albedo_ref_p50', 'albedo_deficit_norm',
    'albedo_modifier_status', 'albedo_modifier_disabled_reason',
    'hrc_score_v2_2', 'albedo_data_source', 'reference_p90_v2_2',
    'ecoregion_id', 'ecoregion_name', 'biome_name',
    'region_code', 'data_source', 'data_resolution_m',
    'source_window', 'lst_source', 'methodology_version'
  ]
});

print('Export task queued. RUN in Tasks panel.');
print('Filename on Drive: hrc_v2_2_idf_tiles.csv');
