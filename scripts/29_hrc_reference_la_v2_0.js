// ============================================================
// 29_hrc_reference_la_v2_0.js
// Earth HRC Index — Intact Site Reference — Los Angeles — v2.0
//
// Computes hrc_reference per RESOLVE ecoregion as the p90 HRC
// of IUCN I–VI protected area centroids within Los Angeles.
//
// Methodology: CENTROID SAMPLING
//   Same approach as Wales (script 28). Each PA centroid → one
//   HRC value, grouped by ecoregion, p90 taken as reference.
//
// IUCN filter deviation: IUCN I–VI (not I–IV)
//   LA has very sparse strict PA coverage — IUCN I–IV yields
//   only 3–15 centroids per ecoregion (all low confidence).
//   Expanding to I–VI gives 23–60 centroids — minimum viable.
//   reference_filter field records 'IUCN_I-VI' in output.
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
// Datasets:
//   ECMWF/ERA5_LAND/MONTHLY_AGGR   (Tier C — HRC v2.0)
//   WCMC/WDPA/current/polygons     (IUCN I–VI protected areas)
//   RESOLVE/ECOREGIONS/2017        (ecoregion boundaries)
// ============================================================

var region    = ee.Geometry.Rectangle([-119.0, 33.6, -117.4, 34.4]);
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

print('HRC range (LA — expect mean ~2.5–3.5):',
  hrcImage.reduceRegion({
    reducer: ee.Reducer.minMax().combine(ee.Reducer.mean(), '', true),
    geometry: region, scale: 11132, maxPixels: 1e8
  })
);

// ── Step 2: Load WDPA — IUCN I–VI (LA deviation) ────────────
// Expanding to I–VI to achieve minimum viable sample counts.
// reference_filter metadata records which filter was used.
var wdpa = ee.FeatureCollection('WCMC/WDPA/current/polygons')
  .filter(ee.Filter.inList('IUCN_CAT', ['Ia', 'Ib', 'II', 'III', 'IV', 'V', 'VI']))
  .filterBounds(region);

print('WDPA I–VI PA count in LA region:', wdpa.size());

// ── Step 3: Sample HRC at each PA centroid ───────────────────
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

print('Ecoregion count in LA region:', resolve.size());

// ── Step 5: Per-ecoregion p90 from centroid samples ─────────
var results = resolve.map(function(eco) {
  var ecoGeom = eco.geometry();

  var samplesInEco = centroids.filterBounds(ecoGeom);
  var n = samplesInEco.size();
  var hasEnough = n.gte(10);

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
    reference_filter:     'IUCN_I-VI',
    reference_confidence: confidence
  });
});

print('Ecoregion reference results:', results);

// ── Step 6: Map preview ──────────────────────────────────────
Map.addLayer(
  hrcImage,
  { min: 0, max: 10, palette: ['d73027', 'fee08b', '1a9850'] },
  'HRC v2.0 (Los Angeles)'
);
Map.addLayer(wdpa, { color: '2E7D32' }, 'WDPA I–VI (LA)');

// ── Step 7: Export ───────────────────────────────────────────
Export.table.toDrive({
  collection:     results,
  description:    'hrc_reference_la_v2_0',
  folder:         'EarthHRC',
  fileNamePrefix: 'hrc_reference_la_v2_0',
  fileFormat:     'CSV',
  selectors:      ['ecoregion_id', 'ecoregion_name', 'biome_name',
                   'hrc_reference_p75', 'hrc_reference', 'hrc_reference_p95',
                   'pa_centroid_count', 'reference_filter', 'reference_confidence']
});

print('Export task queued. Go to Tasks panel and click RUN.');
