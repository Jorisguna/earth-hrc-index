// Plain-language explainers for every metric in the HRC Index.
// Sourced from the HRC Index Technical Whitepaper v1.0.
// Edit the body text here to update explainers across the whole app.

export const explainers = {
  hrcScore: {
    title: 'HRC Score — Heat Regulation Capacity',
    body: `The HRC score measures how effectively a location converts incoming solar energy into biological cooling, rather than letting it accumulate as heat.

It is scored from 0 to 10:
  • 0 means none of the available solar energy is being used for cooling — the surface is baking.
  • 10 means all available energy is being channelled into evaporation and transpiration — the surface is functioning as a living cooling system.

How it is calculated:
The score is the evaporative fraction multiplied by 10. The evaporative fraction is the ratio of latent heat flux (energy used by water evaporation and plant transpiration) to net radiation (total incoming solar energy).

  HRC = (Latent heat flux ÷ Net radiation) × 10

Reference points:
  • ~6.5–6.8 — estimated pre-industrial global mean
  • ~5.8 — current global mean (land surfaces)
  • 6.5–8.0 — healthy forests and wetlands
  • 1.0–2.5 — degraded or paved urban surfaces`,
  },

  tilesLoaded: {
    title: 'Tiles — What is a tile?',
    body: `A tile is a single geographic data point in the HRC Index. Think of the Earth's land surface divided into a grid — each cell in that grid is a tile.

In this pilot system, each tile represents approximately 9 km² of land surface. The data comes from ERA5, the European Centre for Medium-Range Weather Forecasts global reanalysis model, which provides complete global coverage even in areas with no direct satellite observation.

Every tile carries:
  • An HRC score (current heat regulation capacity)
  • A trend score (direction of change over 24 months)
  • A confidence grade (how the score was calculated)
  • An ecoregion and biome classification
  • Energy balance components (latent heat, net radiation, soil moisture)

The full HRC Index system uses H3 hexagonal tiles at seven nested scales, from planetary realm level down to individual parcels approaching 1 m².`,
  },

  trend: {
    title: 'Trend Score',
    body: `The trend score shows whether a location's heat regulation capacity is improving or degrading over time, and how fast.

It runs from −5 to +5:
  • +4 to +5 — rapidly improving (significant restoration signal)
  • +1 to +3 — slowly improving (positive trajectory)
  •  0         — stable, or insufficient data to determine direction
  • −1 to −3 — slowly degrading (watch category)
  • −4 to −5 — rapidly degrading (intervention priority)

Use the trend window toggle to switch between the 24-month and 60-month methodologies. Each answers a slightly different question about how the land is changing.`,
  },

  trend24m: {
    title: 'Trend Score — 24-Month Window',
    body: `The 24-month trend measures the direction of HRC change over the most recent 2-year period.

How it is calculated:
A linear regression is fitted to monthly HRC values over 24 consecutive months. The slope — the rate of change in HRC per year — is normalised to a −5 to +5 scale where 0.5 HRC units/year equals a trend score of 1.

Strengths:
  • More responsive to recent land use changes and restoration interventions
  • Useful for detecting events that have happened in the past 1–2 years
  • Higher temporal resolution signal

Limitations:
  • A short window is more sensitive to year-to-year climate variability — a single drought year can produce a degradation signal that does not represent structural land change
  • Less statistically stable than longer windows, particularly for ERA5 Tier C data

Best used for: Recent event detection — new deforestation, active restoration, urban expansion within the past two years.`,
  },

  trend60m: {
    title: 'Trend Score — 60-Month Deseasonalised',
    body: `The 60-month trend uses a 5-year window with deseasonalisation applied before regression — the scientifically preferred method for ERA5 Tier C data.

How it is calculated:
For each month in the 5-year record, the climatological mean for that calendar month (the average of all 5 Januaries, all 5 Februaries, etc.) is subtracted before the regression is fitted. This removes the seasonal cycle — the summer/winter HRC swing — so the regression measures only year-on-year structural change.

  Anomaly = observed HRC − long-run monthly mean
  Trend = linear regression slope on anomalies × 12 months ÷ 0.5

Current data window: June 2018 – May 2023.

Strengths:
  • Far more statistically stable than the 24-month window
  • Seasonal noise (summer highs, winter lows) is fully removed before regression
  • The standard approach used in GLEAM and MODIS land degradation literature
  • Reliably distinguishes genuine land condition change from climate variability

Limitations:
  • Slower to reflect very recent changes — a restoration project completed 12 months ago may not yet register clearly in a 5-year trend

Best used for: Identifying structural, multi-year trends in land surface condition. The recommended window for interpreting ERA5 Tier C data.`,
  },

  confidenceTier: {
    title: 'Confidence Tier',
    body: `The confidence tier tells you what data was used to calculate the HRC score and how much weight to give it. No tile is ever blank — every location on Earth always has a score. The tier is the system's way of being honest about how that score was produced.

Tier A — Direct observation
Source: Constellr thermal infrared + Planet Labs multispectral + ECOSTRESS cross-validation.
The evaporative fraction is directly measured from satellite. The most reliable score.

Tier B — Composite estimate
Source: Sentinel-2 + Landsat thermal + SMAP soil moisture.
Evapotranspiration is estimated using the SEBAL algorithm rather than directly measured. Well-validated but one step removed from direct observation.

Tier C — Reanalysis model
Source: ERA5 meteorological reanalysis + JULES land surface model.
No direct satellite thermal observation — the score is modelled from weather data. Covers 100% of global land at all times, including persistent cloud cover and polar regions.

All current pilot tiles are Tier C. Tier A and B coverage enters the system in Phase 2 when Constellr and Planet Labs data is integrated.`,
  },

  ecoregion: {
    title: 'Ecoregion',
    body: `An ecoregion is a land area defined by its characteristic combination of climate, soils, vegetation, and wildlife — essentially, the ecological personality of a place.

The HRC Index uses the RESOLVE Ecoregions 2017 dataset, which divides the Earth's land surface into 846 terrestrial ecoregions. This is a peer-reviewed, open-access scientific standard used in conservation finance, insurance risk modelling, and international climate reporting.

Why ecoregions matter for HRC scoring:
An HRC score of 5.5 means very different things in different places. In the Sonoran Desert, 5.5 is close to the biological maximum — the climate simply doesn't allow much evaporation. In the Congo Basin rainforest, 5.5 is severe degradation — a healthy Congo tile should score 8.5 or above.

The ecoregion gives the score its context. Every tile's HRC score is calibrated against the intact reference sites within its own ecoregion, so the score reflects how the location is performing relative to what is actually achievable there.`,
  },

  biome: {
    title: 'Biome',
    body: `A biome is a broad ecological zone grouping multiple ecoregions with the same dominant vegetation type and climate regime — tropical forest, temperate grassland, Mediterranean shrubland, desert, and so on.

The HRC Index uses 14 biome classifications from the RESOLVE 2017 framework.

Why biomes matter:
Different biomes cool the Earth through fundamentally different mechanisms:

  • Tropical forests — cool primarily through evapotranspiration (plants pumping water)
  • Temperate forests — evapotranspiration + canopy shading
  • Grasslands — soil moisture retention
  • Deserts — albedo (reflectivity) dominates; biological cooling is limited by water
  • Urban areas — sensible heat reduction (cool roofs, permeable surfaces, water features)
  • Coastal wetlands — evapotranspiration + thermal mass + albedo

The dominant cooling mechanism determines what restoration or intervention approach is physically coherent for a given location. The biome classification is the first filter for matching places to solutions.`,
  },

  restorationGap: {
    title: 'Restoration Gap',
    body: `The restoration gap is the difference between what a location is currently doing and what the best intact sites in its ecoregion are achieving.

  Restoration gap = Ecoregion intact reference − This tile's current score

The reference is the 90th percentile HRC score of tiles within formally protected areas (national parks, nature reserves, IUCN categories I–IV) in the same ecoregion. These are the best currently observable biological performances in that ecoregion — not a theoretical ideal, but something that actually exists on Earth right now.

How to read it:
  • A gap of 0 — this location is performing at the level of the best intact sites in its ecoregion.
  • A gap of +0.6 — this location could recover 0.6 HRC points if restored to intact condition.
  • A gap of +3.5 — substantial degradation with significant recovery potential.

This is the most actionable number in the system. It tells investors, restoration practitioners, and municipal planners not just how degraded a place is, but how much cooling capacity could be recovered — and therefore what the return on a restoration investment could be in physical terms.`,
  },

  priorityTiles: {
    title: 'Priority Tiles — Intervention Threshold',
    body: `A priority tile is any location where the restoration gap exceeds 1.0 HRC points.

A gap of 1.0 means the location is performing more than one full unit below the best intact sites in its ecoregion. At this threshold, the degradation is large enough to be ecologically meaningful and potentially recoverable through active restoration or land management change.

Priority tiles are the most actionable locations in the system:
  • They have demonstrated cooling capacity that has been lost
  • They sit within an ecoregion where recovery to a higher level is proven to be possible
  • They represent the highest return locations for restoration investment in physical terms

Tiles with a gap below 1.0 may still benefit from protection or light management, but they are performing reasonably close to their ecological potential.`,
  },

  atReference: {
    title: 'At Reference — Performing at Ecoregion Potential',
    body: `A tile is classed as "at reference" when its restoration gap is 0.1 or less — meaning it is performing within 0.1 HRC points of the best intact sites in its ecoregion.

These tiles represent the ecological benchmark for their landscape type. They are:
  • The most intact remaining sites in their ecoregion
  • The reference points used to calculate restoration gaps for all other tiles
  • Locations where the priority is protection rather than restoration

The reference is defined as the 90th percentile HRC score of tiles within formally protected areas (national parks, nature reserves, IUCN categories I–IV) within the same ecoregion. It is not a theoretical maximum — it is a level that demonstrably exists on Earth today.

Protecting at-reference tiles is as important as restoring degraded ones: they are the ecological baseline the entire scoring system depends on.`,
  },

  ecoregionReference: {
    title: 'Ecoregion Reference Score',
    body: `The ecoregion reference is the HRC score that the best intact sites in this ecoregion are currently achieving. It represents the ecological ceiling — the maximum biological cooling capacity that is realistically attainable for this landscape type under current climate conditions.

How it is calculated:
The reference is the 90th percentile HRC score of tiles within formally protected areas (IUCN categories I–IV) in the same ecoregion. This means 90% of intact, protected sites in this ecoregion score at or below this level — it is achievable, but represents high ecological performance.

Why it matters:
  • A Mojave desert reference of ~2.2 confirms that low HRC scores in arid land are ecologically correct — not degraded
  • A coastal chaparral reference of ~3.6 means LA tiles scoring 2.4 have genuinely lost cooling capacity relative to what intact chaparral achieves
  • The restoration gap is simply: Reference − This tile's current score

The reference is recalculated as new data enters the system. It is not fixed — it reflects the current state of the best remaining natural sites in each ecoregion.`,
  },

  historicalBaseline: {
    title: 'Historical Baseline — 2001–2010 Spring Mean',
    body: `The historical baseline is the mean spring (March–May) HRC score for this tile over the decade 2001–2010, computed from the same ERA5 reanalysis dataset used for current scores.

How it is calculated:
For each year from 2001 to 2010, the March, April, and May monthly HRC values are computed using the standard evaporative fraction formula. The mean of all 30 monthly values (10 years × 3 months) gives the baseline.

  HRC = (Latent heat flux ÷ Net radiation) × 10
  Baseline = mean of March–May HRC values, 2001–2010

Why spring?
Spring (March–May) is the season when vegetation activity is ramping up and evapotranspiration is most sensitive to land condition changes. It is the window that most clearly distinguishes degraded land from recovering or intact land in temperate climates like Wales.

Change since baseline:
  • A negative value (orange) means this tile is cooling less effectively than it was in 2001–2010 — a signal of land degradation, vegetation loss, or drying.
  • A positive value (green) means this tile has improved its cooling capacity since the baseline period — a signal of recovery, afforestation, or improved land management.
  • Near zero means the land is in roughly the same condition as the early 2000s.

Data source: ECMWF ERA5-Land daily aggregates (Tier C reanalysis). The baseline uses identical methodology to current scores so comparisons are internally consistent.

Note: The historical baseline is currently available for Wales and the San Francisco Bay Area.`,
  },

  pmCeiling: {
    title: 'PM Ceiling — Penman-Monteith Physical Maximum',
    body: `The Penman-Monteith (PM) ceiling is the theoretical upper bound on evaporative cooling that the local climate can physically support, assuming perfect land cover and unlimited water supply.

It answers a different question from the ecoregion reference or historical baseline: not "what have these sites achieved?" but "what is the absolute physical maximum this climate allows?"

How it is calculated:
The FAO-56 Penman-Monteith reference evapotranspiration equation is applied using ERA5 climate variables over the same 60-month window (June 2018 – May 2023) used for current HRC scores:

  ETo = (0.408 × Δ × Rn + γ × (900/(T+273)) × u₂ × (es−ea))
        ÷ (Δ + γ × (1 + 0.34 × u₂))

Where:
  • Δ = slope of the saturation vapour pressure curve
  • Rn = net radiation (W/m²)
  • γ = psychrometric constant
  • T = mean temperature (°C)
  • u₂ = wind speed at 2m (m/s)
  • es = saturation vapour pressure (kPa)
  • ea = actual vapour pressure from dewpoint (kPa)

The PM-ET is converted to a latent heat flux (W/m²) and divided by net radiation to give the EF ceiling, which is multiplied by 10 to give the HRC ceiling.

How to interpret the gap to ceiling:
  • A gap to ceiling of +1.5 means the land could recover 1.5 HRC points with optimal restoration — but even with perfect land cover, climate limits prevent it going higher
  • The ceiling gap is always larger than the ecoregion reference gap — it represents the full physical opportunity, not just what other sites have achieved

Why it matters:
The PM ceiling is the number relevant to investors asking the maximum possible return on a restoration investment. The ecoregion reference shows what is currently achievable; the ceiling shows what physics permits.`,
  },

  evaporativeFraction: {
    title: 'Evaporative Fraction',
    body: `The evaporative fraction is the raw physical measurement that the HRC score is built on. It is a fundamental quantity in surface energy balance science.

  Evaporative fraction (EF) = Latent heat flux ÷ Net radiation

  • Latent heat flux (λE) — the energy used by evaporation from soils and transpiration from plants. This is the Earth's primary biological cooling mechanism.
  • Net radiation (Rn) — the total solar energy arriving at the surface after reflection.

The evaporative fraction tells you what fraction of available solar energy is being metabolised through the water cycle rather than accumulating as heat.

Reference values:
  • 0.65–0.80 — healthy forests and wetlands (HRC 6.5–8.0)
  • ~0.58 — current global mean over land (HRC ~5.8)
  • 0.10–0.25 — degraded or paved surfaces (HRC 1.0–2.5)

The HRC score is simply the evaporative fraction multiplied by 10, making it easier to read and communicate while preserving the underlying physics exactly.`,
  },
}
