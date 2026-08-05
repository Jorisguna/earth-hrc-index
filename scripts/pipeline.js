// =====================================================================
// pipeline.js — HRC 30 m US test sites, Phase 2 production pipeline (GEE)
//
// Phase 2 of HRC_30m_test_sites_usa_implementation_plan_v1_0.md (Gate P2).
// Builds the 30 m OpenET-driven evaporative-fraction product for the three
// US flux-tower sites, plus the per-tower footprint stacks Phase 3 uses to
// adjudicate the pre-registered D2 denominator choice.
//
// READ-FIRST (the brief + the binding conventions this implements):
//   docs/HRC_30m_test_sites_usa_phase2_handoff_v1_0.md            (§4 outputs, §5 schema)
//   docs/HRC_scoring_conventions_source_of_truth.md              (C1..C8 — BINDING)
//   docs/HRC_30m_test_sites_usa_phase0_1_completion_report...md  (§2 D-F..D-J, §5 refs)
// TEMPLATE / HOUSE STYLE:
//   scripts/31_hrc_v2_1_idf_tiles_v2_2.js   (named constants; Export.table schema)
//   scripts/37_albedo_modifier_phase0_diagnostic.js §buildRegionImage
//                                            (net-radiation build; the W/m2->J
//                                             upward-longwave trick reused here)
//   tower.py                                 (REFERENCE IMPL of C1/C4/C6 — this
//                                             pipeline mirrors its D-F aggregation
//                                             and D-G mask thresholds EXACTLY)
//   scripts/feasibility.js                   (site boxes, tower coords, ERA5 units)
//
// TWO CONVENTIONS THAT DRIVE THE WHOLE BUILD (do not "improve" locally — they
// are project-owner-locked in the source-of-truth doc):
//
//   C1 / D-F  AGGREGATION = RATIO-OF-ANNUAL-SUMS.
//       ef_annual = ( Σ_m LE_J )_kept / ( Σ_m [Rn_J − G_J] )_kept ,  HRC = 10 × ef.
//       NOT the mean of monthly EF ratios (that over-weights low-energy months
//       and biases EF↔energy-correlated biomes in opposite directions — it is
//       the exact error a prior pass shipped). Numerator and denominator are
//       summed over the SAME kept (pixel, month) set, then divided.
//
//   C4 / D-G  ONE UNIFORM QUALITY MASK, identical to tower.py, per pixel:
//       exclude a month where  EF ∉ [−0.05, 1.05]  OR  mean available energy
//       < 25 W/m²  OR  valid coverage < 0.50  (coverage = clear-Landsat
//       fraction here). No per-site exceptions; closure is NEVER a criterion.
//       The pipeline computes its OWN valid-month set; the §3.3 low-energy sets
//       {Mead 1,12 / Tonzi 12 / Metolius 1,2,3,12} are a CONFIRMATION target,
//       not hardcoded. Phase 3 (D-H) compares over pipeline-valid ∩ tower-valid.
//
// WHAT IT PRODUCES (per site, calendar year 2023):
//   1. Numerator     — OpenET monthly LE (et_ensemble_mad mm/mo -> J/m2).
//   2. Denominator A — clear-sky 30 m Landsat Rn (D2).
//   3. Denominator B — all-sky ERA5 Rn, texture-downscaled to A's 30 m
//                      pattern (D2). BOTH built; Phase 3 picks the winner —
//                      DO NOT pick here (handoff §2 D2, §6).
//   4. Annual composite (D-F ratio-of-annual-sums) over the D-G valid months.
//   5. Per-tower footprint stacks (window, not one pixel — R6) for Phase 3,
//      carrying the pipeline's own per-month `masked` flag (D-H).
//   6. Metolius OpenET six-member EF spread (D-E, R2 forest band).
//   7. Mead-only geeSEBAL H -> EF_turbulent = LE/(LE+H) (D-B) — scaffolded.
//
// OUTPUT: two CSVs per site to Drive folder EarthHRC (schema = handoff §5):
//   hrc_30m_<region_code>_tiles.csv       (one row per 30 m cell)
//   hrc_30m_<region_code>_footprint.csv   (one row per tower per month)
//
// UNITS (match feasibility.js / script 31): ERA5-Land MONTHLY_AGGR '_sum'
// radiation bands are J/m2 ACCUMULATED OVER THE MONTH. OpenET ET (mm/mo)
// -> J/m2 over the month via LAMBDA. The Landsat LST-based upward longwave is
// an instantaneous W/m2 flux promoted to a monthly J/m2 energy by ×seconds-in-
// month (the same promotion script 31 does with the MODIS LST flux).
//
// EXPECTED BIAS (handoff §7 gotcha 1 & 4 — NOT a bug): denominator A is
// clear-sky daytime-overpass; OpenET is all-sky monthly. A runs biased HIGH
// (ef_annual_A may exceed 1); B corrects magnitude. Annual EF is reported
// UNCLIPPED so Phase 3 can measure the bias and pick a denominator.
//
// Does NOT touch production tiles, the database, or src/. Output is CSVs to
// Google Drive only. Build Mead first (ACTIVE_SITES), prove it, then generalize.
// =====================================================================

// ── Time window ─────────────────────────────────────────────────────
var YEAR          = 2023;
var SOURCE_WINDOW = '2023-01-01/2024-01-01';
var ALL_MONTHS    = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// ── Data assets (handoff §3.1) ──────────────────────────────────────
var OPENET_ENSEMBLE = 'OpenET/ENSEMBLE/CONUS/GRIDMET/MONTHLY/v2_0';
var OPENET_BAND     = 'et_ensemble_mad';   // ensemble ET, mm/month
// Six OpenET model members for the Metolius spread (D-E). Individual-model
// monthly collections carry band 'et' (mm/month). If a member path or band
// name differs in your GEE catalogue, adjust here only.
var OPENET_MEMBERS = [
  'OpenET/GEESEBAL/CONUS/GRIDMET/MONTHLY/v2_0',
  'OpenET/SSEBOP/CONUS/GRIDMET/MONTHLY/v2_0',
  'OpenET/PTJPL/CONUS/GRIDMET/MONTHLY/v2_0',
  'OpenET/SIMS/CONUS/GRIDMET/MONTHLY/v2_0',
  'OpenET/DISALEXI/CONUS/GRIDMET/MONTHLY/v2_0',
  'OpenET/EEMETRIC/CONUS/GRIDMET/MONTHLY/v2_0'
];
var OPENET_MEMBER_BAND = 'et';             // mm/month, per-model

var ERA5 = 'ECMWF/ERA5_LAND/MONTHLY_AGGR';
var L8   = 'LANDSAT/LC08/C02/T1_L2';
var L9   = 'LANDSAT/LC09/C02/T1_L2';

// ── Physical constants ──────────────────────────────────────────────
var LAMBDA = 2.45e6;   // J/kg latent heat of vaporisation (1 mm ET = 1 kg/m2)
var SIGMA  = 5.67e-8;  // W/m2/K4 Stefan-Boltzmann

// Landsat Collection-2 Level-2 scaling (USGS):
var ST_B10_SCALE  = 0.00341802, ST_B10_OFFSET = 149.0;   // surface temp -> K
var ST_EMIS_SCALE = 0.0001;                              // emissivity
var SR_SCALE      = 0.0000275,  SR_OFFSET      = -0.2;   // surface reflectance

// ── Uniform D-G mask thresholds — IDENTICAL to tower.py (C4). Do not ──
// diverge these from tower.py without a project-owner decision recorded in
// the source-of-truth doc.
var EF_TOL       = 0.05;   // tolerance on the [0,1] EF physical bound
var RN_MIN_WM2   = 25.0;   // monthly-mean available-energy floor (W/m2)
var COVERAGE_MIN = 0.50;   // min clear-Landsat fraction of the month

// ── Other tunables ──────────────────────────────────────────────────
var CLOUD_COVER_MAX    = 30;    // scene-level pre-filter (per-pixel QA mask still applied)
var SAMPLE_SCALE       = 30;    // tile export resolution (native 30 m; §5 allows this)
var MEAN_SCALE         = 300;   // scale for the box-mean Rn normalisation (denom B)
var FOOTPRINT_RADIUS_M = 100;   // tower footprint window radius (window, not 1 px — R6)
var USE_G              = false; // G=0 at monthly scale (D1); flip to wire a G source

// D-B geeSEBAL turbulent layer — Mead only. false = scaffold (EF_turbulent
// exports null; see meadTurbulentEF() for the wiring point). Do not flip to
// true until a geeSEBAL H module is wired in (handoff §8.4 — last item).
var RUN_GEESEBAL_H = false;

// ── Sites (Mead first — confidence-descending build order, §6) ──────
// code/bbox/towers mirror feasibility.js (single source of truth). forest
// flags the D-E member-spread site. dataSource is the D-C provenance tag.
// expectedLowEnergyMask is the §3.3 / completion-report §5.1 low-energy set —
// used ONLY to confirm the pipeline's DYNAMIC D-G result (never to drive it).
var SITES = [
  {
    code: 'mead_ne',
    label: 'Mead, Nebraska (intensive cropland)',
    bbox: ee.Geometry.Rectangle([-96.52, 41.14, -96.40, 41.20]),
    expectedLowEnergyMask: [1, 12],
    forest: false,
    dataSource: 'mead_ne_landsat_30m_2023',
    towers: [
      { id: 'US-Ne1', regime: 'irrigated_continuous_maize',   lon: -96.4766, lat: 41.1651, towerHRC: 5.70 },
      { id: 'US-Ne2', regime: 'irrigated_maize_soy_rotation', lon: -96.4701, lat: 41.1649, towerHRC: 6.01 },
      { id: 'US-Ne3', regime: 'rainfed_maize_soy_rotation',   lon: -96.4397, lat: 41.1797, towerHRC: 4.81 }
    ]
  },
  {
    code: 'tonzi_vaira_ca',
    label: 'Tonzi / Vaira Ranch, California (oak savanna + grassland)',
    bbox: ee.Geometry.Rectangle([-121.00, 38.38, -120.92, 38.46]),
    expectedLowEnergyMask: [12],
    forest: false,
    dataSource: 'tonzi_vaira_ca_landsat_30m_2023',
    towers: [
      { id: 'US-Ton', regime: 'blue_oak_savanna',    lon: -120.9660, lat: 38.4309, towerHRC: 2.95 },
      { id: 'US-Var', regime: 'annual_c3_grassland',  lon: -120.9508, lat: 38.4133, towerHRC: 2.83 }
    ]
  },
  {
    code: 'metolius_or',
    label: 'Metolius, Oregon (semi-arid ponderosa pine — forest stress case)',
    bbox: ee.Geometry.Rectangle([-121.62, 44.40, -121.50, 44.50]),
    expectedLowEnergyMask: [1, 2, 3, 12],
    forest: true,
    dataSource: 'metolius_or_landsat_30m_2023',
    towers: [
      // Coordinate corrected 2026-08-04: AmeriFlux BADM carries two US-Me2
      // location records — pre-fire (44.4523,-121.5574, valid from 2002-10)
      // and a post-fire relocation (44.4526,-121.5589, valid from 2022-08,
      // BADM comment "centered on regenerating footprint"). 2023 postdates
      // the move, so the post-fire point is correct here; the pre-fire point
      // was in every script in this repo. 123.8 m offset. Tower flux values
      // (tower.py / tower_ef_US-Me2.csv) are unaffected — those come from the
      // instrument's own record, not this sampling point. Regime label
      // ('mature_ponderosa_pine') is a separate, unresolved question: BADM's
      // own "regenerating footprint" comment may mean it no longer fits.
      { id: 'US-Me2', regime: 'mature_ponderosa_pine', lon: -121.5589, lat: 44.4526, towerHRC: 1.91 }
    ]
  }
];

// Build/prove Mead first, then widen to all three (handoff §8). Set to
// [SITES[0]] to iterate on Mead alone; SITES to queue all three exports.
var ACTIVE_SITES = SITES;

// =====================================================================
// PART A — Monthly product builder (numerator, both denominators, D-G mask)
// =====================================================================

// Per-scene QA_PIXEL clear mask (C2 L2 bits): dilated cloud (1), cirrus (2),
// cloud (3), cloud shadow (4). Returned as an unmasked 0/1 image (QA_PIXEL is
// populated for every pixel) so it can be both a compositing mask and a
// coverage tally.
function clearMask(img) {
  var qa = img.select('QA_PIXEL');
  return qa.bitwiseAnd(1 << 1).eq(0)
    .and(qa.bitwiseAnd(1 << 2).eq(0))
    .and(qa.bitwiseAnd(1 << 3).eq(0))
    .and(qa.bitwiseAnd(1 << 4).eq(0));
}

// Broadband shortwave albedo — Liang (2001) narrow-to-broadband on OLI
// surface reflectance (blue B2, red B4, NIR B5, SWIR1 B6, SWIR2 B7).
function liangAlbedo(img) {
  var sr = img.select(['SR_B2', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7'])
              .multiply(SR_SCALE).add(SR_OFFSET);
  return sr.select('SR_B2').multiply(0.356)
    .add(sr.select('SR_B4').multiply(0.130))
    .add(sr.select('SR_B5').multiply(0.373))
    .add(sr.select('SR_B6').multiply(0.085))
    .add(sr.select('SR_B7').multiply(0.072))
    .subtract(0.0018)
    .clamp(0, 1)
    .rename('albedo');
}

// Build one month's product image over a box. Bands:
//   le_J       — OpenET monthly latent-heat energy (J/m2 over the month)
//   availA_J   — clear-sky 30 m available energy Rn_A − G (J/m2)   [D2 denom A]
//   availB_J   — all-sky texture-downscaled available energy Rn_B − G (J/m2) [B]
//   secs       — seconds in the month (constant band, for the LE-flux mean)
//   avail_wm2  — all-sky available energy as a W/m2 flux (D-G energy floor)
//   coverage   — clear-Landsat fraction of the month, per pixel (D-G coverage)
//   excluded   — 0/1 uniform D-G exclusion (1 = drop this month at this pixel)
// Property: n_scenes (clear-ish Landsat scenes this month over the box).
//
// availA_J and availB_J share the same (Landsat-valid) mask, so numerator and
// denominator are summed over identical kept sets downstream (C1).
function monthlyProduct(bbox, month) {
  var start = ee.Date.fromYMD(YEAR, month, 1);
  var end   = start.advance(1, 'month');
  var secs  = end.difference(start, 'second');

  // ── Numerator: OpenET monthly latent heat (J/m2 over the month) ──
  // OpenET ENSEMBLE is a native 30 m product, so the numerator is truly 30 m.
  var et_mm = ee.ImageCollection(OPENET_ENSEMBLE)
    .filterDate(start, end).filterBounds(bbox)
    .select(OPENET_BAND).mean().clip(bbox);
  var leJ = et_mm.multiply(LAMBDA).rename('le_J');
  // Raw numerator audit bands (advisory §4.3, 2026-08-04): et_mm/le_wm2_raw
  // carry OpenET's numerator UNMASKED by D-G or either denominator, so the
  // numerator itself stays independently auditable regardless of what the
  // mask or denominator logic does downstream. This is what the external
  // numerator-check investigation (HRC_numerator_check_findings_v1_2.md)
  // compared against tower LE directly — same units (mm, W/m2), same OpenET
  // asset/band, so a future re-check needs no separate export.
  var etMmRaw    = et_mm.rename('et_openet_mm_raw');
  var leWm2Raw   = leJ.divide(secs).rename('le_openet_wm2_raw');

  // ── Landsat scenes for the month (one filtered collection, reused) ──
  var raw = ee.ImageCollection(L8).merge(ee.ImageCollection(L9))
    .filterDate(start, end).filterBounds(bbox)
    .filter(ee.Filter.lt('CLOUD_COVER', CLOUD_COVER_MAX));
  var nScenes = raw.size();

  // Per-pixel clear-Landsat coverage fraction. A zero-image seed keeps the
  // sum a valid 1-band image even when the month has no scenes (Mead Dec,
  // Metolius Feb) — coverage then resolves to 0 -> low_coverage -> excluded.
  var clearCount = ee.ImageCollection([ee.Image(0).rename('c').toFloat()])
    .merge(raw.map(function(img) { return clearMask(img).rename('c').toFloat(); }))
    .sum();
  var coverage = clearCount.divide(ee.Number(nScenes).max(1)).clip(bbox).rename('coverage');

  // Clear-sky monthly composite of the 30 m radiative-surface bands. A fully-
  // masked band template guarantees the three bands exist even when the month
  // has zero clear scenes (Mead Dec, Metolius Feb) — otherwise .mean() of an
  // empty collection yields a 0-band image and every select() below throws.
  // The template is masked, so it never contributes to the mean.
  var bandTemplate = ee.Image([0, 0, 0]).rename(['albedo', 'lst', 'emis'])
    .toFloat().updateMask(ee.Image(0)).clip(bbox);
  var comp = raw.map(function(img) {
    var albedo = liangAlbedo(img);
    var lst    = img.select('ST_B10').multiply(ST_B10_SCALE).add(ST_B10_OFFSET).rename('lst');
    var emis   = img.select('ST_EMIS').multiply(ST_EMIS_SCALE).rename('emis');
    return albedo.addBands(lst).addBands(emis).updateMask(clearMask(img)).toFloat();
  }).merge(ee.ImageCollection([bandTemplate])).mean().clip(bbox);
  var albedo = comp.select('albedo');
  var lst    = comp.select('lst');
  var emis   = comp.select('emis');

  // ── ERA5-Land monthly radiation (J/m2 over the month, ~9 km) ──
  var era       = ee.ImageCollection(ERA5).filterDate(start, end).first();
  var swDownJ   = era.select('surface_solar_radiation_downwards_sum');
  var lwDownJ   = era.select('surface_thermal_radiation_downwards_sum');
  var rnAllskyJ = era.select('surface_net_solar_radiation_sum')
                     .add(era.select('surface_net_thermal_radiation_sum'));  // net thermal signed (gotcha 6)

  // ── Denominator A — clear-sky 30 m Rn (J/m2 over the month) ──
  //   net SW = SW_down × (1 − albedo)          [ERA5 magnitude, Landsat albedo]
  //   net LW = LW_down − eps·sigma·LST^4        [ERA5 down; Landsat up, daytime,
  //            W/m2 -> J via ×seconds — the script-31 promotion]
  var netSwJ = swDownJ.multiply(ee.Image(1).subtract(albedo));
  var lwUpW  = emis.multiply(SIGMA).multiply(lst.pow(4));   // W/m2 (daytime clear-sky)
  var lwUpJ  = lwUpW.multiply(secs);
  var netLwJ = lwDownJ.subtract(lwUpJ);
  var rnA_J  = netSwJ.add(netLwJ);

  // ── Denominator B — all-sky ERA5 magnitude × robust 30 m NET-SHORTWAVE texture ──
  //   Rn_B = Rn_ERA5_allsky × (Rn_sw / mean(Rn_sw over the ERA5 cell)),
  //   Rn_sw = SW_down × (1 − albedo_30m).
  // The handoff's example imposes the *full* Rn_A texture, but Rn_A's daytime-
  // overpass LST⁴ longwave loss collapses it toward (and below) zero in warm
  // bare-soil / dry months, so Rn_A/mean(Rn_A) is ill-conditioned and injects
  // huge spurious texture (it drove HRC_B to ~13 at Mead and −8 at Metolius once
  // those months were kept). Net shortwave is always positive and carries the
  // dominant albedo-driven 30 m pattern — a robust texture source that keeps B's
  // magnitude = ERA5. Rn_A's collapse is left FAITHFUL in denominator A for the
  // D2 comparison. The box (~10 km) is one ERA5 cell (~9 km), so the box-mean is
  // the cell-mean; a masked month (no Landsat) → null → safe-substituted to 1
  // and Rn_B stays masked (that month is excluded regardless).
  var boxMeanSw = netSwJ.reduceRegion({
    reducer: ee.Reducer.mean(), geometry: bbox, scale: MEAN_SCALE, maxPixels: 1e9
  }).values().get(0);
  var boxMeanSwSafe = ee.Number(ee.Algorithms.If(
    ee.Algorithms.IsEqual(boxMeanSw, null), 1, boxMeanSw));
  var rnB_J = rnAllskyJ.multiply(netSwJ).divide(boxMeanSwSafe);

  // ── Ground heat flux (D1: small at monthly scale; default 0). USE_G is a
  // wiring hook for a future ERA5-Land G source; 0 until then. ──
  var Gj = ee.Image(0);

  var availA_J = rnA_J.subtract(Gj).rename('availA_J');
  var availB_J = rnB_J.subtract(Gj).rename('availB_J');

  // ── Uniform D-G exclusion, per pixel (mirrors tower.py) ──
  // The mask is decided on the CLEAN all-sky ERA5 available energy (Rn_allsky −
  // G, magnitude-correct, ~9 km) — the exact analogue of the tower's measured
  // Rn − G. It must NOT use availA or availB: denominator A's clear-sky Rn
  // collapses toward zero in warm bare-soil / dry-summer months (the daytime-
  // overpass LST⁴ longwave loss, scaled to a full month, cancels net shortwave),
  // and availB inherits that collapse through the texture ratio Rn_A/mean(Rn_A).
  // Masking on availB therefore spuriously drops physically-valid months
  // (observed: Mead losing Feb/May/Oct/Nov; Tonzi/Metolius losing low-EF summer,
  // which then inflates their energy-weighted B). Rn_allsky has no such
  // pathology, so the pipeline reproduces the tower's own D-G month set.
  var availAllsky_J = rnAllskyJ.subtract(Gj);
  var availWm2 = availAllsky_J.divide(secs).rename('avail_wm2');

  // EF for the physical-bound test is the UNCLIPPED all-sky EF (like the tower's
  // ef_rn_g, which can read 17 in winter). Any masked input collapses the OR
  // chain to masked -> unmask(1) -> drop; no-Landsat months drop via coverage=0.
  var efUnclipped = leJ.divide(availAllsky_J);
  var efBad  = efUnclipped.lt(-EF_TOL).or(efUnclipped.gt(1 + EF_TOL));
  var lowE   = availWm2.lt(RN_MIN_WM2);
  var lowCov = coverage.lt(COVERAGE_MIN);
  var excluded = efBad.or(lowE).or(lowCov).unmask(1).clip(bbox).rename('excluded');

  return leJ
    .addBands(availA_J)
    .addBands(availB_J)
    // .toFloat() strips the degenerate literal type ee.Image(<number>) carries
    // (GEE infers min=max=that exact value, e.g. Jan's 2678400 vs Feb's
    // 2419200) — 12 months of that band, collected then summed to build
    // sumSecs, are technically non-homogeneous and Image.sample() (unlike
    // reduceRegion, which tolerated it in every console print so far) enforces
    // that strictly, failing the tile export with "Mismatched type for band
    // 'secs'". Same fix already used above for albedo/lst/emis.
    .addBands(ee.Image(secs).toFloat().rename('secs'))
    .addBands(availWm2)
    .addBands(efUnclipped.rename('ef_allsky'))   // all-sky EF used by the D-G bound test
    .addBands(coverage)
    .addBands(excluded)
    .addBands(etMmRaw)
    .addBands(leWm2Raw)
    .set({ month: month, n_scenes: nScenes });
}

// =====================================================================
// PART B — Per-site annual composite (D-F ratio-of-annual-sums)
// =====================================================================
// Returns numLE / denA / denB / sumSecs / monthsMasked images (reused by the
// footprint & member-spread stages) and the assembled tileImage.
function buildSite(site) {
  var bbox    = site.bbox;
  var monthly = ALL_MONTHS.map(function(m) { return monthlyProduct(bbox, m); });

  // Kept-month mask per image: excluded == 0. Sum numerator and denominator
  // over the SAME kept (pixel, month) set -> ratio-of-annual-sums (C1/D-F).
  var keep = function(mp, band) {
    return mp.select(band).updateMask(mp.select('excluded').eq(0));
  };
  var stack = function(band) {
    return ee.ImageCollection(monthly.map(function(mp) { return keep(mp, band); })).sum();
  };

  var numLE   = stack('le_J').rename('num_le_J');
  var denA    = stack('availA_J').rename('den_a_J');
  var denB    = stack('availB_J').rename('den_b_J');
  var sumSecs = stack('secs').rename('sum_secs');

  // months_masked (per pixel) = Σ of the 0/1 excluded flags (unmasked). Honest
  // per-pixel count; partial-cloud edge pixels legitimately drop more months.
  var monthsMasked = ee.ImageCollection(monthly.map(function(mp) {
    return mp.select('excluded');
  })).sum().rename('months_masked');

  // Annual EF, UNCLIPPED (so Phase 3 sees denominator A's clear-sky high bias).
  var efAnnualA   = numLE.divide(denA).rename('ef_annual_A');
  var efAnnualB   = numLE.divide(denB).rename('ef_annual_B');
  var hrcA        = efAnnualA.multiply(10).rename('hrc_A');
  var hrcB        = efAnnualB.multiply(10).rename('hrc_B');
  // Cooling Work (§4.6): energy-weighted mean latent-heat flux over kept months
  // = total latent-heat energy / total kept seconds (ratio-of-sums, C1-consistent).
  var leAnnualWm2 = numLE.divide(sumSecs).rename('annual_mean_le_wm2');

  // ── Q1 — capped, month-inclusive TILE-PRODUCT variant (RESOLVED 2026-08-05) ──
  // efAnnualA/B and hrcA/B above are the STRICT variant — they drop any month
  // failing the D-G physical-bound test (EF∉[-0.05,1.05]), which is correct for
  // the Phase-3 tower comparison (D-H needs identically-masked data on both
  // sides) but wrong for the PUBLISHED tile: it silently removes an irrigated
  // field's peak months (Mead Aug/Sep, mild advection, EF≈1.06-1.10) instead of
  // showing a physically-capped value. This block is a SEPARATE composite that
  // keeps every month with valid data — excluding only genuinely missing/
  // undefined months (avail<25 W/m² or coverage<0.50) — and caps each month's
  // own numerator at that month's own denominator, so no single month can push
  // the annual ratio past EF=1.0. Both the capped (published) and UNCAPPED
  // ("what it was capped from") values are kept so the cap is auditable, never
  // a silent overwrite. Never drop a month here for being physically too high.
  // Computed ONCE per month and reused below (mirrors how the strict variant
  // above reuses its precomputed 'excluded' band). The first version of this
  // block called the lt/or graph fresh inside stackTile/stackTileCapped/
  // monthsCapped — 7 redundant recomputations per month, 84 total — which was
  // enough to time out a single-footprint diagnostic print at US-Var. At the
  // scale of the real tile export (70k-120k pixels/site) that redundancy is a
  // much bigger risk, not just a print-formatting annoyance.
  var tileKeep = monthly.map(function(mp) {
    return mp.select('avail_wm2').lt(RN_MIN_WM2)
      .or(mp.select('coverage').lt(COVERAGE_MIN))
      .not();
  });
  // Honest month-drop count for the PUBLISHED variant. months_masked (below,
  // strict) counts every D-G exclusion including efBad — but efBad months are
  // capped-and-KEPT here, not dropped, so months_masked would overcount and
  // mislabel a capped month as a dropped one (the G7 "N months dropped" label
  // reads straight off this count — it has to match what the capped tile
  // actually excludes, which is only the missing/undefined lowE-or-lowCov
  // months, same set tileKeep encodes).
  var monthsMaskedTile = ee.ImageCollection(monthly.map(function(mp, i) {
    return tileKeep[i].not();
  })).sum().rename('months_masked_tile');
  var stackTile = function(band) {
    return ee.ImageCollection(monthly.map(function(mp, i) {
      return mp.select(band).updateMask(tileKeep[i]);
    })).sum();
  };
  var stackTileCapped = function(availBand) {
    return ee.ImageCollection(monthly.map(function(mp, i) {
      return mp.select('le_J').min(mp.select(availBand)).updateMask(tileKeep[i]);
    })).sum();
  };
  var monthsCapped = function(availBand) {
    return ee.ImageCollection(monthly.map(function(mp, i) {
      return mp.select('le_J').gt(mp.select(availBand)).and(tileKeep[i]);
    })).sum();
  };

  var numLE_tile = stackTile('le_J');
  var denA_tile  = stackTile('availA_J');
  var denB_tile  = stackTile('availB_J');
  var secs_tile  = stackTile('secs');

  // Cooling Work companion (migration 006's "magnitude, not efficiency"
  // framing), re-derived to match Q1: leAnnualWm2 above is still the STRICT
  // (months-dropped) figure, silently missing Mead's Aug/Sep peak — the exact
  // gap Q1 exists to close for the score. Unlike hrc_*_capped, this uses the
  // UNCAPPED numerator on purpose: capping bounds the EF ratio to a 0-10
  // scale, but a magnitude flux has no such ceiling, and physically the
  // latent heat OpenET reports was really moved regardless of whether the
  // ratio to available energy exceeds 1 that month.
  var leAnnualWm2_tile = numLE_tile.divide(secs_tile).rename('annual_mean_le_wm2_tile');

  var efAnnualA_uncapped = numLE_tile.divide(denA_tile).rename('ef_annual_A_uncapped');
  var efAnnualB_uncapped = numLE_tile.divide(denB_tile).rename('ef_annual_B_uncapped');
  var hrcA_uncapped = efAnnualA_uncapped.multiply(10).rename('hrc_A_uncapped');
  var hrcB_uncapped = efAnnualB_uncapped.multiply(10).rename('hrc_B_uncapped');

  var efAnnualA_capped = stackTileCapped('availA_J').divide(denA_tile).rename('ef_annual_A_capped');
  var efAnnualB_capped = stackTileCapped('availB_J').divide(denB_tile).rename('ef_annual_B_capped');
  var hrcA_capped = efAnnualA_capped.multiply(10).rename('hrc_A_capped');
  var hrcB_capped = efAnnualB_capped.multiply(10).rename('hrc_B_capped');

  var monthsCappedA = monthsCapped('availA_J').rename('months_capped_A');
  var monthsCappedB = monthsCapped('availB_J').rename('months_capped_B');

  var tileImage = efAnnualA.addBands(efAnnualB).addBands(hrcA).addBands(hrcB)
                           .addBands(leAnnualWm2).addBands(monthsMasked)
                           .addBands(efAnnualA_uncapped).addBands(efAnnualB_uncapped)
                           .addBands(hrcA_uncapped).addBands(hrcB_uncapped)
                           .addBands(efAnnualA_capped).addBands(efAnnualB_capped)
                           .addBands(hrcA_capped).addBands(hrcB_capped)
                           .addBands(monthsCappedA).addBands(monthsCappedB)
                           .addBands(leAnnualWm2_tile).addBands(monthsMaskedTile);

  return {
    monthly: monthly, numLE: numLE, denA: denA, denB: denB,
    tileImage: tileImage
  };
}

// Footprint ratio-of-sums HRC over a window (C1): Σ num / Σ den × 10.
function footprintHRC(numImg, denImg, fp) {
  var n = ee.Number(numImg.reduceRegion({
    reducer: ee.Reducer.sum(), geometry: fp, scale: SAMPLE_SCALE, maxPixels: 1e6
  }).values().get(0));
  var d = ee.Number(denImg.reduceRegion({
    reducer: ee.Reducer.sum(), geometry: fp, scale: SAMPLE_SCALE, maxPixels: 1e6
  }).values().get(0));
  return n.divide(d).multiply(10);
}

// =====================================================================
// PART C — Metolius OpenET six-member EF spread (D-E, R2 forest band)
// =====================================================================
// Per-member annual ratio-of-sums EF at the forest tower footprint, over the
// SAME D-G kept months and a SHARED denominator (B, magnitude-correct) — so the
// spread reflects OpenET model disagreement in the numerator, in honest HRC
// units. Reported as (max − min) × 10, attached to every Metolius tile.
function memberSpreadAtFootprint(site, built) {
  var t  = site.towers[0];
  var fp = ee.Geometry.Point([t.lon, t.lat]).buffer(FOOTPRINT_RADIUS_M);

  var denFp = ee.Number(built.denB.reduceRegion({
    reducer: ee.Reducer.sum(), geometry: fp, scale: SAMPLE_SCALE, maxPixels: 1e6
  }).values().get(0));

  var memberHRC = OPENET_MEMBERS.map(function(memberId) {
    var numImgs = ALL_MONTHS.map(function(m) {
      var start = ee.Date.fromYMD(YEAR, m, 1);
      var end   = start.advance(1, 'month');
      var et_mm = ee.ImageCollection(memberId)
        .filterDate(start, end).filterBounds(site.bbox)
        .select(OPENET_MEMBER_BAND).mean().clip(site.bbox);
      var kept = built.monthly[m - 1].select('excluded').eq(0);
      return et_mm.multiply(LAMBDA).updateMask(kept);
    });
    var numMember = ee.ImageCollection(numImgs).sum();
    var numFp = ee.Number(numMember.reduceRegion({
      reducer: ee.Reducer.sum(), geometry: fp, scale: SAMPLE_SCALE, maxPixels: 1e6
    }).values().get(0));
    return numFp.divide(denFp).multiply(10);   // HRC units
  });

  var lst = ee.List(memberHRC);
  return ee.Number(lst.reduce(ee.Reducer.max()))
    .subtract(ee.Number(lst.reduce(ee.Reducer.min())));
}

// =====================================================================
// PART D — Mead-only geeSEBAL turbulent EF (D-B) — SCAFFOLD
// =====================================================================
// EF_turbulent = LE / (LE + H) with H from an INDEPENDENT turbulent-flux model
// (geeSEBAL's temperature-gradient method), NOT the residual H = Rn−G−LE (which
// is circular — it just reproduces EF_A). That independence is the whole point
// of D-B, mirroring the tower's EF_turbulent vs EF_rn_g contrast.
//
// Wiring point: with RUN_GEESEBAL_H=true, return an annual ratio-of-sums
// EF_turbulent at the tower footprint for `month`. In the GEE Code Editor:
//   var geesebal = require('users/<geesebal-module>:...');   // official module
//   ... run geeSEBAL H on the same L8/L9 scenes as monthlyProduct() ...
// Kept behind the flag (default false) so the proven core exports regardless;
// this is the last Phase-2 item (handoff §8.4). Returns '' (empty CSV cell)
// wherever inapplicable — Mead-only, and only when the flag is on.
function meadTurbulentEF(site, tower, month) {
  if (!RUN_GEESEBAL_H || site.code !== 'mead_ne') { return ''; }
  // TODO(D-B): return geeSEBAL EF_turbulent at the tower footprint for `month`.
  return '';
}

// =====================================================================
// PART E — Per-site: diagnostics + tile CSV + footprint CSV
// =====================================================================

var tileSelectors = [
  'longitude', 'latitude',
  'ef_annual_A', 'ef_annual_B',     // STRICT variant — matches D-H, for Phase 3 only, not for display
  'hrc_A', 'hrc_B',
  'annual_mean_le_wm2',             // STRICT variant — for comparison only; see _tile below
  'months_masked',
  // Q1 (RESOLVED 2026-08-05) — the published/display variant: months kept and
  // capped at EF=1.0 instead of dropped. _uncapped is kept alongside so the cap
  // is auditable ("what it was capped from"), not a bare flag with no evidence.
  'ef_annual_A_uncapped', 'ef_annual_B_uncapped',
  'hrc_A_uncapped', 'hrc_B_uncapped',
  'ef_annual_A_capped', 'ef_annual_B_capped',
  'hrc_A_capped', 'hrc_B_capped',
  'months_capped_A', 'months_capped_B',
  'annual_mean_le_wm2_tile',        // Cooling Work, months-kept — the published figure
  'months_masked_tile',             // honest drop-count for the published variant — feeds G7
  'openet_member_spread',
  'region_code', 'data_source',
  'data_resolution_m',
  'source_window'
];

var footprintSelectors = [
  'tower_id', 'region_code', 'month',
  'ef_A_month', 'ef_B_month',
  'ef_turbulent_month',
  'n_landsat_scenes',
  'masked',
  // Permanent numerator audit (advisory §4.3, 2026-08-04). Raw OpenET,
  // UNMASKED by D-G or either denominator — same units the external
  // numerator-check investigation used, so a future audit reads this
  // column directly instead of re-deriving a one-off export.
  'et_openet_mm_raw', 'le_openet_wm2_raw',
  // Phase 3 handoff §3.1 (2026-08-06) — raw monthly sums (Landsat-valid-masked,
  // same mask as ef_A_month/ef_B_month), required for validate.py to re-aggregate
  // correctly over the D-H intersection. See note at the export site.
  'le_j_month', 'avail_a_j_month', 'avail_b_j_month'
];

print('======================================================================');
print('HRC 30 m pipeline — Phase 2. Aggregation: ratio-of-annual-sums (D-F).');
print('Mask: uniform D-G (EF∉[−0.05,1.05] | avail<25 W/m² | coverage<0.50).');
print('Active sites:', ACTIVE_SITES.map(function(s) { return s.code; }));
print('Run the export tasks (Tasks panel). DO NOT pick the D2 A/B winner (§6).');
print('======================================================================');

ACTIVE_SITES.forEach(function(site) {
  var built        = buildSite(site);
  var memberSpread = site.forest ? memberSpreadAtFootprint(site, built) : null;

  // ── D-G confirmation diagnostic (handoff §3.3: "compute the pipeline's own ──
  // valid-month set and confirm it matches"). Per month at the first tower
  // footprint: scene count, all-sky available energy, clear coverage, and the
  // pipeline's excluded call. The excluded months should match expectedLowEnergyMask.
  var fp0 = ee.Geometry.Point([site.towers[0].lon, site.towers[0].lat])
              .buffer(FOOTPRINT_RADIUS_M);
  // Values rounded so aggregate_array prints INLINE (feasibility.js trick) rather
  // than collapsing to "List (12 elements)". ef_allsky is the D-G bound-test EF
  // (OpenET LE / clean all-sky ERA5 Rn) — reading it per month shows exactly why
  // a month is dropped (>1.05 advective, <25 W/m² low-energy, or coverage<0.5).
  var round1 = function(x) { return ee.Number(x).multiply(10).round().divide(10); };
  var round2 = function(x) { return ee.Number(x).multiply(100).round().divide(100); };
  var diag = ee.FeatureCollection(ALL_MONTHS.map(function(m) {
    var mp = built.monthly[m - 1];
    var r  = mp.select(['avail_wm2', 'ef_allsky', 'coverage', 'excluded']).reduceRegion({
      reducer: ee.Reducer.mean(), geometry: fp0, scale: SAMPLE_SCALE, maxPixels: 1e6
    });
    return ee.Feature(null, {
      month: m, n_scenes: mp.get('n_scenes'),
      avail_wm2:     round1(r.get('avail_wm2')),
      ef_allsky:     round2(r.get('ef_allsky')),
      coverage:      round2(r.get('coverage')),
      excluded_frac: round2(r.get('excluded'))
    });
  }));
  print('── ' + site.code + ' — D-G mask diagnostic at ' + site.towers[0].id
        + ' (expected low-energy drop ' + JSON.stringify(site.expectedLowEnergyMask) + ') ──');
  print(site.code + ' n_scenes / month:',     diag.aggregate_array('n_scenes'));
  // Force inline printing (a list with a large winter EF spike collapses to
  // "List (12 elements)"); join the formatted values into one string instead.
  print(site.code + ' avail_wm2 / month:',
        diag.aggregate_array('avail_wm2').map(function(x) { return ee.Number(x).format('%.1f'); }).join('  '));
  print(site.code + ' ef_allsky / month:',
        diag.aggregate_array('ef_allsky').map(function(x) { return ee.Number(x).format('%.2f'); }).join('  '));
  print(site.code + ' coverage / month:',     diag.aggregate_array('coverage'));
  print(site.code + ' excluded_frac / month:', diag.aggregate_array('excluded_frac'));

  // ── Tile CSV (one row per 30 m cell) ──
  var tiles = built.tileImage.sample({
    region: site.bbox, scale: SAMPLE_SCALE, projection: 'EPSG:4326',
    geometries: true, seed: 42
  }).map(function(f) {
    var c = f.geometry().coordinates();
    return f.set({
      longitude:            ee.Number(c.get(0)),
      latitude:             ee.Number(c.get(1)),
      openet_member_spread: site.forest ? memberSpread : '',   // populated at Metolius only (D-E)
      region_code:          site.code,
      data_source:          site.dataSource,
      data_resolution_m:    30,
      source_window:        SOURCE_WINDOW
    });
  });

  Export.table.toDrive({
    collection:     tiles,
    description:    'hrc_30m_' + site.code + '_tiles',
    folder:         'EarthHRC',
    fileNamePrefix: 'hrc_30m_' + site.code + '_tiles',
    fileFormat:     'CSV',
    selectors:      tileSelectors
  });

  // ── Footprint CSV (one row per tower per month) ──
  // ef_*_month = footprint ratio-of-sums EF (C1), clipped [0,1] for display —
  // the clip only touches winter months, which carry `masked`=true and Phase 3
  // drops. `masked` is the pipeline's OWN D-G call (D-H); Phase 3 intersects it
  // with the tower's excluded months — the pipeline does NOT bake in tower drops.
  var fpRows = [];
  site.towers.forEach(function(t) {
    var fp = ee.Geometry.Point([t.lon, t.lat]).buffer(FOOTPRINT_RADIUS_M);
    ALL_MONTHS.forEach(function(m) {
      var mp = built.monthly[m - 1];
      // Numerator masked to the Landsat-valid footprint pixels so num & den
      // sum over the same pixels (availA/availB share one mask).
      var leMasked = mp.select('le_J').updateMask(mp.select('availA_J').mask());
      var sums = leMasked.addBands(mp.select(['availA_J', 'availB_J'])).reduceRegion({
        reducer: ee.Reducer.sum(), geometry: fp, scale: SAMPLE_SCALE, maxPixels: 1e6
      });
      var leSum = ee.Number(sums.get('le_J'));
      var efA = leSum.divide(ee.Number(sums.get('availA_J'))).min(1).max(0);
      var efB = leSum.divide(ee.Number(sums.get('availB_J'))).min(1).max(0);
      var exclFrac = ee.Number(mp.select('excluded').reduceRegion({
        reducer: ee.Reducer.mean(), geometry: fp, scale: SAMPLE_SCALE, maxPixels: 1e6
      }).values().get(0));

      // Raw numerator audit (advisory §4.3) — deliberately UNMASKED (no D-G
      // exclusion, no Landsat-validity mask). This is OpenET's numerator
      // exactly as OpenET published it, so the pipeline can never again go
      // un-auditable against a future tower-comparison the way the A-vs-B
      // denominator contest was.
      var rawVals = mp.select(['et_openet_mm_raw', 'le_openet_wm2_raw']).reduceRegion({
        reducer: ee.Reducer.mean(), geometry: fp, scale: SAMPLE_SCALE, maxPixels: 1e6
      });

      fpRows.push(ee.Feature(null, {
        tower_id:           t.id,
        region_code:        site.code,
        month:              m,
        ef_A_month:         efA,
        ef_B_month:         efB,
        ef_turbulent_month: meadTurbulentEF(site, t, m),   // Mead only (D-B); else null
        n_landsat_scenes:   mp.get('n_scenes'),
        masked:             exclFrac.gte(0.5),              // pipeline's own D-G call (D-H)
        et_openet_mm_raw:   rawVals.get('et_openet_mm_raw'),
        le_openet_wm2_raw:  rawVals.get('le_openet_wm2_raw'),
        // Phase 3 handoff §3.1 (2026-08-06) — raw monthly sums, already computed
        // above and previously discarded. Required for validate.py to compute a
        // genuine ratio-of-annual-sums (C1/D-F) over the D-H intersection month
        // subset: Σle_j_month / Σavail_*_j_month over exactly the kept months,
        // not a mean of the ef_A_month/ef_B_month ratios (which would silently
        // reintroduce the mean-of-monthly-ratios bug D-F exists to prevent).
        le_j_month:      leSum,
        avail_a_j_month: sums.get('availA_J'),
        avail_b_j_month: sums.get('availB_J')
      }));
    });
  });

  Export.table.toDrive({
    collection:     ee.FeatureCollection(fpRows),
    description:    'hrc_30m_' + site.code + '_footprint',
    folder:         'EarthHRC',
    fileNamePrefix: 'hrc_30m_' + site.code + '_footprint',
    fileFormat:     'CSV',
    selectors:      footprintSelectors
  });

  // ── Per-tower footprint annual HRC sanity (both denominators) ──
  // Mead (§8.3): irrigated (Ne1 5.70, Ne2 6.01) > rainfed (Ne3 4.81); tower
  // bracketed by A (biased high) and B. DO NOT pick a D2 winner here (§6).
  // Tonzi/Vaira (D-J): annual Ton≈Var (2.95 vs 2.83) — the summer curve, not
  // the annual scalar, carries the signal; check the footprint CSV months 6–9.
  print('── ' + site.code + ' — footprint annual HRC (ratio-of-annual-sums) ──');
  site.towers.forEach(function(t) {
    var fp = ee.Geometry.Point([t.lon, t.lat]).buffer(FOOTPRINT_RADIUS_M);
    print(t.id + ' [' + t.regime + '] tower=' + t.towerHRC + '  pipeline HRC_A:',
          footprintHRC(built.numLE, built.denA, fp),
          ' HRC_B:', footprintHRC(built.numLE, built.denB, fp));
  });

  // Q1 (RESOLVED 2026-08-05) — capped vs. strict-and-uncapped, at each footprint.
  // hrc_B_capped is the published value; hrc_B_uncapped is what it was capped
  // FROM; hrc_B (strict) is the Phase-3/validate.py number, which still drops
  // those months — the gap between capped and strict IS Q1's effect, visible.
  print('── ' + site.code + ' — Q1 capped tile-product variant (denominator B) ──');
  site.towers.forEach(function(t) {
    var fp = ee.Geometry.Point([t.lon, t.lat]).buffer(FOOTPRINT_RADIUS_M);
    var q1 = built.tileImage.select(['hrc_B', 'hrc_B_uncapped', 'hrc_B_capped', 'months_capped_B'])
      .reduceRegion({ reducer: ee.Reducer.mean(), geometry: fp, scale: SAMPLE_SCALE, maxPixels: 1e6 });
    print(t.id + ' strict(dropped)=', q1.get('hrc_B'),
          ' uncapped(kept, no clip)=', q1.get('hrc_B_uncapped'),
          ' capped(published)=', q1.get('hrc_B_capped'),
          ' months_capped=', q1.get('months_capped_B'));
  });

  if (site.forest) {
    print('── ' + site.code + ' OpenET six-member spread at ' + site.towers[0].id
          + ' footprint (HRC units, D-E band):', memberSpread);
  }
});

// ── Map preview (Mead) ───────────────────────────────────────────────
var mead      = SITES[0];
var meadBuilt = buildSite(mead);
Map.centerObject(mead.bbox, 12);
var hrcViz = { min: 0, max: 10, palette: ['8B2500', 'D4550A', 'F4A623', 'C8D84A', '1D9E75'] };
Map.addLayer(meadBuilt.tileImage.select('hrc_A'), hrcViz, 'Mead HRC_A (clear-sky, 30 m)');
Map.addLayer(meadBuilt.tileImage.select('hrc_B'), hrcViz, 'Mead HRC_B (all-sky texture, 30 m)', false);
Map.addLayer(meadBuilt.tileImage.select('months_masked'),
  { min: 0, max: 6, palette: ['1D9E75', 'F4A623', '8B2500'] }, 'Mead months_masked', false);
ACTIVE_SITES.forEach(function(site) {
  Map.addLayer(site.bbox, { color: 'white' }, site.code + ' bbox', false);
  site.towers.forEach(function(t) {
    Map.addLayer(ee.Geometry.Point([t.lon, t.lat]).buffer(FOOTPRINT_RADIUS_M),
                 { color: 'cyan' }, site.code + ' ' + t.id + ' footprint', false);
  });
});

print('── Next steps ──');
print('1. Mead sanity: irrigated (Ne1/Ne2) > rainfed (Ne3); tower bracketed by A/B.');
print('2. D-G diagnostic: excluded months should match expectedLowEnergyMask.');
print('3. Tonzi/Vaira (D-J): confirm summer months 6–9 diverge (savanna > grass)');
print('   in the footprint CSV — the annual scalars are near-equal by design.');
print('4. Run the six export tasks; Phase 3 adjudicates A vs B over the');
print('   pipeline-valid ∩ tower-valid intersection (D-H). Do NOT pick here.');
print('5. geeSEBAL H (D-B) is scaffolded (RUN_GEESEBAL_H=false) — wire it last.');
