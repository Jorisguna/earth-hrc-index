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

// Returns the active gap value, reference value, and display labels for
// the three reference systems.
function getGapContext(tile, gapMode) {
  const hrc = tile.hrc_score
  if (gapMode === 'historical') {
    return {
      gap:          tile.restoration_gap_historical,
      reference:    tile.hrc_historical_reference,
      refLabel:     '2001–2010 baseline',
      gapNote:      'This location has lost this many HRC points since its 2001–2010 mean.',
      explainerKey: 'historicalBaseline',
    }
  }
  if (gapMode === 'ceiling') {
    return {
      gap:          tile.restoration_gap_ceiling,
      reference:    tile.hrc_ceiling_reference,
      refLabel:     'PM physical ceiling',
      gapNote:      'This is the full physical cooling potential the local climate allows.',
      explainerKey: 'pmCeiling',
    }
  }
  // intact (default)
  const gap = tile.restoration_gap
  return {
    gap,
    reference:    gap != null && hrc != null ? hrc + gap : null,
    refLabel:     'Ecoregion reference',
    gapNote:      'This location could recover this many HRC points if restored to the reference condition for its ecoregion.',
    explainerKey: 'restorationGap',
  }
}

export default function BioregionCard({ tile, onClose, onInfo, trendMode, viewMode, gapMode }) {
  if (!tile) return null

  const hrc = tile.hrc_score
  const label = hrcLabel(hrc)
  const trendScore = trendMode === '60m' ? tile.trend_score_60m : tile.trend_score
  const trendLabel = trendMode === '60m' ? 'Trend (60-month)' : 'Trend (24-month)'

  // ── Gap view — restoration gap leads ────────────────────────
  if (viewMode === 'relative') {
    const { gap, reference, refLabel, gapNote, explainerKey } = getGapContext(tile, gapMode)

    return (
      <div className="bioregion-card">
        <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>

        <div className="hrc-score-block">
          <span className="hrc-score-number" style={{ color: '#F4A623' }}>
            {gap != null ? `+${fmt(gap)}` : '—'}
          </span>
          <span className="hrc-score-label">
            Restoration Gap
            <InfoBtn onClick={() => onInfo(explainerKey)} />
          </span>
          {gap != null && (
            <span className="hrc-score-status">
              {fmt(gap)} pts below {refLabel}
            </span>
          )}
        </div>

        <div className="card-section">
          <div className="card-row">
            <span className="card-key">
              HRC Score
              <InfoBtn onClick={() => onInfo('hrcScore')} />
            </span>
            <span className="card-val">{fmt(hrc)} / 10</span>
          </div>
          {reference != null && (
            <div className="card-row">
              <span className="card-key">
                {refLabel}
                <InfoBtn onClick={() => onInfo(explainerKey)} />
              </span>
              <span className="card-val">{fmt(reference)} / 10</span>
            </div>
          )}
          {gap != null && (
            <p className="card-note">{gapNote}</p>
          )}
        </div>

        <div className="card-section">
          <div className="card-row">
            <span className="card-key">
              {trendLabel}
              <InfoBtn onClick={() => onInfo(trendMode === '60m' ? 'trend60m' : 'trend24m')} />
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

        <div className="card-section">
          <div className="card-row">
            <span className="card-key">Coordinates</span>
            <span className="card-val">{fmt(tile.latitude, 4)}°N, {fmt(tile.longitude, 4)}°E</span>
          </div>
        </div>
      </div>
    )
  }

  // ── Absolute view — HRC score leads ─────────────────────────
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
            <InfoBtn onClick={() => onInfo(trendMode === '60m' ? 'trend60m' : 'trend24m')} />
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
            vs. best intact sites in this ecoregion today
          </p>
        </div>
      )}

      {tile.hrc_historical_reference != null && (
        <div className="card-section">
          <div className="card-row">
            <span className="card-key">
              Historical baseline
              <InfoBtn onClick={() => onInfo('historicalBaseline')} />
            </span>
            <span className="card-val">{fmt(tile.hrc_historical_reference)} / 10</span>
          </div>
          <div className="card-row">
            <span className="card-key">
              Change since 2001–10
              <InfoBtn onClick={() => onInfo('historicalBaseline')} />
            </span>
            <span className="card-val" style={{
              color: (hrc - tile.hrc_historical_reference) >= 0 ? '#1D9E75' : '#E67E22'
            }}>
              {(hrc - tile.hrc_historical_reference) >= 0 ? '+' : ''}
              {fmt(hrc - tile.hrc_historical_reference)}
            </span>
          </div>
        </div>
      )}

      {tile.hrc_ceiling_reference != null && (
        <div className="card-section">
          <div className="card-row">
            <span className="card-key">
              PM ceiling
              <InfoBtn onClick={() => onInfo('pmCeiling')} />
            </span>
            <span className="card-val">{fmt(tile.hrc_ceiling_reference)} / 10</span>
          </div>
          <div className="card-row">
            <span className="card-key">Gap to ceiling</span>
            <span className="card-val restoration-gap">
              +{fmt(tile.restoration_gap_ceiling ?? Math.max(tile.hrc_ceiling_reference - hrc, 0))}
            </span>
          </div>
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
