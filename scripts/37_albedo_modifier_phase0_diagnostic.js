// =====================================================================
// 37_albedo_modifier_phase0_diagnostic.js — Albedo modifier Phase 0
// Six-pixel diagnostic panel
//
// Phase 0 of HRC_albedo_modifier_claude_code_handoff_v1_0.md.
// Diagnostic only — does NOT touch production tiles or schema.
//
// PURPOSE: Compute the raw inputs needed to evaluate the v2.2 formula
// at the six-pixel panel from handoff §6.2:
//
//   #1 FR-Fon flux tower (2.780 E, 48.476 N)              — intact temperate broadleaf
//   #2 Beauce-equivalent cropland (IDF bbox)              — cropland in temperate biome
//   #3 K67 flux tower (-54.959 W, -2.857 S)               — intact humid tropical
//   #4 BR-163 clearance (Tapajós bbox)                    — recent deforestation
//   #5 Paris urban core (2.35 E, 48.86 N)                 — sealed urban
//   #6 Disabled-ecoregion control                         — pulled in Python from
//                                                            ecoregion-centroid sample
//                                                            (whichever ecoregion the
//                                                            scripts 35 / 36 trust gate
//                                                            disables)
//
// The script does NOT compute v2.2 scores — it outputs raw inputs
// (latent heat, net radiation, pixel albedo, ecoregion id) and the
// Python analysis script joins them against the reference CSVs and
// computes v2.2 scores at w = 0.10 / 0.15 / 0.20.
//
// PIXEL VERIFICATION: each panel point's MCD12Q1 LC_Type1 class is
// returned so the Python analysis can confirm the pixel is the regime
// we intended (e.g., #2 should be class 12 cropland, #4 should be
// class 8/9 woody savanna or class 10 grassland indicating recent loss,
// #5 should be class 13 urban). Mismatches are flagged.
//
// ALTERNATE CANDIDATES: for the three "regime-by-coordinate" pixels
// (#2 Beauce, #4 BR-163), four alternate coordinates are also sampled
// so a misclassified illustrative coord can be swapped without re-running
// the whole script.
//
// OUTPUT: two CSVs
//   - hrc_albedo_panel_pixels_phase0.csv           (the six + alternates)
//   - hrc_albedo_panel_ecoregion_centroids_phase0.csv  (for pixel #6)
// =====================================================================

// ── Time window — must match v2.1.2 pipeline exactly ────────────────
var YEAR_START    = '2023-01-01';
var YEAR_END      = '2024-01-01';
var SOURCE_WINDOW = '2023-01-01/2024-01-01';
var ALBEDO_SOURCE = 'MODIS/061/MCD43A3';

// Region bboxes — same as scripts 31/32/35/36
var IDF_BBOX     = ee.Geometry.Rectangle([2.4,   48.3, 3.2,   48.7]);
var TAPAJOS_BBOX = ee.Geometry.Rectangle([-55.4, -3.3, -54.5, -2.4]);
var COMBINED_BBOX = IDF_BBOX.union(TAPAJOS_BBOX, ee.ErrorMargin(1000));

// ── 1. Build per-region radiation balance images ────────────────────
// Reuses the v2.1.2 pipeline logic verbatim from scripts 31 / 32 so
// the diagnostic numbers are identical to what production tiles see.
//
// Encapsulated in a function so it can be called twice (IDF, Tapajós)
// without duplicating the body. Each call returns an image with bands:
//   latent_heat_J, net_rn_J, ef, pixel_albedo
function buildRegionImage(bbox) {
  var SECONDS_PER_YEAR = 31536000;
  var SIGMA = 5.67e-8;

  // Latent heat (PML_V2)
  var latentHeatAnnualJ = ee.ImageCollection('CAS/IGSNRR/PML/V2_v018')
    .filterDate(YEAR_START, YEAR_END)
    .filterBounds(bbox)
    .map(function(img) {
      return img.select(['Ec', 'Es', 'Ei'])
                .reduce(ee.Reducer.sum())
                .multiply(8)
                .multiply(2.45e6);
    })
    .sum().clip(bbox).rename('latent_heat_J');

  // Pixel albedo (annual MCD43A3) — also serves as pipeline albedo input
  var albedoAnnual = ee.ImageCollection(ALBEDO_SOURCE)
    .filterDate(YEAR_START, YEAR_END)
    .filterBounds(bbox)
    .map(function(img) {
      var qa = img.select('BRDF_Albedo_Band_Mandatory_Quality_shortwave');
      return img.select('Albedo_BSA_shortwave').multiply(0.001).updateMask(qa.eq(0));
    })
    .mean().clip(bbox).rename('pixel_albedo');

  // Net shortwave
  var swDownAnnualJ = ee.ImageCollection('ECMWF/ERA5_LAND/MONTHLY_AGGR')
    .filterDate(YEAR_START, YEAR_END)
    .select('surface_solar_radiation_downwards_sum')
    .sum().clip(bbox);
  var netShortwaveJ = swDownAnnualJ.multiply(ee.Image(1).subtract(albedoAnnual));

  // Net longwave (Jensen-aware, equal-weight day/night per v2.1.1 fix)
  var lwDownAnnualJ = ee.ImageCollection('ECMWF/ERA5_LAND/MONTHLY_AGGR')
    .filterDate(YEAR_START, YEAR_END)
    .select('surface_thermal_radiation_downwards_sum')
    .sum().clip(bbox);

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
    .filterBounds(bbox);
  var dayLwUp   = modCombined.map(function(img) { return lwUpFromBand(img, 'LST_Day_1km',   'QC_Day'); });
  var nightLwUp = modCombined.map(function(img) { return lwUpFromBand(img, 'LST_Night_1km', 'QC_Night'); });
  var lwUpAnnualJ = dayLwUp.mean().add(nightLwUp.mean()).divide(2).multiply(SECONDS_PER_YEAR);
  var netLongwaveJ = lwDownAnnualJ.subtract(lwUpAnnualJ);

  var netRnAnnualJ = netShortwaveJ.add(netLongwaveJ).rename('net_rn_J');
  var netRnSafe    = netRnAnnualJ.where(netRnAnnualJ.lte(0), 0.001);
  var ef           = latentHeatAnnualJ.divide(netRnSafe).min(1).max(0).rename('ef');

  return latentHeatAnnualJ.addBands(netRnAnnualJ).addBands(ef).addBands(albedoAnnual);
}

var imgIDF     = buildRegionImage(IDF_BBOX);
var imgTAPAJOS = buildRegionImage(TAPAJOS_BBOX);

// ── 2. MCD12Q1 land cover for pixel verification ────────────────────
var landcover = ee.ImageCollection('MODIS/061/MCD12Q1')
  .filterDate('2023-01-01', '2024-01-01')
  .first()
  .select('LC_Type1')
  .clip(COMBINED_BBOX);

// ── 3. RESOLVE ecoregions (all in either bbox) ──────────────────────
var resolveAll = ee.FeatureCollection('RESOLVE/ECOREGIONS/2017')
  .filterBounds(COMBINED_BBOX);

// ── 4. Define the panel pixels ──────────────────────────────────────
// Each panel pixel is a feature with: pixel_id, regime, region_code,
// is_alternate (true for fallback candidates).
//
// For #2 (Beauce cropland) and #4 (BR-163 clearance), several candidate
// coords are included so a misclassified illustrative point can be
// swapped without re-running. The Python analysis picks the first
// candidate whose lc_type1 matches the expected class.
var panelFeatures = ee.FeatureCollection([
  // #1 FR-Fon — fixed
  ee.Feature(ee.Geometry.Point([2.780, 48.476]), {
    pixel_id: 'p1_frfon', regime: 'intact_temperate_broadleaf',
    region_code: 'idf', is_alternate: false,
    expected_lc_class: 4   // Deciduous Broadleaf Forest
  }),

  // #2 Beauce cropland — primary moved IN-BBOX (handoff illustrative
  // coord 1.80°E was west of the bbox west edge at 2.4°E, producing
  // null EF/albedo. v1.1 Phase 0 finding.)
  ee.Feature(ee.Geometry.Point([2.50, 48.40]), {
    pixel_id: 'p2_beauce', regime: 'cropland_temperate',
    region_code: 'idf', is_alternate: false,
    expected_lc_class: 12
  }),
  ee.Feature(ee.Geometry.Point([2.50, 48.45]), {
    pixel_id: 'p2_beauce_alt1', regime: 'cropland_temperate',
    region_code: 'idf', is_alternate: true,
    expected_lc_class: 12
  }),
  ee.Feature(ee.Geometry.Point([2.60, 48.40]), {
    pixel_id: 'p2_beauce_alt2', regime: 'cropland_temperate',
    region_code: 'idf', is_alternate: true,
    expected_lc_class: 12
  }),
  ee.Feature(ee.Geometry.Point([2.80, 48.40]), {
    pixel_id: 'p2_beauce_alt3', regime: 'cropland_temperate',
    region_code: 'idf', is_alternate: true,
    expected_lc_class: 12
  }),
  ee.Feature(ee.Geometry.Point([3.00, 48.45]), {
    pixel_id: 'p2_beauce_alt4', regime: 'cropland_temperate',
    region_code: 'idf', is_alternate: true,
    expected_lc_class: 12
  }),

  // #3 K67 — fixed
  ee.Feature(ee.Geometry.Point([-54.959, -2.857]), {
    pixel_id: 'p3_k67', regime: 'intact_humid_tropical',
    region_code: 'tapajos', is_alternate: false,
    expected_lc_class: 2   // Evergreen Broadleaf Forest
  }),

  // #4 BR-163 clearance — illustrative + 4 alternates
  ee.Feature(ee.Geometry.Point([-55.00, -3.05]), {
    pixel_id: 'p4_br163', regime: 'recent_deforestation',
    region_code: 'tapajos', is_alternate: false,
    expected_lc_class: 10  // Grasslands (post-clearance proxy)
  }),
  ee.Feature(ee.Geometry.Point([-54.95, -3.00]), {
    pixel_id: 'p4_br163_alt1', regime: 'recent_deforestation',
    region_code: 'tapajos', is_alternate: true,
    expected_lc_class: 10
  }),
  ee.Feature(ee.Geometry.Point([-54.90, -3.05]), {
    pixel_id: 'p4_br163_alt2', regime: 'recent_deforestation',
    region_code: 'tapajos', is_alternate: true,
    expected_lc_class: 10
  }),
  ee.Feature(ee.Geometry.Point([-54.85, -3.10]), {
    pixel_id: 'p4_br163_alt3', regime: 'recent_deforestation',
    region_code: 'tapajos', is_alternate: true,
    expected_lc_class: 10
  }),
  ee.Feature(ee.Geometry.Point([-55.05, -3.15]), {
    pixel_id: 'p4_br163_alt4', regime: 'recent_deforestation',
    region_code: 'tapajos', is_alternate: true,
    expected_lc_class: 10
  }),

  // #5 Paris urban core — primary moved IN-BBOX (handoff illustrative
  // coord 48.86°N was north of the bbox north edge at 48.7°N).
  // 48.65°N puts us in dense suburb (Versailles area) which is still
  // sealed urban for MCD12Q1 class 13.
  ee.Feature(ee.Geometry.Point([2.35, 48.65]), {
    pixel_id: 'p5_paris', regime: 'urban_sealed',
    region_code: 'idf', is_alternate: false,
    expected_lc_class: 13  // Urban and Built-Up
  }),
  ee.Feature(ee.Geometry.Point([2.30, 48.65]), {
    pixel_id: 'p5_paris_alt1', regime: 'urban_sealed',
    region_code: 'idf', is_alternate: true,
    expected_lc_class: 13
  }),
  ee.Feature(ee.Geometry.Point([2.40, 48.62]), {
    pixel_id: 'p5_paris_alt2', regime: 'urban_sealed',
    region_code: 'idf', is_alternate: true,
    expected_lc_class: 13
  }),
  ee.Feature(ee.Geometry.Point([2.45, 48.60]), {
    pixel_id: 'p5_paris_alt3', regime: 'urban_sealed',
    region_code: 'idf', is_alternate: true,
    expected_lc_class: 13
  }),
  ee.Feature(ee.Geometry.Point([2.50, 48.65]), {
    pixel_id: 'p5_paris_alt4', regime: 'urban_sealed',
    region_code: 'idf', is_alternate: true,
    expected_lc_class: 13
  })
]);

// ── 4b. Dynamic scan grids ───────────────────────────────────────────
// Generates a grid of candidate alternates for the two "regime-by-coord"
// regimes (Beauce cropland and BR-163 deforestation). The analysis
// script's fallback logic picks the first grid candidate whose
// MCD12Q1 LC class matches the expected target.
//
// Each grid candidate looks like a normal panel feature; sampling
// downstream is unchanged.
function gridFeatures(west, south, east, north, n, idPrefix, regime, regionCode, expectedClass) {
  var feats = [];
  for (var i = 0; i < n; i++) {
    for (var j = 0; j < n; j++) {
      // Cell centre, avoids landing exactly on the bbox edge.
      var lon = west  + (east  - west)  * (i + 0.5) / n;
      var lat = south + (north - south) * (j + 0.5) / n;
      feats.push(ee.Feature(ee.Geometry.Point([lon, lat]), {
        pixel_id:           idPrefix + '_grid_' + i + '_' + j,
        regime:             regime,
        region_code:        regionCode,
        is_alternate:       true,
        expected_lc_class:  expectedClass
      }));
    }
  }
  return feats;
}

// IDF: 10×10 grid for Beauce cropland (LC class 12) alternates
var idfGrid     = gridFeatures(2.4,   48.3, 3.2,   48.7, 10, 'p2_beauce', 'cropland_temperate',  'idf',     12);
// Tapajós: 10×10 grid for BR-163 deforestation (LC class 10 = Grassland,
// or 8/9 = Woody Savanna / Savanna as proxies for post-clearance pasture)
var tapajosGrid = gridFeatures(-55.4, -3.3, -54.5, -2.4, 10, 'p4_br163', 'recent_deforestation', 'tapajos', 10);

panelFeatures = panelFeatures.merge(ee.FeatureCollection(idfGrid.concat(tapajosGrid)));

// ── 5. Sample radiation + albedo + LC at each panel pixel ───────────
function sampleRegionImage(feature, regionImage) {
  var pt = feature.geometry();

  var sample = regionImage.reduceRegion({
    reducer:  ee.Reducer.first(),
    geometry: pt,
    scale:    500,
    maxPixels: 1e4
  });

  var lcSample = landcover.reduceRegion({
    reducer:  ee.Reducer.first(),
    geometry: pt,
    scale:    500,
    maxPixels: 1e4
  }).get('LC_Type1');

  var eco = resolveAll.filterBounds(pt).first();

  var coords = pt.coordinates();
  return feature.set({
    longitude:        ee.Number(coords.get(0)),
    latitude:         ee.Number(coords.get(1)),
    latent_heat_J:    sample.get('latent_heat_J'),
    net_rn_J:         sample.get('net_rn_J'),
    ef:               sample.get('ef'),
    pixel_albedo:     sample.get('pixel_albedo'),
    lc_type1:         lcSample,
    ecoregion_id:     ee.Algorithms.If(eco, eco.get('ECO_ID'),     null),
    ecoregion_name:   ee.Algorithms.If(eco, eco.get('ECO_NAME'),   null),
    biome_name:       ee.Algorithms.If(eco, eco.get('BIOME_NAME'), null),
    source_window:    SOURCE_WINDOW,
    albedo_data_source: ALBEDO_SOURCE
  });
}

// Split, sample by region, then merge — simpler than mapping the
// region-image lookup inside reduceRegion.
var panelIDF     = panelFeatures.filter(ee.Filter.eq('region_code', 'idf'))
                                .map(function(f) { return sampleRegionImage(f, imgIDF); });
var panelTAPAJOS = panelFeatures.filter(ee.Filter.eq('region_code', 'tapajos'))
                                .map(function(f) { return sampleRegionImage(f, imgTAPAJOS); });

var panelSamples = panelIDF.merge(panelTAPAJOS);

print('Panel pixel samples:', panelSamples);

// ── 6. Sample all ecoregion centroids in both bboxes (for pixel #6) ──
// The trust-gate output from scripts 35 / 36 tells us which ecoregions
// are 'disabled'. The Python analysis joins this list of centroid
// samples to that table and picks the first disabled ecoregion's
// centroid as panel pixel #6. If none are disabled, the analysis flags
// "no disabled ecoregion in panel — Phase 0 finding".
var ecoCentroids = resolveAll.map(function(eco) {
  var ecoGeom = eco.geometry();
  var centroid = ecoGeom.centroid(ee.ErrorMargin(100));
  var ptCoords = centroid.coordinates();

  // Decide which region this ecoregion belongs to by testing centroid
  // against the IDF bbox first; otherwise Tapajós.
  var inIDF = IDF_BBOX.contains(centroid, ee.ErrorMargin(1000));
  var regionCode = ee.Algorithms.If(inIDF, 'idf', 'tapajos');
  var regionImage = ee.Algorithms.If(inIDF, imgIDF, imgTAPAJOS);

  // The ee.Algorithms.If above can't return an Image directly for use in
  // reduceRegion. Sample both, then pick.
  var idfSample = imgIDF.reduceRegion({
    reducer: ee.Reducer.first(), geometry: centroid, scale: 500, maxPixels: 1e4
  });
  var tapSample = imgTAPAJOS.reduceRegion({
    reducer: ee.Reducer.first(), geometry: centroid, scale: 500, maxPixels: 1e4
  });

  var sample = ee.Dictionary(ee.Algorithms.If(inIDF, idfSample, tapSample));

  var lcSample = landcover.reduceRegion({
    reducer: ee.Reducer.first(), geometry: centroid, scale: 500, maxPixels: 1e4
  }).get('LC_Type1');

  return ee.Feature(centroid, {
    pixel_id:           ee.String('eco_centroid_').cat(ee.String(eco.get('ECO_ID'))),
    regime:             'ecoregion_centroid_for_disabled_control',
    region_code:        regionCode,
    is_alternate:       true,
    expected_lc_class:  -1,
    longitude:          ee.Number(ptCoords.get(0)),
    latitude:           ee.Number(ptCoords.get(1)),
    latent_heat_J:      sample.get('latent_heat_J'),
    net_rn_J:           sample.get('net_rn_J'),
    ef:                 sample.get('ef'),
    pixel_albedo:       sample.get('pixel_albedo'),
    lc_type1:           lcSample,
    ecoregion_id:       eco.get('ECO_ID'),
    ecoregion_name:     eco.get('ECO_NAME'),
    biome_name:         eco.get('BIOME_NAME'),
    source_window:      SOURCE_WINDOW,
    albedo_data_source: ALBEDO_SOURCE
  });
});

print('Ecoregion centroid samples (for pixel #6 selection):', ecoCentroids);

// ── 7. Map preview ──────────────────────────────────────────────────
Map.centerObject(IDF_BBOX, 8);
Map.addLayer(panelIDF,     { color: 'red'    }, 'IDF panel pixels');
Map.addLayer(panelTAPAJOS, { color: 'orange' }, 'Tapajós panel pixels');
Map.addLayer(ecoCentroids, { color: 'cyan'   }, 'Ecoregion centroids', false);

// ── 8. Export ───────────────────────────────────────────────────────
var panelSelectors = [
  'pixel_id', 'regime', 'region_code', 'is_alternate',
  'longitude', 'latitude',
  'latent_heat_J', 'net_rn_J', 'ef', 'pixel_albedo',
  'lc_type1', 'expected_lc_class',
  'ecoregion_id', 'ecoregion_name', 'biome_name',
  'source_window', 'albedo_data_source'
];

Export.table.toDrive({
  collection:     panelSamples,
  description:    'hrc_albedo_panel_pixels_phase0',
  folder:         'EarthHRC',
  fileNamePrefix: 'hrc_albedo_panel_pixels_phase0',
  fileFormat:     'CSV',
  selectors:      panelSelectors
});

Export.table.toDrive({
  collection:     ecoCentroids,
  description:    'hrc_albedo_panel_ecoregion_centroids_phase0',
  folder:         'EarthHRC',
  fileNamePrefix: 'hrc_albedo_panel_ecoregion_centroids_phase0',
  fileFormat:     'CSV',
  selectors:      panelSelectors
});

print('Two export tasks queued. Run both, then download to Drive.');
print('Filenames: hrc_albedo_panel_pixels_phase0.csv,');
print('           hrc_albedo_panel_ecoregion_centroids_phase0.csv');
