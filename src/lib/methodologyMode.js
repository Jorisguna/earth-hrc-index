// methodologyMode.js — v2.1.1 / v2.2 selection helpers
//
// The app supports two methodology versions side-by-side per tile:
//   - v2.1.1  : pure evaporative-fraction score (tile.hrc_score)
//   - v2.2    : evaporative-fraction × albedo modifier (tile.hrc_score_v2_2)
//
// Per HRC_higher_fidelity_methodology_v2_2.md §7.13.1, every v2.2 tile
// also carries its v2.1.x value in hrc_score, so the v2.1.1 mode always
// has a value to display.
//
// In v2.2 mode for an ecoregion whose trust gate failed:
//   - albedo_modifier_status === 'disabled'
//   - hrc_score_v2_2 falls back to 10 × EF (identical to v2.1.1)
// We display the v2.2 value as the headline anyway, since v2.2 is the
// selected methodology — but the modifier-status row in the card spells
// out which ecoregions are running on the fallback so the user can see
// the trust mechanism working.

export const METHODOLOGY_MODES = ['v2.2', 'v2.1.1']

export function hasV22Data(tile) {
  return tile && tile.hrc_score_v2_2 != null
}

// The headline score to display under the selected methodology mode.
// Falls back to v2.1.1 when v2.2 data is absent (e.g., legacy tiles,
// or tiles outside the IDF v2.2 deployment).
export function getActiveScore(tile, methodologyMode) {
  if (!tile) return null
  if (methodologyMode === 'v2.2' && tile.hrc_score_v2_2 != null) {
    return tile.hrc_score_v2_2
  }
  return tile.hrc_score
}

// The ecoregion reference for the restoration-gap display. Mirrors
// getActiveScore's fallback: v2.2 mode uses reference_p90_v2_2 when
// available; otherwise the v2.1.x reference embedded as hrc_reference.
export function getActiveReference(tile, methodologyMode, gapMode = 'intact') {
  if (!tile) return null
  if (gapMode === 'historical') return tile.hrc_historical_reference ?? null

  if (methodologyMode === 'v2.2' && tile.reference_p90_v2_2 != null) {
    return tile.reference_p90_v2_2
  }
  // v2.1.x mode (or v2.2 fallback when reference_p90_v2_2 is null):
  // prefer the explicit hrc_reference column over reconstructing from
  // score + gap, because the gap is floored at 0 when score ≥ reference
  // (which would make `score + gap` return the score, not the reference).
  if (tile.hrc_reference != null) return tile.hrc_reference
  const v211Score = tile.hrc_score
  const v211Gap   = tile.restoration_gap
  if (v211Score != null && v211Gap != null) return v211Score + v211Gap
  return null
}

// The restoration-gap value: max(reference − score, 0). Returns null
// when either side is missing or when the modifier is disabled in a
// way that breaks the v2.2 reference (no reference_p90_v2_2 stored).
export function getActiveGap(tile, methodologyMode, gapMode = 'intact') {
  if (!tile) return null
  if (gapMode === 'historical') return tile.restoration_gap_historical ?? null

  if (methodologyMode === 'v2.2' && tile.reference_p90_v2_2 != null
      && tile.hrc_score_v2_2 != null) {
    return Math.max(tile.reference_p90_v2_2 - tile.hrc_score_v2_2, 0)
  }
  return tile.restoration_gap ?? null
}

// Plain-language label for the modifier status. Returns null when
// the tile has no v2.2 data at all (so the row is hidden, not shown
// as "unknown").
export function modifierStatusText(tile) {
  if (!tile || tile.albedo_modifier_status == null) return null
  if (tile.albedo_modifier_status === 'enabled') {
    return 'Albedo modifier active'
  }
  return 'Albedo modifier inactive — insufficient reference data'
}

// Plain-language explanation of each disabled reason. Used in the
// card row tooltip / secondary text. Returns null when the modifier
// is enabled or the tile has no v2.2 fields populated.
export function disabledReasonText(tile) {
  if (!tile || tile.albedo_modifier_status !== 'disabled') return null
  switch (tile.albedo_modifier_disabled_reason) {
    case 'insufficient_samples':
      return 'Fewer than 20 valid protected-area centroids in this ecoregion — the local reference cannot be computed reliably.'
    case 'noisy_reference':
      return 'The intact-reference albedo varies too much across the ecoregion (interquartile range ≥ 0.10) to use as a stable benchmark.'
    case 'low_pa_coverage':
      return 'Less than 5% of this ecoregion is protected — not enough intact land to derive a representative reference.'
    case 'low_intact_coverage':
      return 'Less than 5% of this ecoregion is Hansen-defined intact forest — not enough untouched land to derive a representative reference.'
    case 'cryosphere_biome_phase2_deferred':
      return 'Cryosphere biome — two-sided albedo handling is deferred to Phase 2; the score falls back to the evaporative-fraction-only formula.'
    default:
      return tile.albedo_modifier_disabled_reason || null
  }
}
