import { trendColor, hrcLabel } from '../lib/hrcColor'

function fmt(val, decimals = 2) {
  if (val === null || val === undefined) return '—'
  return Number(val).toFixed(decimals)
}

function InfoBtn({ onClick }) {
  return (
    <button className="info-btn" onClick={onClick} aria-label="Learn more">ⓘ</button>
  )
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

export default function BioregionCard({ tile, onClose, onInfo, trendMode }) {
  if (!tile) return null

  const hrc = tile.hrc_score
  const label = hrcLabel(hrc)
  const trendScore = trendMode === '60m' ? tile.trend_score_60m : tile.trend_score
  const trendLabel = trendMode === '60m' ? 'Trend (60-month)' : 'Trend (24-month)'

  return (
    <div className="bioregion-card">
      <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>

      <div className="hrc-score-block">
        <span className="hrc-score-number">{fmt(hrc)}</span>
        <span className="hrc-score-label">
          HRC Score
          <InfoBtn onClick={() => onInfo('hrcScore')} />
        </span>
        <span className="hrc-score-status">{label}</span>
      </div>

      <div className="card-section">
        <div className="card-row">
          <span className="card-key">
            {trendLabel}
            <InfoBtn onClick={() => onInfo('trend')} />
          </span>
          <span className="card-val"><TrendArrow score={trendScore} /></span>
        </div>
        <div className="card-row">
          <span className="card-key">
            Confidence tier
            <InfoBtn onClick={() => onInfo('confidenceTier')} />
          </span>
          <span className="card-val"><span className="tier-badge">{tile.confidence_tier || 'C'}</span></span>
        </div>
      </div>

      {tile.ecoregion_name && (
        <div className="card-section">
          <div className="card-row">
            <span className="card-key">
              Ecoregion
              <InfoBtn onClick={() => onInfo('ecoregion')} />
            </span>
            <span className="card-val">{tile.ecoregion_name}</span>
          </div>
          {tile.biome_name && (
            <div className="card-row">
              <span className="card-key">
                Biome
                <InfoBtn onClick={() => onInfo('biome')} />
              </span>
              <span className="card-val">{tile.biome_name}</span>
            </div>
          )}
        </div>
      )}

      {tile.restoration_gap !== null && tile.restoration_gap !== undefined && (
        <div className="card-section">
          <div className="card-row">
            <span className="card-key">
              Restoration gap
              <InfoBtn onClick={() => onInfo('restorationGap')} />
            </span>
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
          <span className="card-key">
            Evaporative fraction
            <InfoBtn onClick={() => onInfo('evaporativeFraction')} />
          </span>
          <span className="card-val">
            {fmt(tile.evaporative_fraction ?? (tile.hrc_score != null ? tile.hrc_score / 10 : null))}
          </span>
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
