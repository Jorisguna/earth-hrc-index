// =====================================================================
// 34_hrc_v2_1_tapajos_reference.js — v2.1 higher-fidelity showcase
// Tapajós intact site reference (Path B: Hansen image masking)
//
// METHODOLOGY (per docs HRC_higher_fidelity_methodology_v2_1.md §6):
//
// PATH B — applicable where dominant protected areas are larger than
// ~10 km² (so centroid sampling becomes unrepresentative) and where
// "intact tropical forest" has a more direct definition than "inside
// a protected area" — namely, "uncleared and unlogged primary forest."
// The Hansen Global Forest Change dataset measures this directly.
//
// METHOD:
//   1. Recompute the v2.1 HRC at 500m for the Tapajós box
//   2. Build an intact mask from Hansen:
//        treecover2000 ≥ 80 AND lossyear == 0 AND datamask == 1
//   3. Sample HRC at every intact pixel at 500m
//   4. Per ecoregion: p90 of intact-pixel HRC values
//
// CRITICAL TRAP (per process guide §6.1):
//   - .unmask(0) is REQUIRED on each Hansen input before .and().
//     Hansen v1.10+ applies a humid-tropical-forest mask to lossyear
//     that propagates through boolean ops. Without unmask(0), the
//     entire intact mask returns zero pixels.
//
// THRESHOLDS:
//   ≥ 5,000 intact pixels per ecoregion → high confidence
//   2,000-4,999  → moderate
//     500-1,999  → low
//   <   500      → insufficient (Path C fallback to K67 reference 7.89)
//
// FALLBACK TO PATH C: handled in the Python import script. This script
// just outputs raw counts and percentiles where adequate.
//
// OUTPUT: per-ecoregion reference rows
// =====================================================================

// ── Region & time window ─────────────────────────────────────────────
var BBOX = ee.Geometry.Rectangle([-55.4, -3.3, -54.5, -2.4]);
var YEAR_START = '2023-01-01';
var YEAR_END   = '2024-01-01';

Map.centerObject(BBOX, 9);

// ── Step 1: Compute v2.1 HRC at 500m (same pipeline as script 32) ────

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

var albedoAnnual = ee.ImageCollection('MODIS/061/MCD43A3')
  .filterDate(YEAR_START, YEAR_END)
  .filterBounds(BBOX)
  .map(function(img) {
    var qa = img.select('BRDF_Albedo_Band_Mandatory_Quality_shortwave');
    return img.select('Albedo_BSA_shortwave').multiply(0.001).updateMask(qa.eq(0));
  }).mean().clip(BBOX);

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
  // .rename() to a common band name so day + night merge homogeneously.
  return lst_K.pow(4).multiply(emis).multiply(SIGMA).rename('lw_up_W');
}

var modCombined = ee.ImageCollection('MODIS/061/MOD11A1')
  .merge(ee.ImageCollection('MODIS/061/MYD11A1'))
  .filterDate(YEAR_START, YEAR_END)
  .filterBounds(BBOX);

var dayLwUp   = modCombined.map(function(img) { return lwUpFromBand(img, 'LST_Day_1km',   'QC_Day'); });
var nightLwUp = modCombined.map(function(img) { return lwUpFromBand(img, 'LST_Night_1km', 'QC_Night'); });

// v2.1.1 FIX: equal-weight day/night aggregation.
// Pre-fix dayLwUp.merge(nightLwUp).mean() was day-weighted by the QC
// pass-rate ratio, inflating LW_up and HRC. See methodology paper §4.7
// and process guide §6.5.
var lwUpDayMean   = dayLwUp.mean();
var lwUpNightMean = nightLwUp.mean();
var lwUpAnnualJ   = lwUpDayMean.add(lwUpNightMean).divide(2).multiply(31536000);
var netLongwaveJ = lwDownAnnualJ.subtract(lwUpAnnualJ);

var netRnAnnualJ = netShortwaveJ.add(netLongwaveJ);
var netRnSafe = netRnAnnualJ.where(netRnAnnualJ.lte(0), 0.001);

var hrcImage = latentHeatAnnualJ.divide(netRnSafe).min(1).max(0)
                 .multiply(10).rename('hrc_score').toFloat();

// ── Step 2: Build Hansen intact mask ────────────────────────────────
// CRITICAL: .unmask(0) on each input BEFORE the boolean .and().
// Hansen v1.10+ applies a humid-tropical-forest mask to `lossyear` that
// propagates through boolean operations and silently zeros the result.
var hansen = ee.Image('UMD/hansen/global_forest_change_2024_v1_12');
var canopy2000 = hansen.select('treecover2000').unmask(0);
var lossYear   = hansen.select('lossyear').unmask(0);
var datamask   = hansen.select('datamask').unmask(0);

var intactMask = canopy2000.gte(80)
                   .and(lossYear.eq(0))
                   .and(datamask.eq(1))
                   .rename('intact');

// Sanity-check the intact mask isn't empty (the unmask(0) trap signature)
print('Intact-pixel area in Tapajós box (km²) — expect ~4,500:',
  intactMask.multiply(ee.Image.pixelArea().divide(1e6))
            .reduceRegion({
              reducer: ee.Reducer.sum(),
              geometry: BBOX,
              scale: 500,
              maxPixels: 1e9
            })
);

// ── Step 3: Mask HRC to intact pixels ────────────────────────────────
var intactHRC = hrcImage.updateMask(intactMask);

// ── Step 4: Load RESOLVE ecoregions ──────────────────────────────────
var resolve = ee.FeatureCollection('RESOLVE/ECOREGIONS/2017')
  .filterBounds(BBOX);

print('Ecoregion count in Tapajós box:', resolve.size());

// ── Step 5: Per-ecoregion p90 of intact-pixel HRC values ────────────
var results = resolve.map(function(eco) {
  var ecoGeom = eco.geometry();
  var ecoIntact = intactHRC.clip(ecoGeom);

  // Count of intact (non-masked) pixels
  var pixelCount = ecoIntact.reduceRegion({
    reducer:   ee.Reducer.count(),
    geometry:  ecoGeom,
    scale:     500,
    maxPixels: 1e9,
    tileScale: 4
  }).get('hrc_score');
  pixelCount = ee.Number(pixelCount);

  var hasEnough = pixelCount.gte(500);

  var stats = ee.Algorithms.If(
    hasEnough,
    ecoIntact.reduceRegion({
      reducer:   ee.Reducer.percentile([75, 90, 95]),
      geometry:  ecoGeom,
      scale:     500,
      maxPixels: 1e9,
      tileScale: 4
    }),
    ee.Dictionary({
      hrc_score_p75: null,
      hrc_score_p90: null,
      hrc_score_p95: null
    })
  );
  stats = ee.Dictionary(stats);

  var confidence = ee.Algorithms.If(
    pixelCount.gte(5000), 'high',
    ee.Algorithms.If(
      pixelCount.gte(2000), 'moderate',
      ee.Algorithms.If(
        pixelCount.gte(500), 'low',
        'insufficient'
      )
    )
  );

  return ee.Feature(null, {
    ecoregion_id:         eco.get('ECO_ID'),
    ecoregion_name:       eco.get('ECO_NAME'),
    biome_name:           eco.get('BIOME_NAME'),
    hrc_reference_p75:    stats.get('hrc_score_p75'),
    hrc_reference:        stats.get('hrc_score_p90'),
    hrc_reference_p95:    stats.get('hrc_score_p95'),
    intact_pixel_count:   pixelCount,
    reference_filter:     'Hansen_canopy80_loss0',
    reference_method:     'image_mask_p90_Hansen',
    reference_confidence: confidence
  });
});

print('Per-ecoregion reference results (Tapajós):', results);

// ── Step 6: Map preview ──────────────────────────────────────────────
Map.addLayer(hrcImage,
  { min: 0, max: 10, palette: ['8B2500','D4550A','F4A623','C8D84A','1D9E75'] },
  'HRC v2.1 (Tapajós, 500m)'
);
Map.addLayer(intactHRC,
  { min: 0, max: 10, palette: ['8B2500','D4550A','F4A623','C8D84A','1D9E75'] },
  'HRC v2.1 — intact pixels only'
);
Map.addLayer(intactMask.selfMask(),
  { palette: ['00ff00'] },
  'Hansen intact mask (≥80% canopy, no loss)'
);

// ── Step 7: Export ───────────────────────────────────────────────────
Export.table.toDrive({
  collection:     results,
  description:    'hrc_v2_1_1_tapajos_reference',
  folder:         'EarthHRC',
  fileNamePrefix: 'hrc_v2_1_1_tapajos_reference',
  fileFormat:     'CSV',
  selectors: [
    'ecoregion_id', 'ecoregion_name', 'biome_name',
    'hrc_reference_p75', 'hrc_reference', 'hrc_reference_p95',
    'intact_pixel_count', 'reference_filter', 'reference_method',
    'reference_confidence'
  ]
});

print('Export task queued. Go to Tasks panel and click RUN.');
