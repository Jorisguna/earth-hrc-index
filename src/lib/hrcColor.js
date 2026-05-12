// Returns an [R, G, B] array for a given HRC score (0–10)
// Palette from the HRC Index Technical Whitepaper v1.0
export function hrcColor(score) {
  if (score === null || score === undefined) return [100, 100, 100]
  if (score < 2) return [139, 37, 0]    // deep red — severely degraded
  if (score < 4) return [212, 85, 10]   // amber red
  if (score < 6) return [244, 166, 35]  // amber
  if (score < 8) return [200, 216, 74]  // yellow green
  return [29, 158, 117]                 // teal — high capacity
}

// Returns a hex colour string for a trend score (–5 to +5)
export function trendColor(score) {
  if (score === null || score === undefined) return '#999'
  if (score < -3) return '#C0392B'
  if (score < -1) return '#E67E22'
  if (score < 1)  return '#888'
  if (score < 3)  return '#27AE60'
  return '#1A7A4C'
}

// Returns an [R, G, B] array for a given restoration gap value
// (0 = at reference, higher = more degraded).
// 12-step ramp at 0.2 increments — finer differentiation than the
// previous 5-step ramp so neighbouring tiles in the 0–2 range render
// in visibly distinct shades.
export function gapColor(gap) {
  if (gap === null || gap === undefined) return [136, 135, 128] // #888780 — no data
  if (gap <= 0.05) return [8, 80, 65]      // #085041 — at reference
  if (gap < 0.2)   return [29, 158, 117]   // #1D9E75 — very minor
  if (gap < 0.4)   return [115, 187, 96]   // #73BB60
  if (gap < 0.6)   return [200, 216, 74]   // #C8D84A
  if (gap < 0.8)   return [222, 191, 54]   // #DEBF36
  if (gap < 1.0)   return [244, 166, 35]   // #F4A623
  if (gap < 1.2)   return [232, 130, 25]   // #E88219
  if (gap < 1.4)   return [220, 95, 15]    // #DC5F0F
  if (gap < 1.6)   return [200, 75, 10]    // #C84B0A
  if (gap < 1.8)   return [180, 60, 5]     // #B43C05
  if (gap < 2.0)   return [160, 50, 5]     // #A03205
  return [139, 37, 0]                       // #8B2500 — severe (2.0+)
}

// Returns a plain-English label for an HRC score
export function hrcLabel(score) {
  if (score === null || score === undefined) return 'Unknown'
  if (score < 2) return 'Severely degraded'
  if (score < 4) return 'Degraded'
  if (score < 6) return 'Moderate'
  if (score < 8) return 'Healthy'
  return 'High capacity'
}
