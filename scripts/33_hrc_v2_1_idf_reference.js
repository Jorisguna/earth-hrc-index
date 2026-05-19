// =====================================================================
// 33_hrc_v2_1_idf_reference.js — v2.1 higher-fidelity showcase
// Île-de-France intact site reference (Path A: centroid sampling)
//
// METHODOLOGY (per docs HRC_higher_fidelity_methodology_v2_1.md §6):
//
// PATH A — applicable where dominant protected areas are smaller than
// ~10 km² and protected-area density is high relative to ecoregion size.
// IDF qualifies: 66 IUCN I-IV centroids in the bounding box (per
// methodology paper §6.5).
//
// METHOD:
//   1. Recompute the v2.1 HRC at 500m for the IDF box
//   2. Filter WDPA: IUCN Ia–IV, STATUS = 'Designated' (no MARINE filter
//      — the field is empty per process guide §6.2)
//   3. Convert each PA polygon to its centroid
//   4. Sample HRC at each centroid
//   5. Per ecoregion: p90 of centroid HRC values
//
// CRITICAL TRAPS AVOIDED (per process guide §6.2):
//   - WDPA MARINE filter is DROPPED (field is empty in current ingest)
//   - STATUS filter uses 'Designated' (other regions may need broader)
//   - Quality gate via STATUS, not via MARINE
//
// FALLBACK: ecoregions with < 20 centroids fall back to Path C (the
// FR-Fon flux-tower-derived reference of 5.04). Handled in the Python
// import script, not here — this script just outputs raw counts.
//
// OUTPUT: per-ecoregion reference rows
// =====================================================================

// ── Region & time window ─────────────────────────────────────────────
var BBOX = ee.Geometry.Rectangle([2.4, 48.3, 3.2, 48.7]);
var YEAR_START = '2023-01-01';
var YEAR_END   = '2024-01-01';
var LANDCOVER_YEAR = '2023-01-01';

// v2.2.1 patch (2026-05-19) — mirror the cropland-buffer filter that
// scripts 38 and 31_..._v2_2.js use, so the v2.1.x reference produced
// here is methodology-consistent with the v2.2 reference. The original
// script 33 used no land-cover gate; the buffer check rejects centroids
// where >25% of a 1 km neighbourhood is cropland (MCD12Q1 LC_Type1 in
// {12, 13, 14}). Catches PA polygon centroids that land in mosaic
// farmland (typically PNRs at IUCN V — but I-IV centroids can also
// occasionally fall in non-intact patches).
var CROPLAND_BUFFER_RADIUS = 1000;
var CROPLAND_BUFFER_MAX    = 0.25;

Map.centerObject(BBOX, 9);

// ── Step 1: Compute v2.1 HRC at 500m (same pipeline as script 31) ────

// Latent heat from PML_V2
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

// Net shortwave
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

// Net longwave (Jensen-aware)
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

// ── v2.2.1 — MCD12Q1 cropland/urban mask for the 1 km buffer check ───
var landcover = ee.ImageCollection('MODIS/061/MCD12Q1')
  .filterDate(LANDCOVER_YEAR, '2024-01-01')
  .first()
  .select('LC_Type1')
  .clip(BBOX);
var croplandOrUrban = landcover.eq(12).or(landcover.eq(13)).or(landcover.eq(14))
                                .rename('cul');

// ── Step 2: Filter WDPA — IUCN I–IV, Designated ──────────────────────
// Process guide §6.2: drop MARINE filter (field empty), keep STATUS gate.
var wdpa = ee.FeatureCollection('WCMC/WDPA/current/polygons')
  .filterBounds(BBOX)
  .filter(ee.Filter.inList('IUCN_CAT', ['Ia', 'Ib', 'II', 'III', 'IV']))
  .filter(ee.Filter.eq('STATUS', 'Designated'));

print('WDPA IUCN I–IV designated PA count in IDF box (expect ~66):', wdpa.size());

// ── Step 3: Sample HRC + cropland-buffer at each PA centroid ────────
// v2.2.1 — adds cropland_buffer_frac for the 1 km neighbourhood check.
// Rejects centroids whose 1 km surround is >25% cropland/urban so the
// v2.1.x reference here uses the same trust mechanism as the v2.2
// reference (scripts 38 + 31_..._v2_2.js).
var centroidsRaw = wdpa.map(function(pa) {
  var centroid   = pa.geometry().centroid(ee.ErrorMargin(100));
  var cropBuffer = centroid.buffer(CROPLAND_BUFFER_RADIUS);
  var hrcVal = hrcImage.reduceRegion({
    reducer:   ee.Reducer.first(),
    geometry:  centroid,
    scale:     500,
    maxPixels: 1e4
  });
  var croplandFrac = croplandOrUrban.reduceRegion({
    reducer:   ee.Reducer.mean(),
    geometry:  cropBuffer,
    scale:     500,
    maxPixels: 1e4
  });
  return ee.Feature(centroid, {
    hrc_score:            hrcVal.get('hrc_score'),
    cropland_buffer_frac: croplandFrac.get('cul'),
    pa_name:              pa.get('NAME'),
    iucn_cat:             pa.get('IUCN_CAT')
  });
});

var centroids = centroidsRaw
  .filter(ee.Filter.notNull(['hrc_score']))
  .filter(ee.Filter.lte('cropland_buffer_frac', CROPLAND_BUFFER_MAX));

print('Centroid samples — raw / after cropland buffer:',
  ee.Dictionary({
    raw: centroidsRaw.size(),
    kept: centroids.size()
  })
);

// ── Step 4: Load RESOLVE ecoregions ──────────────────────────────────
var resolve = ee.FeatureCollection('RESOLVE/ECOREGIONS/2017')
  .filterBounds(BBOX);

print('Ecoregion count in IDF box:', resolve.size());

// ── Step 5: Per-ecoregion p90 from centroid samples ─────────────────
// Threshold: ≥ 20 centroids = "moderate"; ≥ 50 = "high"; ≥ 10 = "low";
// < 10 = null (Python import script falls back to Path C).
var results = resolve.map(function(eco) {
  var samplesInEco = centroids.filterBounds(eco.geometry());
  var n = samplesInEco.size();
  var hasEnough = n.gte(10);

  var stats = ee.Algorithms.If(
    hasEnough,
    samplesInEco.reduceColumns({
      reducer: ee.Reducer.percentile([75, 90, 95]),
      selectors: ['hrc_score']
    }),
    ee.Dictionary({ p75: null, p90: null, p95: null })
  );
  stats = ee.Dictionary(stats);

  var confidence = ee.Algorithms.If(
    n.gte(50), 'high',
    ee.Algorithms.If(
      n.gte(20), 'moderate',
      ee.Algorithms.If(
        n.gte(10), 'low',
        'insufficient'
      )
    )
  );

  return ee.Feature(null, {
    ecoregion_id:         eco.get('ECO_ID'),
    ecoregion_name:       eco.get('ECO_NAME'),
    biome_name:           eco.get('BIOME_NAME'),
    hrc_reference_p75:    stats.get('p75'),
    hrc_reference:        stats.get('p90'),
    hrc_reference_p95:    stats.get('p95'),
    pa_centroid_count:    n,
    reference_filter:     'IUCN_I-IV',
    reference_method:     'centroid_p90_IUCN_I-IV',
    reference_confidence: confidence
  });
});

print('Per-ecoregion reference results (IDF):', results);

// ── Step 6: Map preview ──────────────────────────────────────────────
Map.addLayer(hrcImage,
  { min: 0, max: 10, palette: ['8B2500','D4550A','F4A623','C8D84A','1D9E75'] },
  'HRC v2.1 (IDF, 500m)'
);
Map.addLayer(wdpa, { color: '2E7D32' }, 'WDPA I–IV Designated');

// ── Step 7: Export ───────────────────────────────────────────────────
Export.table.toDrive({
  collection:     results,
  description:    'hrc_v2_1_1_idf_reference',
  folder:         'EarthHRC',
  fileNamePrefix: 'hrc_v2_1_1_idf_reference',
  fileFormat:     'CSV',
  selectors: [
    'ecoregion_id', 'ecoregion_name', 'biome_name',
    'hrc_reference_p75', 'hrc_reference', 'hrc_reference_p95',
    'pa_centroid_count', 'reference_filter', 'reference_method',
    'reference_confidence'
  ]
});

print('Export task queued. Go to Tasks panel and click RUN.');
