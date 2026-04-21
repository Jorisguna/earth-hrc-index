// ============================================================
// 28_hrc_reference_wales_v2_0.js
// Earth HRC Index — Intact Site Reference — Wales — v2.0
//
// Computes hrc_reference per RESOLVE ecoregion as the p90 HRC
// of IUCN I–IV protected area centroids within Wales.
//
// Methodology: CENTROID SAMPLING
//   Wales has 1,444 PAs — geometry union exceeds GEE 2M edge limit.
//   ERA5 pixels (~120 km²) are larger than most PAs, so image masking
//   returns 0 or 1 pixel per PA regardless of PA size.
//   Centroid approach: sample HRC at the centroid of each PA,
//   giving exactly 1 value per PA — consistent and scalable.
//
// Uses same HRC formula and time window as hrc_score v2.0:
//   HRC = 10 × Σ|λE_monthly| / Σ(Rn_monthly)
//   Window: Jan 2025 – Jan 2026 (MONTHLY_AGGR)
//
// Reference confidence thresholds (n = PA centroids per ecoregion):
//   >= 50  → high
//   20–49  → moderate
//   10–19  → low
//   < 10   → null (no reference stored)
//
// Output per ecoregion:
//   ecoregion_id, ecoregion_name, biome_name,
//   hrc_reference_p75, hrc_reference (p90), hrc_reference_p95,
//   pa_centroid_count, reference_filter, reference_confidence
//
// Datasets:
//   ECMWF/ERA5_LAND/MONTHLY_AGGR   (Tier C — HRC v2.0)
//   WCMC/WDPA/current/polygons     (IUCN I–IV protected areas)
//   RESOLVE/ECOREGIONS/2017        (ecoregion boundaries)
// ============================================================

var region    = ee.Geometry.Rectangle([-5.35, 51.35, -2.65, 53.45]);
var startDate = ee.Date('2025-01-01');
var endDate   = ee.Date('2026-01-01');

Map.centerObject(region, 8);

// ── Step 1: Compute HRC v2.0 (ratio of annual sums) ─────────
var era5 = ee.ImageCollection('ECMWF/ERA5_LAND/MONTHLY_AGGR')
  .filterDate(startDate, endDate)
  .filterBounds(region);

var latentHeat = era5.select('surface_latent_heat_flux_sum')
                     .map(function(img) { return img.abs(); })
                     .sum().clip(region);

var solarRad   = era5.select('surface_net_solar_radiation_sum').sum().clip(region);
var thermalRad = era5.select('surface_net_thermal_radiation_sum').sum().clip(region);

// CRITICAL: thermal radiation is NEGATIVE — never .abs() it
var netRad     = solarRad.add(thermalRad);
var netRadSafe = netRad.where(netRad.lte(0), 0.001);

var hrcImage = latentHeat.divide(netRadSafe).min(1).max(0)
                 .multiply(10).rename('hrc_score').toFloat();

print('HRC range (Wales — expect mean ~8.5–9.0):',
  hrcImage.reduceRegion({
    reducer: ee.Reducer.minMax().combine(ee.Reducer.mean(), '', true),
    geometry: region, scale: 11132, maxPixels: 1e8
  })
);

// ── Step 2: Load WDPA — IUCN I–IV ───────────────────────────
var wdpa = ee.FeatureCollection('WCMC/WDPA/current/polygons')
  .filter(ee.Filter.inList('IUCN_CAT', ['Ia', 'Ib', 'II', 'III', 'IV']))
  .filterBounds(region);

print('WDPA I–IV PA count in Wales:', wdpa.size());

// ── Step 3: Sample HRC at each PA centroid ───────────────────
// One centroid per PA → one HRC value per PA
var centroids = wdpa.map(function(pa) {
  var centroid = pa.geometry().centroid(ee.ErrorMargin(100));
  var hrcVal   = hrcImage.reduceRegion({
    reducer:   ee.Reducer.first(),
    geometry:  centroid,
    scale:     11132,
    maxPixels: 1e4
  });
  return ee.Feature(centroid, {
    hrc_score: hrcVal.get('hrc_score'),
    pa_name:   pa.get('NAME'),
    iucn_cat:  pa.get('IUCN_CAT')
  });
}).filter(ee.Filter.notNull(['hrc_score']));

print('Centroid samples with valid HRC:', centroids.size());

// ── Step 4: Load RESOLVE ecoregions ─────────────────────────
var resolve = ee.FeatureCollection('RESOLVE/ECOREGIONS/2017')
  .filterBounds(region);

print('Ecoregion count in Wales:', resolve.size());

// ── Step 5: Per-ecoregion p90 from centroid samples ─────────
var results = resolve.map(function(eco) {
  var ecoGeom = eco.geometry();

  // Get centroid samples inside this ecoregion
  var samplesInEco = centroids.filterBounds(ecoGeom);
  var n = samplesInEco.size();
  var hasEnough = n.gte(10);

  // Compute percentiles only if we have ≥ 10 samples
  var stats = ee.Algorithms.If(
    hasEnough,
    samplesInEco.reduceColumns({
      reducer: ee.Reducer.percentile([75, 90, 95]),
      selectors: ['hrc_score']
    }),
    ee.Dictionary({
      p75: null,
      p90: null,
      p95: null
    })
  );

  stats = ee.Dictionary(stats);

  // Confidence tier based on sample count
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
    reference_confidence: confidence
  });
});

print('Ecoregion reference results:', results);

// ── Step 6: Map preview ──────────────────────────────────────
Map.addLayer(
  hrcImage,
  { min: 0, max: 10, palette: ['d73027', 'fee08b', '1a9850'] },
  'HRC v2.0 (Wales)'
);
Map.addLayer(wdpa, { color: '2E7D32' }, 'WDPA I–IV (Wales)');

// ── Step 7: Export ───────────────────────────────────────────
Export.table.toDrive({
  collection:     results,
  description:    'hrc_reference_wales_v2_0',
  folder:         'EarthHRC',
  fileNamePrefix: 'hrc_reference_wales_v2_0',
  fileFormat:     'CSV',
  selectors:      ['ecoregion_id', 'ecoregion_name', 'biome_name',
                   'hrc_reference_p75', 'hrc_reference', 'hrc_reference_p95',
                   'pa_centroid_count', 'reference_filter', 'reference_confidence']
});

print('Export task queued. Go to Tasks panel and click RUN.');
