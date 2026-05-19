import { trendColor, hrcLabel } from '../lib/hrcColor'
import {
  getActiveScore,
  getActiveReference,
  getActiveGap,
  modifierStatusText,
  disabledReasonText,
} from '../lib/methodologyMode'

function fmt(val, decimals = 2) {
  if (val === null || val === undefined) return '—'
  return Number(val).toFixed(decimals)
}

function InfoBtn({ onClick }) {
  return (
    <button className="info-btn" onClick={onClick} aria-label="Learn more">ⓘ</button>
  )
}

// v2.1.1 plain-language labels for technical fields.
function resolutionLabel(m) {
  if (m === 9000) return '9 km regional view'
  if (m === 500)  return '500 m neighbourhood view'
  if (m === 70)   return '70 m parcel view'
  return null
}

function sourceLabel(src) {
  if (src === 'ERA5_LAND_9km') return 'Tier C reanalysis (regional)'
  if (src === 'PML_V2_500m')   return 'Higher fidelity (showcase)'
  return null
}

function referenceMethodLabel(method) {
  if (!method) return null
  if (method.startsWith('centroid_p90_IUCN')) return 'Compared to local protected areas'
  if (method === 'image_mask_p90_Hansen')     return 'Compared to local intact forest'
  if (method === 'flux_tower_published')      return 'Compared to nearest flux tower measurement'
  return null
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
// the three reference systems. Reads methodologyMode so v2.2 mode pulls
// the recomputed reference (reference_p90_v2_2 − hrc_score_v2_2) instead
// of the stored v2.1.x restoration_gap column.
function getGapContext(tile, gapMode, methodologyMode) {
  if (gapMode === 'historical') {
    const isRecovered = tile.historical_change != null && tile.historical_change > 0.2
    return {
      gap:          tile.restoration_gap_historical,
      reference:    tile.hrc_historical_reference,
      refLabel:     '2001–2010 baseline',
      gapNote:      isRecovered
        ? `This location has improved by ${fmt(tile.historical_change)} HRC points since its 2001–2010 baseline — its restoration gap is zero.`
        : 'This location has lost this many HRC points since its 2001–2010 mean.',
      explainerKey: 'historicalBaseline',
    }
  }
  // intact (default) — methodology-aware
  return {
    gap:          getActiveGap(tile, methodologyMode, 'intact'),
    reference:    getActiveReference(tile, methodologyMode, 'intact'),
    refLabel:     'Ecoregion reference',
    gapNote:      'This location could recover this many HRC points if restored to the reference condition for its ecoregion.',
    explainerKey: 'restorationGap',
  }
}

// Returns the props for a single "Albedo modifier" row, or null if the
// tile has no v2.2 fields at all. When the modifier is disabled the
// secondary line explains why; when enabled it confirms the modifier
// has been applied (so the user can read the headline number as
// "albedo-adjusted").
function modifierRowProps(tile) {
  const status = modifierStatusText(tile)
  if (!status) return null
  return { status, reason: disabledReasonText(tile) }
}

export default function BioregionCard({ tile, onClose, onInfo, viewMode, gapMode, methodologyMode }) {
  if (!tile) return null

  const hrc = getActiveScore(tile, methodologyMode)
  const label = hrcLabel(hrc)
  const modifierRow = methodologyMode === 'v2.2' ? modifierRowProps(tile) : null
  // Methodology-aware restoration gap for the absolute-view default block
  const activeIntactGap = getActiveGap(tile, methodologyMode, 'intact')
  const trendScore = tile.trend_score_60m
  const trendLabel = 'Trend (60-month)'

  // ── Cooling work view — magnitude leads ─────────────────────
  if (viewMode === 'cooling') {
    const cw = tile.latent_heat_flux_annual_wm2

    return (
      <div className="bioregion-card">
        <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>

        <div className="hrc-score-block">
          <span className="hrc-score-number">
            {cw != null ? Math.round(cw) : '—'}
            {cw != null && (
              <span style={{ fontSize: '0.5em', marginLeft: '0.2em', opacity: 0.85 }}>W/m²</span>
            )}
          </span>
          <span className="hrc-score-label">
            Cooling work
            <InfoBtn onClick={() => onInfo('coolingWork')} />
          </span>
          {cw == null && (
            <span className="hrc-score-status">No v2.1.2 data for this tile</span>
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
          {activeIntactGap != null && (
            <div className="card-row">
              <span className="card-key">
                Restoration gap
                <InfoBtn onClick={() => onInfo('restorationGap')} />
              </span>
              <span className="card-val restoration-gap">+{fmt(activeIntactGap)}</span>
            </div>
          )}
          {modifierRow && (
            <div className="card-row">
              <span className="card-key">
                Albedo modifier
                <InfoBtn onClick={() => onInfo('albedoModifier')} />
              </span>
              <span className="card-val">{modifierRow.status}</span>
            </div>
          )}
          {modifierRow && modifierRow.reason && (
            <p className="card-note">{modifierRow.reason}</p>
          )}
        </div>

        <div className="card-section">
          <div className="card-row">
            <span className="card-key">
              Confidence tier
              <InfoBtn onClick={() => onInfo('confidenceTier')} />
            </span>
            <span className="card-val"><span className="tier-badge">{tile.confidence_tier || 'C'}</span></span>
          </div>
          {resolutionLabel(tile.data_resolution_m) && (
            <div className="card-row">
              <span className="card-key">View</span>
              <span className="card-val">{resolutionLabel(tile.data_resolution_m)}</span>
            </div>
          )}
          {sourceLabel(tile.data_source) && (
            <div className="card-row">
              <span className="card-key">Data source</span>
              <span className="card-val">{sourceLabel(tile.data_source)}</span>
            </div>
          )}
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

  // ── Gap view — restoration gap leads ────────────────────────
  if (viewMode === 'relative') {
    const { gap, reference, refLabel, gapNote, explainerKey } = getGapContext(tile, gapMode, methodologyMode)

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
          {modifierRow && (
            <div className="card-row">
              <span className="card-key">
                Albedo modifier
                <InfoBtn onClick={() => onInfo('albedoModifier')} />
              </span>
              <span className="card-val">{modifierRow.status}</span>
            </div>
          )}
          {modifierRow && modifierRow.reason && (
            <p className="card-note">{modifierRow.reason}</p>
          )}
        </div>

        <div className="card-section">
          <div className="card-row">
            <span className="card-key">
              {trendLabel}
              <InfoBtn onClick={() => onInfo('trend60m')} />
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
          {resolutionLabel(tile.data_resolution_m) && (
            <div className="card-row">
              <span className="card-key">View</span>
              <span className="card-val">{resolutionLabel(tile.data_resolution_m)}</span>
            </div>
          )}
          {sourceLabel(tile.data_source) && (
            <div className="card-row">
              <span className="card-key">Data source</span>
              <span className="card-val">{sourceLabel(tile.data_source)}</span>
            </div>
          )}
          {tile.hrc_raw_ratio != null && tile.hrc_raw_ratio > 10 && (
            <div className="card-row">
              <span className="card-key" style={{ color: '#E67E22' }}>⚠ Note</span>
              <span className="card-val" style={{ color: '#E67E22' }}>Computed at energy-balance limit</span>
            </div>
          )}
          {referenceMethodLabel(tile.reference_method) && (
            <div className="card-row">
              <span className="card-key">Reference</span>
              <span className="card-val">{referenceMethodLabel(tile.reference_method)}</span>
            </div>
          )}
        </div>

        {tile.latent_heat_flux_annual_wm2 != null && (
          <div className="card-section">
            <div className="card-row">
              <span className="card-key">
                Cooling work
                <InfoBtn onClick={() => onInfo('coolingWork')} />
              </span>
              <span className="card-val">
                {Math.round(tile.latent_heat_flux_annual_wm2)} W/m²
              </span>
            </div>
          </div>
        )}

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
            <InfoBtn onClick={() => onInfo('trend60m')} />
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
        {resolutionLabel(tile.data_resolution_m) && (
          <div className="card-row">
            <span className="card-key">View</span>
            <span className="card-val">{resolutionLabel(tile.data_resolution_m)}</span>
          </div>
        )}
        {sourceLabel(tile.data_source) && (
          <div className="card-row">
            <span className="card-key">Data source</span>
            <span className="card-val">{sourceLabel(tile.data_source)}</span>
          </div>
        )}
        {tile.hrc_raw_ratio != null && tile.hrc_raw_ratio > 10 && (
          <div className="card-row">
            <span className="card-key" style={{ color: '#E67E22' }}>⚠ Note</span>
            <span className="card-val" style={{ color: '#E67E22' }}>Computed at energy-balance limit</span>
          </div>
        )}
        {referenceMethodLabel(tile.reference_method) && (
          <div className="card-row">
            <span className="card-key">Reference</span>
            <span className="card-val">{referenceMethodLabel(tile.reference_method)}</span>
          </div>
        )}
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

      {tile.latent_heat_flux_annual_wm2 != null && (
        <div className="card-section">
          <div className="card-row">
            <span className="card-key">
              Cooling work
              <InfoBtn onClick={() => onInfo('coolingWork')} />
            </span>
            <span className="card-val">
              {Math.round(tile.latent_heat_flux_annual_wm2)} W/m²
            </span>
          </div>
        </div>
      )}

      {activeIntactGap != null && (
        <div className="card-section">
          <div className="card-row">
            <span className="card-key">
              Restoration gap
              <InfoBtn onClick={() => onInfo('restorationGap')} />
            </span>
            <span className="card-val restoration-gap">+{fmt(activeIntactGap)}</span>
          </div>
          <p className="card-note">
            vs. best intact sites in this ecoregion today
          </p>
          {modifierRow && (
            <div className="card-row">
              <span className="card-key">
                Albedo modifier
                <InfoBtn onClick={() => onInfo('albedoModifier')} />
              </span>
              <span className="card-val">{modifierRow.status}</span>
            </div>
          )}
          {modifierRow && modifierRow.reason && (
            <p className="card-note">{modifierRow.reason}</p>
          )}
        </div>
      )}

      {tile.hrc_historical_reference != null && (
        <div className="card-section">
          <div className="card-row">
            <span className="card-key">
              Historical baseline (2001–2010)
              <InfoBtn onClick={() => onInfo('historicalBaseline')} />
            </span>
            <span className="card-val">{fmt(tile.hrc_historical_reference)} / 10</span>
          </div>
          {tile.historical_change != null && (
            <div className="card-row">
              <span className="card-key">
                Change since 2001–10
                <InfoBtn onClick={() => onInfo('historicalBaseline')} />
              </span>
              <span className="card-val" style={{
                color: tile.historical_change > 0.2  ? '#1D9E75'   // recovery
                     : tile.historical_change < -0.2 ? '#E67E22'   // degradation
                     : '#999'                                       // stable
              }}>
                {tile.historical_change > 0.2
                  ? `+${fmt(tile.historical_change)}`
                  : tile.historical_change < -0.2
                  ? `−${fmt(Math.abs(tile.historical_change))}`
                  : '±0.0'}
              </span>
            </div>
          )}
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
        {(tile.hrc_window_start || tile.date_start) && (
          <div className="card-row">
            <span className="card-key">Period</span>
            <span className="card-val">
              {tile.hrc_window_start || tile.date_start} – {tile.hrc_window_end || tile.date_end}
            </span>
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
