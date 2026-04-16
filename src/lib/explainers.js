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

How it is calculated:
A linear regression is fitted to the monthly HRC values over a rolling 24-month window. The slope of that regression — the rate of change — is then normalised against the historical variability of the ecoregion, so that the score means the same thing regardless of whether the location is a stable boreal forest or a seasonally variable tropical grassland.

Trends with low statistical confidence (p > 0.10) are shown as 0 rather than as a misleading signal.`,
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
