// =====================================================================
// 38_albedo_reference_idf_v2_2.js — IDF v2.2 ecoregion albedo reference
//
// Phase 1 production version of script 35 (Phase 0 diagnostic).
// Produces the per-ecoregion albedo reference table that the v2.2 tile
// pipeline (script 31_..._v2_2) joins against to compute per-tile
// albedo_deficit_norm, albedo_modifier_status, and hrc_score_v2_2.
//
// HANDOFF:    docs/HRC_albedo_modifier_claude_code_handoff_v1_2.md §7.2.
// MIGRATION:  scripts/migrations/008_albedo_modifier_v2_2.sql.
// SMOKE TEST: scripts/albedo_modifier_phase0_smoke_test.py (gates at w=0.20).
//
// METHODOLOGY (handoff §3, §4):
//
//   1. Filter WDPA: IUCN Ia–VI, STATUS = 'Designated'.
//   2. Convert each PA polygon to its centroid.
//   3. Per-centroid trust filter (handoff §4.1):
//        - reject MCD12Q1 LC_Type1 class 12 (Cropland)
//        - reject class 13 (Urban / Built-Up)
//        - reject class 14 (Cropland / Natural Vegetation Mosaic)
//        - reject class 17 (Water Bodies)
//        - reject if 500-m buffer mean of (class 11 OR class 17) > 0.25
//   4. Sample MCD43A3 Albedo_BSA_shortwave (×0.001) at each surviving
//      centroid; calendar year 2023 matches the v2.1.2 tile window.
//   5. Per-ecoregion: p25 / p50 / p75 of surviving centroid albedos.
//      albedo_ref_p50 = the median (handoff §3 — typical-intact reference,
//      not aspirational p90).
//   6. Per-ecoregion trust gate (handoff §4.2):
//        - surviving N >= 20
//        - IQR of surviving albedos < 0.10
//        - PA coverage of ecoregion (bbox-local) >= 5%
//        - biome is not cryosphere (BIOME_NUM != 11; Phase 2 deferral)
//      If any gate fails: status='disabled' with a populated reason.
//
//   7. (v2.2 production extension over Phase 0) Compute the v2.2 score
//      at every kept centroid using its measured EF and its ecoregion's
//      albedo_ref_p50, then take the p90 of those centroid v2.2 scores
//      → reference_p90_v2_2. The Phase 0 script left this to Python;
//      production computes it in GEE for direct import.
//
// PRODUCTION WEIGHT: w = 0.20 (project owner decision 2026-05-18).
//   Sweep at w ∈ {0.10, 0.15, 0.20} is left in the Phase 0 outputs.
//   The reference table is single-weight by design — re-running this
//   script with a different W constant is the only supported way to
//   change the production weight, alongside migration 008's documented
//   value in hrc_score_v2_2's column comment.
//
// OUTPUTS (Google Drive folder 'EarthHRC'):
//   - hrc_albedo_reference_idf_v2_2.csv         (per-ecoregion, for import)
//   - hrc_albedo_centroid_audit_idf_v2_2.csv    (per-centroid audit trail)
// =====================================================================

// ── Region & time window ─────────────────────────────────────────────
var REGION_NAME    = 'idf';
var BBOX           = ee.Geometry.Rectangle([2.4, 48.3, 3.2, 48.7]);
var YEAR_START     = '2023-01-01';
var YEAR_END       = '2024-01-01';
var SOURCE_WINDOW  = '2023-01-01/2024-01-01';
var ALBEDO_SOURCE  = 'MCD43A3_061';
var LANDCOVER_YEAR = '2023-01-01';

// Trust-the-data thresholds (handoff §4)
var MIN_CENTROIDS         = 20;
var MAX_REFERENCE_IQR     = 0.10;
var MIN_PA_COVERAGE_FRAC  = 0.05;
var WETLAND_BUFFER_RADIUS = 500;
var WETLAND_BUFFER_MAX    = 0.25;

// v2.2.1 patch — a 1 km buffer cropland/urban check that complements
// the existing point-sample LC_Type1 filter. The point sample alone
// misses centroids that land inside a Parc Naturel Régional polygon
// whose geometric centre happens to sit in a tilled field while the
// 500 m MCD12Q1 pixel reports a mixed/forest class. Buffer mean of
// cropland (12), urban (13), and cropland-mosaic (14) > 0.25 rejects
// the centroid. Water (17) is already covered by the wetland buffer.
var CROPLAND_BUFFER_RADIUS = 1000;
var CROPLAND_BUFFER_MAX    = 0.25;

// v2.2 production weight (project owner decision, handoff §7.2 / §11).
var W = 0.20;

Map.centerObject(BBOX, 9);

// ── 1. Annual MCD43A3 broadband albedo image ────────────────────────
var albedoAnnual = ee.ImageCollection('MODIS/061/MCD43A3')
  .filterDate(YEAR_START, YEAR_END)
  .filterBounds(BBOX)
  .map(function(img) {
    var qa = img.select('BRDF_Albedo_Band_Mandatory_Quality_shortwave');
    return img.select('Albedo_BSA_shortwave')
              .multiply(0.001)
              .updateMask(qa.eq(0));
  })
  .mean()
  .clip(BBOX)
  .rename('albedo');

// ── 1b. Radiation pipeline (matches script 33 / 35 exactly) ─────────
// Per-centroid HRC is needed to compute reference_p90_v2_2 in GEE.
var SECONDS_PER_YEAR = 31536000;
var SIGMA = 5.67e-8;

var latentHeatAnnualJ = ee.ImageCollection('CAS/IGSNRR/PML/V2_v018')
  .filterDate(YEAR_START, YEAR_END)
  .filterBounds(BBOX)
  .map(function(img) {
    return img.select(['Ec', 'Es', 'Ei'])
              .reduce(ee.Reducer.sum())
              .multiply(8)
              .multiply(2.45e6);
  })
  .sum().clip(BBOX);

var swDownAnnualJ = ee.ImageCollection('ECMWF/ERA5_LAND/MONTHLY_AGGR')
  .filterDate(YEAR_START, YEAR_END)
  .select('surface_solar_radiation_downwards_sum')
  .sum().clip(BBOX);

var netShortwaveJ = swDownAnnualJ.multiply(ee.Image(1).subtract(albedoAnnual));

var lwDownAnnualJ = ee.ImageCollection('ECMWF/ERA5_LAND/MONTHLY_AGGR')
  .filterDate(YEAR_START, YEAR_END)
  .select('surface_thermal_radiation_downwards_sum')
  .sum().clip(BBOX);

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
var lwUpAnnualJ = dayLwUp.mean().add(nightLwUp.mean()).divide(2).multiply(SECONDS_PER_YEAR);
var netLongwaveJ = lwDownAnnualJ.subtract(lwUpAnnualJ);

var netRnAnnualJ = netShortwaveJ.add(netLongwaveJ);
var netRnSafe    = netRnAnnualJ.where(netRnAnnualJ.lte(0), 0.001);
var efImage      = latentHeatAnnualJ.divide(netRnSafe).min(1).max(0).rename('ef').toFloat();
var hrcV211Image = efImage.multiply(10).rename('hrc_v2_1_1').toFloat();

// ── 2. Land-cover image for trust filter ────────────────────────────
var landcover = ee.ImageCollection('MODIS/061/MCD12Q1')
  .filterDate(LANDCOVER_YEAR, '2024-01-01')
  .first()
  .select('LC_Type1')
  .clip(BBOX);

var wetlandOrWater   = landcover.eq(11).or(landcover.eq(17)).rename('wet');
// v2.2.1 — neighbourhood cropland/urban mask for the 1 km buffer check.
var croplandOrUrban  = landcover.eq(12).or(landcover.eq(13)).or(landcover.eq(14)).rename('cul');

// ── 3. RESOLVE ecoregions in the bbox ────────────────────────────────
var resolve = ee.FeatureCollection('RESOLVE/ECOREGIONS/2017').filterBounds(BBOX);

// ── 3b. WDPA filter — IUCN I–VI, Designated ──────────────────────────
// I–VI scope is the Phase 0 finding (handoff v1.1 §3): I–IV alone gave
// only ~0.93% PA coverage in IDF and failed the 5% gate. Including
// Parcs Naturels Régionaux (Cat V) lifts coverage above threshold;
// the per-centroid trust filter still rejects cropland / urban / water
// centroids regardless of IUCN category.
var wdpaIDF = ee.FeatureCollection('WCMC/WDPA/current/polygons')
  .filterBounds(BBOX)
  .filter(ee.Filter.inList('IUCN_CAT', ['Ia', 'Ib', 'II', 'III', 'IV', 'V', 'VI']))
  .filter(ee.Filter.eq('STATUS', 'Designated'));

// ── 4. Sample albedo + EF + LC at each centroid ──────────────────────
var centroidsRaw = wdpaIDF.map(function(pa) {
  var centroid    = pa.geometry().centroid(ee.ErrorMargin(100));
  var wetBuffer   = centroid.buffer(WETLAND_BUFFER_RADIUS);
  var cropBuffer  = centroid.buffer(CROPLAND_BUFFER_RADIUS);

  var albedoVal = albedoAnnual.reduceRegion({
    reducer:  ee.Reducer.first(), geometry: centroid,
    scale:    500, maxPixels: 1e4
  }).get('albedo');

  var efVal = efImage.reduceRegion({
    reducer:  ee.Reducer.first(), geometry: centroid,
    scale:    500, maxPixels: 1e4
  }).get('ef');

  var hrcVal = hrcV211Image.reduceRegion({
    reducer:  ee.Reducer.first(), geometry: centroid,
    scale:    500, maxPixels: 1e4
  }).get('hrc_v2_1_1');

  var lcVal = landcover.reduceRegion({
    reducer:  ee.Reducer.first(), geometry: centroid,
    scale:    500, maxPixels: 1e4
  }).get('LC_Type1');

  var wetlandFrac = wetlandOrWater.reduceRegion({
    reducer:  ee.Reducer.mean(), geometry: wetBuffer,
    scale:    500, maxPixels: 1e4
  }).get('wet');

  var croplandFrac = croplandOrUrban.reduceRegion({
    reducer:  ee.Reducer.mean(), geometry: cropBuffer,
    scale:    500, maxPixels: 1e4
  }).get('cul');

  var eco = resolve.filterBounds(centroid).first();
  // Expose coordinates as numeric columns so the audit CSV can be loaded
  // into the web UI as a Deck.gl point layer without re-parsing GeoJSON.
  var coords = centroid.coordinates();

  return ee.Feature(centroid, {
    longitude:            ee.Number(coords.get(0)),
    latitude:             ee.Number(coords.get(1)),
    pa_name:              pa.get('NAME'),
    iucn_cat:             pa.get('IUCN_CAT'),
    albedo:               albedoVal,
    ef:                   efVal,
    hrc_v2_1_1:           hrcVal,
    lc_type1:             lcVal,
    wetland_buffer_frac:  wetlandFrac,
    cropland_buffer_frac: croplandFrac,
    ecoregion_id:         ee.Algorithms.If(eco, eco.get('ECO_ID'),   null),
    ecoregion_name:       ee.Algorithms.If(eco, eco.get('ECO_NAME'), null)
  });
});

// ── 5. Per-centroid trust filter ─────────────────────────────────────
var REJECT_LC_CLASSES = [12, 13, 14, 17];

var centroidsTagged = centroidsRaw.map(function(f) {
  var albedo   = f.get('albedo');
  var ef       = f.get('ef');
  var lc       = ee.Number(ee.Algorithms.If(f.get('lc_type1'), f.get('lc_type1'), -1));
  var wetFrac  = ee.Number(ee.Algorithms.If(f.get('wetland_buffer_frac'),
                                             f.get('wetland_buffer_frac'), 0));
  var cropFrac = ee.Number(ee.Algorithms.If(f.get('cropland_buffer_frac'),
                                             f.get('cropland_buffer_frac'), 0));

  var albedoMissing = ee.Algorithms.IsEqual(albedo, null);
  var efMissing     = ee.Algorithms.IsEqual(ef, null);
  var lcRejected    = ee.List(REJECT_LC_CLASSES).contains(lc);
  var wetRejected   = wetFrac.gt(WETLAND_BUFFER_MAX);
  // v2.2.1 — neighbourhood cropland/urban fraction in a 1 km buffer.
  // Catches PNR centroids that sit in a tilled field while the 500 m
  // MCD12Q1 pixel at the centroid reports a mixed/forest class.
  var cropRejected  = cropFrac.gt(CROPLAND_BUFFER_MAX);

  var keep = ee.Algorithms.If(albedoMissing, false,
              ee.Algorithms.If(efMissing,        false,
               ee.Algorithms.If(lcRejected,      false,
                ee.Algorithms.If(cropRejected,   false,
                 ee.Algorithms.If(wetRejected,   false, true)))));

  var reason = ee.Algorithms.If(albedoMissing, 'no_albedo',
                ee.Algorithms.If(efMissing,        'no_ef',
                 ee.Algorithms.If(lcRejected,      'lc_class_rejected',
                  ee.Algorithms.If(cropRejected,   'cropland_buffer_exceeds',
                   ee.Algorithms.If(wetRejected,   'wetland_buffer_exceeds', 'kept')))));

  return f.set({ keep: keep, reject_reason: reason });
});

var centroidsKept = centroidsTagged.filter(ee.Filter.eq('keep', true));

print('IDF centroid summary:',
  ee.Dictionary({
    raw_count:    wdpaIDF.size(),
    kept_count:   centroidsKept.size()
  })
);

// ── 6. Per-ecoregion reference + trust gate + reference_p90_v2_2 ─────
var results = resolve.map(function(eco) {
  var ecoGeom      = eco.geometry();
  var ecoGeomLocal = ecoGeom.intersection(BBOX, ee.ErrorMargin(50));
  var ecoArea_m2   = ecoGeomLocal.area(10);

  var samplesInEco = centroidsKept.filterBounds(ecoGeom);
  var n = samplesInEco.size();
  var hasMin = n.gte(MIN_CENTROIDS);

  // p25 / p50 / p75 of albedo
  var albedoStats = ee.Algorithms.If(
    hasMin,
    samplesInEco.reduceColumns({
      reducer:   ee.Reducer.percentile([25, 50, 75]),
      selectors: ['albedo']
    }),
    ee.Dictionary({ p25: null, p50: null, p75: null })
  );
  albedoStats = ee.Dictionary(albedoStats);

  var p25 = albedoStats.get('p25');
  var p50 = albedoStats.get('p50');
  var p75 = albedoStats.get('p75');

  var iqr = ee.Algorithms.If(
    ee.Algorithms.IsEqual(p25, null), 999,
    ee.Number(p75).subtract(ee.Number(p25))
  );
  iqr = ee.Number(iqr);

  // PA coverage on the bbox-local ecoregion polygon
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

  var status = ee.Algorithms.If(gateInsufficient,                'disabled',
                ee.Algorithms.If(gateNoisy,                       'disabled',
                 ee.Algorithms.If(gateLowPA,                      'disabled',
                  ee.Algorithms.If(isCryosphere,                  'disabled', 'enabled'))));

  var reason = ee.Algorithms.If(gateInsufficient, 'insufficient_samples',
                ee.Algorithms.If(gateNoisy,        'noisy_reference',
                 ee.Algorithms.If(gateLowPA,       'low_pa_coverage',
                  ee.Algorithms.If(isCryosphere,   'cryosphere_biome_phase2_deferred',
                                                   null))));

  // reference_p90_v2_2 — p90 of per-centroid v2.2 scores in this ecoregion.
  // Computed only for enabled ecoregions; null otherwise. The v2.2 score
  // per centroid is 10 × EF × (1 − W × clip(max(albedo − p50, 0)/p50, 0, 1)).
  var p50Num = ee.Number(ee.Algorithms.If(
    ee.Algorithms.IsEqual(p50, null), 0.001, p50));

  var scored = samplesInEco.map(function(f) {
    var a = ee.Number(f.get('albedo'));
    var ef = ee.Number(f.get('ef'));
    var deficitRaw = a.subtract(p50Num).divide(p50Num);
    var deficitNorm = deficitRaw.max(0).min(1);
    var v22 = ef.multiply(10).multiply(ee.Number(1).subtract(deficitNorm.multiply(W)));
    return f.set({ hrc_v2_2: v22, albedo_deficit_norm: deficitNorm });
  });

  var refP90V22 = ee.Algorithms.If(
    ee.String(status).compareTo('enabled').eq(0),
    scored.reduceColumns({
      reducer:   ee.Reducer.percentile([90]),
      selectors: ['hrc_v2_2']
    }).get('p90'),
    null
  );

  return ee.Feature(null, {
    region_code:                      REGION_NAME,
    ecoregion_id:                     eco.get('ECO_ID'),
    ecoregion_name:                   eco.get('ECO_NAME'),
    biome_num:                        biomeNum,
    biome_name:                       eco.get('BIOME_NAME'),

    albedo_ref_p25:                   p25,
    albedo_ref_p50:                   p50,
    albedo_ref_p75:                   p75,
    albedo_ref_iqr:                   iqr,

    centroid_count_kept:              n,
    pa_coverage_frac:                 paCoverage,
    ecoregion_area_km2_local:         ecoArea_m2.divide(1e6),
    ecoregion_area_km2_full:          ecoGeom.area(10).divide(1e6),

    albedo_modifier_status:           status,
    albedo_modifier_disabled_reason:  reason,
    reference_p90_v2_2:               refP90V22,
    albedo_modifier_weight:           W,

    albedo_data_source:               ALBEDO_SOURCE,
    source_window:                    SOURCE_WINDOW
  });
});

print('Per-ecoregion v2.2 reference (IDF):', results);

// ── 7. Map preview ───────────────────────────────────────────────────
Map.addLayer(albedoAnnual,
  { min: 0.05, max: 0.30, palette: ['1d4f72','7fb3d5','c8e0ec','ffd5a0','c87b3a'] },
  'MCD43A3 broadband albedo (IDF, 2023)'
);
Map.addLayer(wdpaIDF, { color: '2E7D32' }, 'WDPA I–VI Designated');
Map.addLayer(centroidsTagged.filter(ee.Filter.eq('keep', false)),
  { color: 'red' }, 'Centroids — rejected');
Map.addLayer(centroidsKept,
  { color: 'green' }, 'Centroids — kept');

// ── 8. Exports ───────────────────────────────────────────────────────
Export.table.toDrive({
  collection:     results,
  description:    'hrc_albedo_reference_idf_v2_2',
  folder:         'EarthHRC',
  fileNamePrefix: 'hrc_albedo_reference_idf_v2_2',
  fileFormat:     'CSV',
  selectors: [
    'region_code',
    'ecoregion_id', 'ecoregion_name', 'biome_num', 'biome_name',
    'albedo_ref_p25', 'albedo_ref_p50', 'albedo_ref_p75', 'albedo_ref_iqr',
    'centroid_count_kept', 'pa_coverage_frac',
    'ecoregion_area_km2_local', 'ecoregion_area_km2_full',
    'albedo_modifier_status', 'albedo_modifier_disabled_reason',
    'reference_p90_v2_2', 'albedo_modifier_weight',
    'albedo_data_source', 'source_window'
  ]
});

Export.table.toDrive({
  collection:     centroidsTagged,
  description:    'hrc_albedo_centroid_audit_idf_v2_2',
  folder:         'EarthHRC',
  fileNamePrefix: 'hrc_albedo_centroid_audit_idf_v2_2',
  fileFormat:     'CSV',
  selectors: [
    'longitude', 'latitude',
    'pa_name', 'iucn_cat',
    'albedo', 'ef', 'hrc_v2_1_1',
    'lc_type1', 'wetland_buffer_frac', 'cropland_buffer_frac',
    'ecoregion_id', 'ecoregion_name',
    'keep', 'reject_reason'
  ]
});

print('Two export tasks queued. RUN both in the Tasks panel.');
print('Filenames on Drive: hrc_albedo_reference_idf_v2_2.csv,');
print('                    hrc_albedo_centroid_audit_idf_v2_2.csv');
