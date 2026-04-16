import { useState, useEffect, useCallback, useRef } from 'react'
import DeckGL from '@deck.gl/react'
import { WebMercatorViewport, FlyToInterpolator } from '@deck.gl/core'
import { H3HexagonLayer } from '@deck.gl/geo-layers'
import { latLngToCell } from 'h3-js'
import { Map } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'

import { supabase } from './lib/supabase'
import { hrcColor, gapColor } from './lib/hrcColor'
import { explainers } from './lib/explainers'
import BioregionCard from './components/BioregionCard'
import InfoModal from './components/InfoModal'
import './App.css'

// Free dark basemap from CARTO — no API key needed
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

// Initial camera — centred on the Atlantic to show Wales, Los Angeles and Barbados
const INITIAL_VIEW_STATE = {
  longitude: -62,
  latitude: 35,
  zoom: 3,
  pitch: 0,
  bearing: 0,
}

const REGIONS = [
  { label: 'Wales',       longitude: -3.8,    latitude: 52.4,  zoom: 8  },
  { label: 'Los Angeles', longitude: -118.25, latitude: 34.05, zoom: 9  },
  { label: 'Barbados',    longitude: -59.55,  latitude: 13.2,  zoom: 11 },
]

function InfoBtn({ onClick }) {
  return (
    <button className="info-btn" onClick={onClick} aria-label="Learn more">ⓘ</button>
  )
}

function ViewToggle({ viewMode, onChange }) {
  return (
    <div className="view-toggle">
      <button
        className={`view-toggle-btn ${viewMode === 'absolute' ? 'active' : ''}`}
        onClick={() => onChange('absolute')}
      >
        Absolute
      </button>
      <button
        className={`view-toggle-btn ${viewMode === 'relative' ? 'active' : ''}`}
        onClick={() => onChange('relative')}
      >
        Relative
      </button>
    </div>
  )
}

function TrendToggle({ trendMode, onChange, onInfo }) {
  return (
    <div className="trend-toggle">
      <span className="trend-toggle-label">Trend window</span>
      <div className="trend-toggle-btns">
        <div className="trend-toggle-option">
          <button
            className={`trend-toggle-btn ${trendMode === '24m' ? 'active' : ''}`}
            onClick={() => onChange('24m')}
          >
            24-month
          </button>
          <InfoBtn onClick={() => onInfo('trend24m')} />
        </div>
        <div className="trend-toggle-option">
          <button
            className={`trend-toggle-btn ${trendMode === '60m' ? 'active' : ''}`}
            onClick={() => onChange('60m')}
          >
            60-month
          </button>
          <InfoBtn onClick={() => onInfo('trend60m')} />
        </div>
      </div>
    </div>
  )
}

function ModeIndicator({ viewMode }) {
  return (
    <div className={`mode-indicator${viewMode === 'relative' ? ' mode-indicator-relative' : ''}`}>
      {viewMode === 'absolute' ? 'Global comparison' : 'Ecoregion-relative'}
    </div>
  )
}

function RegionNav({ onFly }) {
  return (
    <div className="region-nav">
      {REGIONS.map((r, i) => (
        <span key={r.label}>
          {i > 0 && <span className="region-nav-divider">·</span>}
          <button className="region-nav-btn" onClick={() => onFly(r)}>
            {r.label}
          </button>
        </span>
      ))}
    </div>
  )
}

function HeadlineBar({ tiles, loading, onInfo, viewMode, onViewChange, onFly }) {
  if (loading || !tiles.length) {
    return (
      <div className="headline-bar">
        <span className="headline-loading">
          {loading ? 'Loading HRC data…' : 'Navigate to a pilot region to load data'}
        </span>
        <RegionNav onFly={onFly} />
        <ViewToggle viewMode={viewMode} onChange={onViewChange} />
      </div>
    )
  }

  const tilesWithGap = tiles.filter(t => t.restoration_gap !== null && t.restoration_gap !== undefined)
  const meanGap = tilesWithGap.length
    ? tilesWithGap.reduce((sum, t) => sum + t.restoration_gap, 0) / tilesWithGap.length
    : null

  if (viewMode === 'relative') {
    const priorityCount = tilesWithGap.filter(t => t.restoration_gap > 1.0).length
    const atReferenceCount = tilesWithGap.filter(t => t.restoration_gap <= 0.1).length

    return (
      <div className="headline-bar">
        {meanGap !== null && (
          <div className="headline-stat">
            <span className="headline-number restoration">+{meanGap.toFixed(2)}</span>
            <span className="headline-desc">
              Mean restoration gap
              <InfoBtn onClick={() => onInfo('restorationGap')} />
            </span>
          </div>
        )}
        <div className="headline-divider" />
        <div className="headline-stat">
          <span className="headline-number">{priorityCount}</span>
          <span className="headline-desc">
            Priority tiles (gap &gt; 1.0)
            <InfoBtn onClick={() => onInfo('priorityTiles')} />
          </span>
        </div>
        <div className="headline-divider" />
        <div className="headline-stat">
          <span className="headline-number">{atReferenceCount}</span>
          <span className="headline-desc">
            At reference (gap ≤ 0.1)
            <InfoBtn onClick={() => onInfo('atReference')} />
          </span>
        </div>
        <div className="headline-divider" />
        <RegionNav onFly={onFly} />
        <ViewToggle viewMode={viewMode} onChange={onViewChange} />
      </div>
    )
  }

  const mean = tiles.reduce((sum, t) => sum + (t.hrc_score || 0), 0) / tiles.length

  return (
    <div className="headline-bar">
      <div className="headline-stat">
        <span className="headline-number">{mean.toFixed(2)}</span>
        <span className="headline-desc">
          Mean HRC score
          <InfoBtn onClick={() => onInfo('hrcScore')} />
        </span>
      </div>
      <div className="headline-divider" />
      <div className="headline-stat">
        <span className="headline-number">{tiles.length}</span>
        <span className="headline-desc">
          Tiles in view
          <InfoBtn onClick={() => onInfo('tilesLoaded')} />
        </span>
      </div>
      {meanGap !== null && (
        <>
          <div className="headline-divider" />
          <div className="headline-stat">
            <span className="headline-number restoration">+{meanGap.toFixed(2)}</span>
            <span className="headline-desc">
              Mean restoration gap
              <InfoBtn onClick={() => onInfo('restorationGap')} />
            </span>
          </div>
        </>
      )}
      <div className="headline-divider" />
      <RegionNav onFly={onFly} />
      <ViewToggle viewMode={viewMode} onChange={onViewChange} />
    </div>
  )
}

function Legend({ viewMode }) {
  if (viewMode === 'relative') {
    const stops = [
      { label: '0.0',     color: '#085041', text: 'At ecoregion reference' },
      { label: '0–0.5',   color: '#1D9E75', text: 'Minor gap' },
      { label: '0.5–1.5', color: '#C8D84A', text: 'Moderate gap' },
      { label: '1.5–2.5', color: '#F4A623', text: 'Significant gap' },
      { label: '2.5+',    color: '#8B2500', text: 'Severe gap' },
    ]
    return (
      <div className="legend legend-relative">
        <div className="legend-title">Restoration Gap</div>
        {stops.map(s => (
          <div key={s.label} className="legend-row">
            <span className="legend-swatch" style={{ background: s.color }} />
            <span className="legend-range">{s.label}</span>
            <span className="legend-text">{s.text}</span>
          </div>
        ))}
      </div>
    )
  }

  const stops = [
    { label: '0–2',  color: '#8B2500', text: 'Severely degraded' },
    { label: '2–4',  color: '#D4550A', text: 'Degraded' },
    { label: '4–6',  color: '#F4A623', text: 'Moderate' },
    { label: '6–8',  color: '#C8D84A', text: 'Healthy' },
    { label: '8–10', color: '#1D9E75', text: 'High capacity' },
  ]
  return (
    <div className="legend">
      <div className="legend-title">HRC Score</div>
      {stops.map(s => (
        <div key={s.label} className="legend-row">
          <span className="legend-swatch" style={{ background: s.color }} />
          <span className="legend-range">{s.label}</span>
          <span className="legend-text">{s.text}</span>
        </div>
      ))}
    </div>
  )
}

export default function App() {
  const [tiles, setTiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedTile, setSelectedTile] = useState(null)
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE)
  const [activeExplainer, setActiveExplainer] = useState(null)
  const [trendMode, setTrendMode] = useState('60m')
  const [viewMode, setViewMode] = useState('absolute')
  const debounceTimer = useRef(null)

  // Fetch only tiles within the current viewport bounds from Supabase.
  // This scales to large datasets — only what's on screen is ever loaded.
  // Requires a composite index on (latitude, longitude) in Supabase for
  // good performance at scale:
  //   CREATE INDEX IF NOT EXISTS hrc_tiles_lat_lon ON hrc_tiles (latitude, longitude);
  const fetchTilesForViewport = useCallback(async (vs) => {
    const viewport = new WebMercatorViewport({
      ...vs,
      width: window.innerWidth,
      height: window.innerHeight - 56,
    })
    const [minLon, minLat, maxLon, maxLat] = viewport.getBounds()

    setLoading(true)
    const { data, error } = await supabase
      .from('hrc_tiles')
      .select('*')
      .gte('latitude', minLat)
      .lte('latitude', maxLat)
      .gte('longitude', minLon)
      .lte('longitude', maxLon)

    if (error) {
      console.error('Supabase fetch error:', error)
      setError('Could not load tile data. Please check your .env file.')
    } else {
      // Snap each tile to its H3 cell (res 5 ≈ 9.8km edge, matching ERA5 scale).
      // Deduplicate so no two tiles share the same hex — first one wins.
      const seen = new Set()
      const hexTiles = (data || []).reduce((acc, t) => {
        const h3Index = latLngToCell(t.latitude, t.longitude, 5)
        if (!seen.has(h3Index)) {
          seen.add(h3Index)
          acc.push({ ...t, h3Index })
        }
        return acc
      }, [])
      setTiles(hexTiles)
      setError(null)
    }
    setLoading(false)
  }, [])

  // Initial load
  useEffect(() => {
    fetchTilesForViewport(INITIAL_VIEW_STATE)
  }, [fetchTilesForViewport])

  const flyTo = useCallback((region) => {
    setViewState(vs => ({
      ...vs,
      longitude: region.longitude,
      latitude: region.latitude,
      zoom: region.zoom,
      transitionDuration: 1200,
      transitionInterpolator: new FlyToInterpolator(),
    }))
  }, [])

  const handleViewStateChange = useCallback(({ viewState: vs }) => {
    setViewState(vs)
    clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => fetchTilesForViewport(vs), 400)
  }, [fetchTilesForViewport])

  const handleClick = useCallback((info) => {
    if (info && info.object) {
      setSelectedTile(info.object)
    } else {
      setSelectedTile(null)
    }
  }, [])

  const layer = new H3HexagonLayer({
    id: 'hrc-tiles',
    // In relative view, exclude tiles with no ecoregion reference (coastal/sea tiles).
    // They have valid HRC scores but no restoration gap, so grey tiles would mislead.
    data: viewMode === 'relative' ? tiles.filter(t => t.restoration_gap != null) : tiles,
    getHexagon: d => d.h3Index,
    getFillColor: d => [
      ...(viewMode === 'relative' ? gapColor(d.restoration_gap) : hrcColor(d.hrc_score)),
      140,
    ],
    getLineColor: [0, 0, 0, 80],
    lineWidthMinPixels: 0.5,
    stroked: true,
    filled: true,
    pickable: true,
    autoHighlight: true,
    highlightColor: [255, 255, 255, 60],
    onClick: handleClick,
    elevationScale: 0,
    extruded: false,
    updateTriggers: {
      getFillColor: viewMode,
    },
  })

  return (
    <div className="app-container">
      <HeadlineBar
        tiles={tiles}
        loading={loading}
        onInfo={setActiveExplainer}
        viewMode={viewMode}
        onViewChange={setViewMode}
        onFly={flyTo}
      />

      {error && (
        <div className="error-banner">
          ⚠ {error}
        </div>
      )}

      <div className="map-container">
        <DeckGL
          viewState={viewState}
          onViewStateChange={handleViewStateChange}
          controller={true}
          layers={[layer]}
          onClick={handleClick}
          getCursor={({ isHovering }) => isHovering ? 'pointer' : 'grab'}
        >
          <Map mapStyle={MAP_STYLE} />
        </DeckGL>
      </div>

      <Legend viewMode={viewMode} />

      <TrendToggle trendMode={trendMode} onChange={setTrendMode} onInfo={setActiveExplainer} />

      <ModeIndicator viewMode={viewMode} />

      {selectedTile && (
        <BioregionCard
          tile={selectedTile}
          onClose={() => setSelectedTile(null)}
          onInfo={setActiveExplainer}
          trendMode={trendMode}
          viewMode={viewMode}
        />
      )}

      {activeExplainer && (
        <InfoModal
          title={explainers[activeExplainer].title}
          body={explainers[activeExplainer].body}
          onClose={() => setActiveExplainer(null)}
        />
      )}
    </div>
  )
}
