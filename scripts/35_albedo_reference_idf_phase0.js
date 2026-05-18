// =====================================================================
// 35_albedo_reference_idf_phase0.js — Albedo modifier Phase 0
// Île-de-France per-ecoregion intact albedo reference (Path A: centroid)
//
// Phase 0 of HRC_albedo_modifier_claude_code_handoff_v1_1.md.
// Diagnostic only — does NOT touch production tiles or schema.
//
// METHODOLOGY (per handoff §3 and §4):
//
//   1. Filter WDPA: IUCN Ia–VI, STATUS = 'Designated' (matches the HRC
//      reference convention from script 33).
//   2. Convert each PA polygon to its centroid.
//   3. Apply per-centroid trust-the-data filter (handoff §4.1):
//        - reject MCD12Q1 LC_Type1 class 17 (Water Bodies)
//        - reject class 13 (Urban / Built-Up)
//        - reject class 12 (Cropland)
//        - reject class 14 (Cropland / Natural Vegetation Mosaic)
//        - reject if 500-m buffer mean of (class 11 OR class 17) > 0.25
//   4. Sample MCD43A3 Albedo_BSA_shortwave (×0.001) at each surviving
//      centroid for the same time window as v2.1.2 (calendar year 2023).
//   5. Per ecoregion: compute p25/p50/p75 of surviving centroid albedos.
//      The albedo reference is the p50 (median intact-typical), NOT
//      the p90 used for HRC. See handoff §3 for why.
//   6. Apply per-ecoregion trust gate (handoff §4.2):
//        - surviving N >= 20
//        - IQR of surviving albedos < 0.10
//        - PA coverage of ecoregion >= 5 %
//        - biome is not cryosphere (BIOME_NUM != 11; deferred to Phase 2)
//      If any gate fails, albedo_modifier_status = 'disabled' with a
//      populated albedo_modifier_disabled_reason. The Phase 1 pipeline
//      will then fall back to v2.1.2-equivalent (10 × EF) for that
//      ecoregion. No silent disables.
//
// SENSOR PROVENANCE (handoff §8):
//   The MCD43A3 collection ID is recorded in albedo_data_source so a
//   future MODIS Terra → VIIRS transition can be detected by inspecting
//   this column rather than diagnosing apparent reference shifts.
//
// v1.1 EXTENSION (handoff §7.5 — `reference_p90_v2_2`):
//   Each kept centroid is also sampled for v2.1.1 HRC. The per-centroid
//   audit CSV gains `hrc_v2_1_1` and `ecoregion_id` columns so the
//   Python analysis can compute per-ecoregion p90 of v2.2 scores
//   (using each centroid's hrc_v2_1_1 + pixel_albedo + the ecoregion's
//   albedo_ref_p50) and compare against the existing v2.1.1 reference
//   (6.47 for European Atlantic mixed forests, per script 33).
//
// OUTPUTS: two CSVs
//   - hrc_albedo_reference_idf_phase0.csv         (per-ecoregion reference)
//   - hrc_albedo_centroid_audit_idf_phase0.csv    (per-centroid audit;
//                                                  v1.1 columns: hrc_v2_1_1,
//                                                  ecoregion_id)
// =====================================================================

// ── Region & time window ─────────────────────────────────────────────
var REGION_NAME    = 'idf';
var BBOX           = ee.Geometry.Rectangle([2.4, 48.3, 3.2, 48.7]);
var YEAR_START     = '2023-01-01';
var YEAR_END       = '2024-01-01';
var SOURCE_WINDOW  = '2023-01-01/2024-01-01';
var ALBEDO_SOURCE  = 'MODIS/061/MCD43A3';
var LANDCOVER_YEAR = '2023-01-01';  // MCD12Q1 image for trust filter

// Trust-the-data thresholds (handoff §4)
var MIN_CENTROIDS         = 20;
var MAX_REFERENCE_IQR     = 0.10;
var MIN_PA_COVERAGE_FRAC  = 0.05;
var WETLAND_BUFFER_RADIUS = 500;     // metres
var WETLAND_BUFFER_MAX    = 0.25;    // mean fraction

Map.centerObject(BBOX, 9);

// ── 1. Build the annual MCD43A3 broadband albedo image ──────────────
// Same masking convention as the v2.1.2 tile pipeline (script 31): keep
// only mandatory-quality = 0. Scale 0.001.
var albedoAnnual = ee.ImageCollection(ALBEDO_SOURCE)
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

print('Annual MCD43A3 broadband albedo over IDF (mean expected ~0.13–0.18):',
  albedoAnnual.reduceRegion({
    reducer: ee.Reducer.minMax().combine(ee.Reducer.mean(), '', true),
    geometry: BBOX, scale: 500, maxPixels: 1e9
  })
);

// ── 1b. v2.1.1 HRC image (for reference_p90_v2_2 per handoff §7.5) ──
// Reuses the radiation balance from script 33 verbatim so per-centroid
// HRC values are identical to what the existing v2.1.1 reference
// computation produces. Same time window as the albedo image above.
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
var hrcImage     = latentHeatAnnualJ.divide(netRnSafe).min(1).max(0)
                     .multiply(10).rename('hrc_v2_1_1').toFloat();

// ── 2. Land-cover image for trust filter ─────────────────────────────
// MCD12Q1 is annual; pick the 2023 image to match the analysis window.
var landcover = ee.ImageCollection('MODIS/061/MCD12Q1')
  .filterDate(LANDCOVER_YEAR, '2024-01-01')
  .first()
  .select('LC_Type1')
  .clip(BBOX);

// Wetland-or-water mask used for the 500-m buffer test (handoff §4.1).
var wetlandOrWater = landcover.eq(11).or(landcover.eq(17)).rename('wet');

// ── 3. RESOLVE ecoregions (loaded early so centroid sampling can tag) ──
var resolve = ee.FeatureCollection('RESOLVE/ECOREGIONS/2017').filterBounds(BBOX);

print('Ecoregion count in IDF box:', resolve.size());

// ── 3b. WDPA filter — IUCN I–VI, Designated ──────────────────────────
// EXPANDED from I–IV per handoff v1.1 §3 ("expanded to V, VI for biomes
// where strict coverage is insufficient"). France has very sparse strict
// protection — IUCN I–IV alone produces 40 surviving centroids covering
// only ~0.93 % of the IDF bbox's forest ecoregion, failing the 5 %
// PA-coverage trust gate. Including the Parcs Naturels Régionaux
// (typically Cat V) pushes coverage well above the threshold while the
// per-centroid trust filter still rejects centroids on cropland / urban
// / water. Matches the Tapajós (script 36) and LA / SF Bay (v2.0)
// convention. v1.1 Phase 0 finding.
//
// MARINE filter dropped (process guide §6.2: field is empty in current ingest).
var wdpaIDF = ee.FeatureCollection('WCMC/WDPA/current/polygons')
  .filterBounds(BBOX)
  .filter(ee.Filter.inList('IUCN_CAT', ['Ia', 'Ib', 'II', 'III', 'IV', 'V', 'VI']))
  .filter(ee.Filter.eq('STATUS', 'Designated'));

print('WDPA IUCN I–VI designated PA count in IDF box (was 66 at I–IV; expect larger):', wdpaIDF.size());

// ── 4. Sample albedo + HRC + land cover at each centroid ─────────────
// Each feature gets:
//   - albedo at centroid (MCD43A3 annual)
//   - hrc_v2_1_1 at centroid (NEW v1.1; for reference_p90_v2_2 calc)
//   - LC_Type1 at centroid
//   - wetland_buffer_frac for the 500-m circle around the centroid
//   - ecoregion_id from RESOLVE intersect (NEW v1.1; for per-ecoregion
//                                          aggregation in Python)
var centroidsRaw = wdpaIDF.map(function(pa) {
  var centroid = pa.geometry().centroid(ee.ErrorMargin(100));
  var buffer   = centroid.buffer(WETLAND_BUFFER_RADIUS);

  var albedoVal = albedoAnnual.reduceRegion({
    reducer:  ee.Reducer.first(),
    geometry: centroid,
    scale:    500,
    maxPixels: 1e4
  }).get('albedo');

  var hrcVal = hrcImage.reduceRegion({
    reducer:  ee.Reducer.first(),
    geometry: centroid,
    scale:    500,
    maxPixels: 1e4
  }).get('hrc_v2_1_1');

  var lcVal = landcover.reduceRegion({
    reducer:  ee.Reducer.first(),
    geometry: centroid,
    scale:    500,
    maxPixels: 1e4
  }).get('LC_Type1');

  var wetlandFrac = wetlandOrWater.reduceRegion({
    reducer:  ee.Reducer.mean(),
    geometry: buffer,
    scale:    500,
    maxPixels: 1e4
  }).get('wet');

  var eco = resolve.filterBounds(centroid).first();

  return ee.Feature(centroid, {
    pa_name:             pa.get('NAME'),
    iucn_cat:            pa.get('IUCN_CAT'),
    albedo:              albedoVal,
    hrc_v2_1_1:          hrcVal,
    lc_type1:            lcVal,
    wetland_buffer_frac: wetlandFrac,
    ecoregion_id:        ee.Algorithms.If(eco, eco.get('ECO_ID'),     null),
    ecoregion_name:      ee.Algorithms.If(eco, eco.get('ECO_NAME'),   null)
  });
});

// ── 5. Apply the per-centroid trust filter ───────────────────────────
// Reject if albedo missing OR LC class is rejected OR wetland buffer
// exceeds threshold. Rejected reason is recorded for diagnostics.
var REJECT_LC_CLASSES = [12, 13, 14, 17];

var centroidsTagged = centroidsRaw.map(function(f) {
  var albedo  = f.get('albedo');
  var lc      = ee.Number(ee.Algorithms.If(f.get('lc_type1'), f.get('lc_type1'), -1));
  var wetFrac = ee.Number(ee.Algorithms.If(f.get('wetland_buffer_frac'),
                                            f.get('wetland_buffer_frac'), 0));

  var albedoMissing = ee.Algorithms.IsEqual(albedo, null);
  var lcRejected    = ee.List(REJECT_LC_CLASSES).contains(lc);
  var wetRejected   = wetFrac.gt(WETLAND_BUFFER_MAX);

  var keep = ee.Algorithms.If(albedoMissing, false,
              ee.Algorithms.If(lcRejected,    false,
               ee.Algorithms.If(wetRejected,  false, true)));

  var reason = ee.Algorithms.If(albedoMissing, 'no_albedo',
                ee.Algorithms.If(lcRejected,   'lc_class_rejected',
                 ee.Algorithms.If(wetRejected, 'wetland_buffer_exceeds', 'kept')));

  return f.set({ keep: keep, reject_reason: reason });
});

var centroidsKept = centroidsTagged.filter(ee.Filter.eq('keep', true));

print('Centroid summary (IDF):',
  ee.Dictionary({
    raw_count:        wdpaIDF.size(),
    tagged_count:     centroidsTagged.size(),
    kept_count:       centroidsKept.size(),
    rejected_no_albedo:           centroidsTagged.filter(ee.Filter.eq('reject_reason','no_albedo')).size(),
    rejected_lc_class_rejected:   centroidsTagged.filter(ee.Filter.eq('reject_reason','lc_class_rejected')).size(),
    rejected_wetland_buffer:      centroidsTagged.filter(ee.Filter.eq('reject_reason','wetland_buffer_exceeds')).size()
  })
);

// ── 6. (RESOLVE loaded earlier at step 3) ────────────────────────────

// ── 7. Per-ecoregion albedo reference + trust gate ───────────────────
// For each ecoregion in the bbox:
//   - count surviving centroids inside it
//   - compute p25/p50/p75 of their albedos
//   - compute PA coverage fraction of the ecoregion
//   - apply the four-part trust gate
//   - emit albedo_modifier_status + albedo_modifier_disabled_reason
var results = resolve.map(function(eco) {
  var ecoGeom    = eco.geometry();
  // PA-coverage gate compares LOCAL PAs against LOCAL ecoregion area
  // (the bbox slice), not against the full continent-spanning RESOLVE
  // ecoregion. European Atlantic mixed forests is 385,000 km² across
  // Atlantic Europe; without this clip, a Phase 0 run against a small
  // bbox like IDF makes pa_coverage_frac trivially zero even when the
  // bbox itself is well-protected. This is the v1.1 Phase 0 finding
  // that disabled every ecoregion in the first run.
  var ecoGeomLocal = ecoGeom.intersection(BBOX, ee.ErrorMargin(50));
  var ecoArea_m2   = ecoGeomLocal.area(10);

  // Centroids inside this ecoregion (after the per-centroid trust filter).
  var samplesInEco = centroidsKept.filterBounds(ecoGeom);
  var n = samplesInEco.size();

  // Stats only computed if N is large enough — guards against
  // EE percentile() returning nulls on tiny samples.
  var hasMin = n.gte(MIN_CENTROIDS);

  var stats = ee.Algorithms.If(
    hasMin,
    samplesInEco.reduceColumns({
      reducer:   ee.Reducer.percentile([25, 50, 75]),
      selectors: ['albedo']
    }),
    ee.Dictionary({ p25: null, p50: null, p75: null })
  );
  stats = ee.Dictionary(stats);

  var p25 = stats.get('p25');
  var p50 = stats.get('p50');
  var p75 = stats.get('p75');

  // IQR is null when stats are null; coerce to a large sentinel so the
  // gate logic can compare numerically.
  var iqr = ee.Algorithms.If(
    ee.Algorithms.IsEqual(p25, null), 999,
    ee.Number(p75).subtract(ee.Number(p25))
  );
  iqr = ee.Number(iqr);

  // PA coverage: PA area within the bbox slice of the ecoregion,
  // divided by the bbox slice's ecoregion area. Matches the centroid
  // sampling (which is bbox-filtered) for a like-for-like coverage
  // measure.
  var paInEco = wdpaIDF.filterBounds(ecoGeomLocal).map(function(pa) {
    return ee.Feature(pa.geometry().intersection(ecoGeomLocal, ee.ErrorMargin(50)));
  });
  var paArea_m2 = paInEco.geometry().dissolve(ee.ErrorMargin(50)).area(10);
  var paCoverage = ee.Number(paArea_m2).divide(ecoArea_m2);

  // Cryosphere biome flag (Phase 2 deferral). RESOLVE BIOME_NUM = 11 is
  // Tundra. None expected in IDF/Tapajós, but the gate is wired.
  var biomeNum = ee.Number(eco.get('BIOME_NUM'));
  var isCryosphere = biomeNum.eq(11);

  // Four-part trust gate (handoff §4.2). Order matters only for the
  // disabled_reason string.
  var gateInsufficient = n.lt(MIN_CENTROIDS);
  var gateNoisy        = iqr.gte(MAX_REFERENCE_IQR);
  var gateLowPA        = paCoverage.lt(MIN_PA_COVERAGE_FRAC);

  var status = ee.Algorithms.If(gateInsufficient,                'disabled',
                ee.Algorithms.If(gateNoisy,                       'disabled',
                 ee.Algorithms.If(gateLowPA,                      'disabled',
                  ee.Algorithms.If(isCryosphere,                  'disabled', 'enabled'))));

  var reason = ee.Algorithms.If(gateInsufficient, 'insufficient_samples',
                ee.Algorithms.If(gateNoisy,        'reference_iqr_exceeds',
                 ee.Algorithms.If(gateLowPA,       'low_pa_coverage',
                  ee.Algorithms.If(isCryosphere,   'cryosphere_biome_phase2_deferred',
                                                   null))));

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

    albedo_data_source:               ALBEDO_SOURCE,
    source_window:                    SOURCE_WINDOW
  });
});

print('Per-ecoregion albedo reference results (IDF):', results);

// ── 8. Map preview ───────────────────────────────────────────────────
Map.addLayer(albedoAnnual,
  { min: 0.05, max: 0.30, palette: ['1d4f72','7fb3d5','c8e0ec','ffd5a0','c87b3a'] },
  'MCD43A3 broadband albedo (IDF, 2023)'
);
Map.addLayer(wdpaIDF, { color: '2E7D32' }, 'WDPA I–VI Designated');
Map.addLayer(centroidsTagged.filter(ee.Filter.eq('keep', false)),
  { color: 'red' }, 'Centroids — rejected');
Map.addLayer(centroidsKept,
  { color: 'green' }, 'Centroids — kept');

// ── 9. Export ────────────────────────────────────────────────────────
Export.table.toDrive({
  collection:     results,
  description:    'hrc_albedo_reference_idf_phase0',
  folder:         'EarthHRC',
  fileNamePrefix: 'hrc_albedo_reference_idf_phase0',
  fileFormat:     'CSV',
  selectors: [
    'region_code',
    'ecoregion_id', 'ecoregion_name', 'biome_num', 'biome_name',
    'albedo_ref_p25', 'albedo_ref_p50', 'albedo_ref_p75', 'albedo_ref_iqr',
    'centroid_count_kept', 'pa_coverage_frac',
    'ecoregion_area_km2_local', 'ecoregion_area_km2_full',
    'albedo_modifier_status', 'albedo_modifier_disabled_reason',
    'albedo_data_source', 'source_window'
  ]
});

// Companion export: the per-centroid trust-filter audit trail. Useful
// for Phase 0 review — lets you see exactly which centroids dropped
// out and why, without re-running the script.
Export.table.toDrive({
  collection:     centroidsTagged,
  description:    'hrc_albedo_centroid_audit_idf_phase0',
  folder:         'EarthHRC',
  fileNamePrefix: 'hrc_albedo_centroid_audit_idf_phase0',
  fileFormat:     'CSV',
  selectors: [
    'pa_name', 'iucn_cat',
    'albedo', 'hrc_v2_1_1',
    'lc_type1', 'wetland_buffer_frac',
    'ecoregion_id', 'ecoregion_name',
    'keep', 'reject_reason'
  ]
});

print('Two export tasks queued. Go to Tasks panel and click RUN on both.');
print('Filenames on Drive: hrc_albedo_reference_idf_phase0.csv,');
print('                    hrc_albedo_centroid_audit_idf_phase0.csv');
