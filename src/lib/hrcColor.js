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

// Returns a plain-English label for an HRC score
export function hrcLabel(score) {
  if (score === null || score === undefined) return 'Unknown'
  if (score < 2) return 'Severely degraded'
  if (score < 4) return 'Degraded'
  if (score < 6) return 'Moderate'
  if (score < 8) return 'Healthy'
  return 'High capacity'
}
