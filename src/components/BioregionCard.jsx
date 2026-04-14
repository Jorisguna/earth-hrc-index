import { trendColor, hrcLabel } from '../lib/hrcColor'

function fmt(val, decimals = 2) {
  if (val === null || val === undefined) return '—'
  return Number(val).toFixed(decimals)
}

function TrendArrow({ score }) {
  if (score === null || score === undefined) return <span style={{ color: '#999' }}>— unknown</span>
  const color = trendColor(score)
  const arrow = score > 0 ? '▲' : score < 0 ? '▼' : '▶'
  const label = score > 0 ? 'improving' : score < 0 ? 'degrading' : 'stable'
  return (
    <span style={{ color }}>
      {arrow} {fmt(score, 1)} ({label})
    </span>
  )
}

export default function BioregionCard({ tile, onClose }) {
  if (!tile) return null

  const hrc = tile.hrc_score
  const label = hrcLabel(hrc)

  return (
    <div className="bioregion-card">
      <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>

      <div className="hrc-score-block">
        <span className="hrc-score-number">{fmt(hrc)}</span>
        <span className="hrc-score-label">HRC Score</span>
        <span className="hrc-score-status">{label}</span>
      </div>

      <div className="card-section">
        <div className="card-row">
          <span className="card-key">Trend</span>
          <span className="card-val"><TrendArrow score={tile.trend_score} /></span>
        </div>
        <div className="card-row">
          <span className="card-key">Confidence tier</span>
          <span className="card-val"><span className="tier-badge">{tile.confidence_tier || 'C'}</span></span>
        </div>
      </div>

      {tile.ecoregion_name && (
        <div className="card-section">
          <div className="card-row">
            <span className="card-key">Ecoregion</span>
            <span className="card-val">{tile.ecoregion_name}</span>
          </div>
          {tile.biome_name && (
            <div className="card-row">
              <span className="card-key">Biome</span>
              <span className="card-val">{tile.biome_name}</span>
            </div>
          )}
        </div>
      )}

      {tile.restoration_gap !== null && tile.restoration_gap !== undefined && (
        <div className="card-section">
          <div className="card-row">
            <span className="card-key">Restoration gap</span>
            <span className="card-val restoration-gap">+{fmt(tile.restoration_gap)}</span>
          </div>
          <p className="card-note">
            This location could recover {fmt(tile.restoration_gap)} HRC points if restored
            to the reference condition for its ecoregion.
          </p>
        </div>
      )}

      <div className="card-section">
        <div className="card-row">
          <span className="card-key">Evaporative fraction</span>
          <span className="card-val">{fmt(tile.evaporative_fraction)}</span>
        </div>
        {tile.date_start && (
          <div className="card-row">
            <span className="card-key">Period</span>
            <span className="card-val">{tile.date_start} – {tile.date_end}</span>
          </div>
        )}
        <div className="card-row">
          <span className="card-key">Coordinates</span>
          <span className="card-val">{fmt(tile.latitude, 4)}°N, {fmt(tile.longitude, 4)}°E</span>
        </div>
      </div>
    </div>
  )
}
