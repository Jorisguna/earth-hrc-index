// =====================================================================
// 36_albedo_reference_tapajos_phase0.js — Albedo modifier Phase 0
// Tapajós per-ecoregion intact albedo reference (Path A: centroid)
//
// Sister script to 35_albedo_reference_idf_phase0.js. Identical
// methodology, swapped for the Tapajós bbox and an expanded IUCN
// category list — see "IUCN category choice" note below.
//
// Phase 0 of HRC_albedo_modifier_claude_code_handoff_v1_1.md.
// Diagnostic only — does NOT touch production tiles or schema.
//
// IUCN CATEGORY CHOICE — diverges from the existing Tapajós HRC
// reference (script 34, which uses Hansen image masking):
//
//   The Tapajós bbox is dominated by very large protected areas
//   (Tapajós National Forest itself, Sustainable Use Reserves, etc.),
//   most of which are IUCN Cat VI (Sustainable-Use). Restricting to
//   I–IV would yield few or zero centroids in this bbox. Per the
//   handoff §3 ("expanded to V, VI for biomes where strict coverage
//   is insufficient") and matching the LA / SF Bay convention from
//   v2.0, this script uses IUCN I–VI.
//
//   The trust-the-data gate (§4.2) still fires if N < 20 or IQR ≥ 0.10
//   or PA-coverage < 5 %, so a permissive IUCN list cannot weaken the
//   reference quality — it only gives the gate more samples to judge.
//
// OUTPUT: per-ecoregion CSV → hrc_albedo_reference_tapajos_phase0
// =====================================================================

// ── Region & time window ─────────────────────────────────────────────
var REGION_NAME    = 'tapajos';
var BBOX           = ee.Geometry.Rectangle([-55.4, -3.3, -54.5, -2.4]);
var YEAR_START     = '2023-01-01';
var YEAR_END       = '2024-01-01';
var SOURCE_WINDOW  = '2023-01-01/2024-01-01';
var ALBEDO_SOURCE  = 'MODIS/061/MCD43A3';
var LANDCOVER_YEAR = '2023-01-01';

var IUCN_CAT_LIST = ['Ia', 'Ib', 'II', 'III', 'IV', 'V', 'VI'];

// Trust-the-data thresholds (handoff §4)
var MIN_CENTROIDS         = 20;
var MAX_REFERENCE_IQR     = 0.10;
var MIN_PA_COVERAGE_FRAC  = 0.05;
var WETLAND_BUFFER_RADIUS = 500;
var WETLAND_BUFFER_MAX    = 0.25;

Map.centerObject(BBOX, 9);

// ── 1. Annual MCD43A3 broadband albedo image ────────────────────────
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

print('Annual MCD43A3 broadband albedo over Tapajós (intact rainforest expected ~0.13):',
  albedoAnnual.reduceRegion({
    reducer: ee.Reducer.minMax().combine(ee.Reducer.mean(), '', true),
    geometry: BBOX, scale: 500, maxPixels: 1e9
  })
);

// ── 1b. v2.1.1 HRC image (for reference_p90_v2_2 per handoff §7.5) ──
// Reuses the radiation balance from script 33/34 verbatim so per-centroid
// HRC values are identical to what the existing v2.1.1 reference
// computation produces.
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
var landcover = ee.ImageCollection('MODIS/061/MCD12Q1')
  .filterDate(LANDCOVER_YEAR, '2024-01-01')
  .first()
  .select('LC_Type1')
  .clip(BBOX);

var wetlandOrWater = landcover.eq(11).or(landcover.eq(17)).rename('wet');

// ── 3. RESOLVE ecoregions (loaded early so centroid sampling can tag) ──
var resolve = ee.FeatureCollection('RESOLVE/ECOREGIONS/2017').filterBounds(BBOX);

print('Ecoregion count in Tapajós box:', resolve.size());

// ── 3b. WDPA filter — IUCN I–VI, Designated ──────────────────────────
var wdpaTAP = ee.FeatureCollection('WCMC/WDPA/current/polygons')
  .filterBounds(BBOX)
  .filter(ee.Filter.inList('IUCN_CAT', IUCN_CAT_LIST))
  .filter(ee.Filter.eq('STATUS', 'Designated'));

print('WDPA IUCN I–VI designated PA count in Tapajós box:', wdpaTAP.size());

// ── 4. Sample albedo + HRC + land cover at each centroid ─────────────
var centroidsRaw = wdpaTAP.map(function(pa) {
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

// ── 5. Per-centroid trust filter ────────────────────────────────────
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

print('Centroid summary (Tapajós):',
  ee.Dictionary({
    raw_count:        wdpaTAP.size(),
    tagged_count:     centroidsTagged.size(),
    kept_count:       centroidsKept.size(),
    rejected_no_albedo:           centroidsTagged.filter(ee.Filter.eq('reject_reason','no_albedo')).size(),
    rejected_lc_class_rejected:   centroidsTagged.filter(ee.Filter.eq('reject_reason','lc_class_rejected')).size(),
    rejected_wetland_buffer:      centroidsTagged.filter(ee.Filter.eq('reject_reason','wetland_buffer_exceeds')).size()
  })
);

// ── 6. (RESOLVE loaded earlier at step 3) ────────────────────────────

// ── 7. Per-ecoregion albedo reference + trust gate ──────────────────
var results = resolve.map(function(eco) {
  var ecoGeom    = eco.geometry();
  // PA-coverage gate compares LOCAL PAs against the LOCAL bbox slice
  // of the ecoregion. Madeira-Tapajós moist forests alone is 720,000 km²;
  // dividing local PA area by full-ecoregion area trivially yields zero
  // coverage. v1.1 Phase 0 finding — same as script 35.
  var ecoGeomLocal = ecoGeom.intersection(BBOX, ee.ErrorMargin(50));
  var ecoArea_m2   = ecoGeomLocal.area(10);

  var samplesInEco = centroidsKept.filterBounds(ecoGeomLocal);
  var n = samplesInEco.size();
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

  var iqr = ee.Algorithms.If(
    ee.Algorithms.IsEqual(p25, null), 999,
    ee.Number(p75).subtract(ee.Number(p25))
  );
  iqr = ee.Number(iqr);

  // PA coverage: PA area within the bbox slice / bbox slice ecoregion
  // area — like-for-like with the centroid sampling.
  var paInEco = wdpaTAP.filterBounds(ecoGeomLocal).map(function(pa) {
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

print('Per-ecoregion albedo reference results (Tapajós):', results);

// ── 8. Map preview ───────────────────────────────────────────────────
Map.addLayer(albedoAnnual,
  { min: 0.05, max: 0.30, palette: ['1d4f72','7fb3d5','c8e0ec','ffd5a0','c87b3a'] },
  'MCD43A3 broadband albedo (Tapajós, 2023)'
);
Map.addLayer(wdpaTAP, { color: '2E7D32' }, 'WDPA I–VI Designated');
Map.addLayer(centroidsTagged.filter(ee.Filter.eq('keep', false)),
  { color: 'red' }, 'Centroids — rejected');
Map.addLayer(centroidsKept,
  { color: 'green' }, 'Centroids — kept');

// ── 9. Export ────────────────────────────────────────────────────────
Export.table.toDrive({
  collection:     results,
  description:    'hrc_albedo_reference_tapajos_phase0',
  folder:         'EarthHRC',
  fileNamePrefix: 'hrc_albedo_reference_tapajos_phase0',
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

Export.table.toDrive({
  collection:     centroidsTagged,
  description:    'hrc_albedo_centroid_audit_tapajos_phase0',
  folder:         'EarthHRC',
  fileNamePrefix: 'hrc_albedo_centroid_audit_tapajos_phase0',
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
print('Filenames on Drive: hrc_albedo_reference_tapajos_phase0.csv,');
print('                    hrc_albedo_centroid_audit_tapajos_phase0.csv');
