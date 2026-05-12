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

// Two basemap options the user can toggle between.
//
//   - 'dark'      → CARTO dark-matter vector tiles. No API key, free,
//                   makes the HRC hex colours pop.
//   - 'satellite' → Esri World Imagery raster tiles. No API key, free
//                   for non-commercial / showcase use, attribution
//                   included. Define inline as a minimal MapLibre
//                   style JSON pointing at the WMTS endpoint.
const MAP_STYLES = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  satellite: {
    version: 8,
    sources: {
      'esri-world-imagery': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        attribution: '© Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      },
    },
    layers: [
      {
        id: 'esri-world-imagery',
        type: 'raster',
        source: 'esri-world-imagery',
        minzoom: 0,
        maxzoom: 22,
      },
    ],
  },
}

// Initial camera — centred on the Atlantic to show Wales and SF Bay
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
  { label: 'SF Bay',      longitude: -122.1,  latitude: 37.7,  zoom: 9  },
  // v2.1.1 higher-fidelity showcase regions — zoom 10 to land in the 500 m tier
  { label: 'Île-de-France', longitude: 2.8,    latitude: 48.5,  zoom: 10 },
  { label: 'Tapajós',       longitude: -54.95, latitude: -2.85, zoom: 10 },
]

// Maps gapMode to the DB column name used for restoration gap
function getGapField(gapMode) {
  if (gapMode === 'historical') return 'restoration_gap_historical'
  return 'restoration_gap'
}

const GAP_MODE_LABELS = {
  intact:     'Intact site',
  historical: 'Historical',
}

const GAP_MODE_DESCRIPTIONS = {
  intact:     'vs. best current intact sites in this ecoregion',
  historical: 'vs. this region\'s mean cooling in 2001–2010',
}

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
        Gap view
      </button>
    </div>
  )
}

function GapModeToggle({ gapMode, onChange, onInfo }) {
  return (
    <div className="gap-mode-toggle">
      <span className="gap-mode-label">Reference</span>
      <div className="gap-mode-btns">
        <button
          className={`gap-mode-btn ${gapMode === 'intact' ? 'active' : ''}`}
          onClick={() => onChange('intact')}
        >
          Intact site
        </button>
        <button
          className={`gap-mode-btn ${gapMode === 'historical' ? 'active' : ''}`}
          onClick={() => onChange('historical')}
        >
          Historical
        </button>
      </div>
    </div>
  )
}

function ModeIndicator({ viewMode, gapMode }) {
  if (viewMode === 'absolute') {
    return (
      <div className="mode-indicator">
        Global comparison
      </div>
    )
  }
  return (
    <div className="mode-indicator mode-indicator-relative">
      Gap vs. {GAP_MODE_LABELS[gapMode]}
    </div>
  )
}

// Floating panel on the map for basemap + overlay visibility controls.
// Lives top-right of the map area, separate from the data-view toggles
// in the headline bar because these don't change WHAT data is shown,
// only HOW the map underneath looks.
function MapDisplayControls({ mapStyle, onMapStyleChange, overlayVisible, onOverlayToggle }) {
  return (
    <div className="map-display-controls">
      <div className="view-toggle">
        <button
          className={`view-toggle-btn ${mapStyle === 'dark' ? 'active' : ''}`}
          onClick={() => onMapStyleChange('dark')}
        >
          Map
        </button>
        <button
          className={`view-toggle-btn ${mapStyle === 'satellite' ? 'active' : ''}`}
          onClick={() => onMapStyleChange('satellite')}
        >
          Satellite
        </button>
      </div>
      <button
        className={`view-toggle-btn map-display-overlay-btn ${overlayVisible ? 'active' : ''}`}
        onClick={() => onOverlayToggle(!overlayVisible)}
        title={overlayVisible ? 'Hide HRC overlay' : 'Show HRC overlay'}
      >
        {overlayVisible ? 'Hide overlay' : 'Show overlay'}
      </button>
    </div>
  )
}

function RegionNav({ onFly }) {
  return (
    <div className="region-nav">
      {REGIONS.map(r => (
        <button key={r.label} className="region-nav-btn" onClick={() => onFly(r)}>
          {r.label}
        </button>
      ))}
    </div>
  )
}

function HeadlineBar({ tiles, loading, onInfo, viewMode, onViewChange, gapMode, onGapModeChange, onFly }) {
  const gapField = getGapField(gapMode)

  if (loading || !tiles.length) {
    return (
      <div className="headline-bar">
        <span className="headline-loading">
          {loading ? 'Loading HRC data…' : 'Navigate to a pilot region to load data'}
        </span>
        <RegionNav onFly={onFly} />
        {viewMode === 'relative' && (
          <GapModeToggle gapMode={gapMode} onChange={onGapModeChange} onInfo={onInfo} />
        )}
        <ViewToggle viewMode={viewMode} onChange={onViewChange} />
      </div>
    )
  }

  if (viewMode === 'relative') {
    const tilesWithGap = tiles.filter(t => t[gapField] != null)
    const meanGap = tilesWithGap.length
      ? tilesWithGap.reduce((sum, t) => sum + t[gapField], 0) / tilesWithGap.length
      : null
    const priorityCount = tilesWithGap.filter(t => t[gapField] > 1.0).length
    const atReferenceCount = tilesWithGap.filter(t => t[gapField] <= 0.1).length

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
        <GapModeToggle gapMode={gapMode} onChange={onGapModeChange} onInfo={onInfo} />
        <ViewToggle viewMode={viewMode} onChange={onViewChange} />
      </div>
    )
  }

  // Absolute view
  const tilesWithGap = tiles.filter(t => t.restoration_gap != null)
  const meanGap = tilesWithGap.length
    ? tilesWithGap.reduce((sum, t) => sum + t.restoration_gap, 0) / tilesWithGap.length
    : null
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

function Legend({ viewMode, gapMode, resolutionLabel }) {
  if (viewMode === 'relative') {
    const title = `Restoration Gap — ${GAP_MODE_LABELS[gapMode]}`
    const stops = [
      { label: '0.0',     color: '#085041', text: 'At reference' },
      { label: '0–0.2',   color: '#1D9E75' },
      { label: '0.2–0.4', color: '#73BB60' },
      { label: '0.4–0.6', color: '#C8D84A' },
      { label: '0.6–0.8', color: '#DEBF36' },
      { label: '0.8–1.0', color: '#F4A623' },
      { label: '1.0–1.2', color: '#E88219' },
      { label: '1.2–1.4', color: '#DC5F0F' },
      { label: '1.4–1.6', color: '#C84B0A' },
      { label: '1.6–1.8', color: '#B43C05' },
      { label: '1.8–2.0', color: '#A03205' },
      { label: '2.0+',    color: '#8B2500', text: 'Severe gap' },
    ]
    return (
      <div className="legend legend-relative">
        <div className="legend-title">{title}</div>
        {stops.map(s => (
          <div key={s.label} className="legend-row">
            <span className="legend-swatch" style={{ background: s.color }} />
            <span className="legend-range">{s.label}</span>
            <span className="legend-text">{s.text}</span>
          </div>
        ))}
        <div className="legend-subtitle">{GAP_MODE_DESCRIPTIONS[gapMode]}</div>
        {resolutionLabel && (
          <div className="legend-subtitle">{resolutionLabel}</div>
        )}
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
      {resolutionLabel && (
        <div className="legend-subtitle">{resolutionLabel}</div>
      )}
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
  const [viewMode, setViewMode] = useState('relative')
  const [gapMode, setGapMode] = useState('intact')
  const [mapStyle, setMapStyle] = useState('dark')
  const [overlayVisible, setOverlayVisible] = useState(true)
  const debounceTimer = useRef(null)

  // Fetch only tiles within the current viewport bounds from Supabase.
  // This scales to large datasets — only what's on screen is ever loaded.
  // Requires a composite index on (latitude, longitude) in Supabase for
  // good performance at scale:
  //   CREATE INDEX IF NOT EXISTS hrc_tiles_lat_lon ON hrc_tiles (latitude, longitude);
  //
  // Zoom-aware tier selection (v2.1.1):
  //   - At zoom < 9 (regional / global view): query only 9km Tier C tiles
  //     by filtering data_resolution_m = 9000. Prevents the panic-fetch
  //     of 46k v2.1.1 tiles when a user is zoomed out.
  //   - At zoom ≥ 9 (neighbourhood view): query the hrc_tiles_default
  //     view, which returns the highest-resolution tier available per
  //     region (500m for IDF/Tapajos, 9km for Wales/LA/SFBay).
  const fetchTilesForViewport = useCallback(async (vs) => {
    const viewport = new WebMercatorViewport({
      ...vs,
      width: window.innerWidth,
      height: window.innerHeight - 56,
    })
    const [minLon, minLat, maxLon, maxLat] = viewport.getBounds()

    setLoading(true)
    const useHighResLayer = vs.zoom >= 9

    // Paginated fetch — Supabase REST defaults to a 1000-row cap per
    // request, which truncates IDF/Tapajos viewports at 500m resolution.
    // Loop with .range() until a partial page indicates we have them all.
    const PAGE_SIZE = 1000
    const MAX_PAGES = 20  // hard ceiling — 20k rows is more than any viewport
    const all = []
    let error = null
    for (let page = 0; page < MAX_PAGES; page++) {
      let q = supabase
        .from(useHighResLayer ? 'hrc_tiles_default' : 'hrc_tiles')
        .select('*')
        .gte('latitude', minLat)
        .lte('latitude', maxLat)
        .gte('longitude', minLon)
        .lte('longitude', maxLon)
      if (!useHighResLayer) {
        // At low zoom, explicitly request only the 9km layer to avoid
        // pulling ~46k 500m tiles for IDF/Tapajos.
        q = q.eq('data_resolution_m', 9000)
      }
      q = q.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      const { data: pageData, error: pageError } = await q
      if (pageError) { error = pageError; break }
      if (!pageData || pageData.length === 0) break
      all.push(...pageData)
      if (pageData.length < PAGE_SIZE) break
    }
    const data = all

    if (error) {
      console.error('Supabase fetch error:', error)
      setError('Could not load tile data. Please check your .env file.')
    } else {
      // Snap each tile to its H3 cell at the resolution matching its data source:
      //   - 9000m (ERA5-Land Tier C) → H3 res 5 (~9.8km edge)
      //   - 500m  (PML_V2 v2.1)      → H3 res 8 (~530m edge)
      //   - 70m   (ECOSTRESS, future) → H3 res 10 (~75m edge)
      // Deduplicate by h3Index — H3 indices are unique per resolution, so
      // tiles at different tiers don't collide.
      const seen = new Set()
      const hexTiles = (data || []).reduce((acc, t) => {
        const h3Res = t.data_resolution_m === 500 ? 8
                    : t.data_resolution_m === 70  ? 10
                    : 5
        const h3Index = latLngToCell(t.latitude, t.longitude, h3Res)
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

  const gapField = getGapField(gapMode)

  // Hex fill alpha — denser on satellite imagery so the colour palette
  // stays readable against the busy underlying photography.
  const overlayAlpha = mapStyle === 'satellite' ? 215 : 140
  const layer = new H3HexagonLayer({
    id: 'hrc-tiles',
    // In gap view, exclude tiles with no value for the active gap reference.
    data: viewMode === 'relative'
      ? tiles.filter(t => t[gapField] != null)
      : tiles,
    getHexagon: d => d.h3Index,
    getFillColor: d => [
      ...(viewMode === 'relative' ? gapColor(d[gapField]) : hrcColor(d.hrc_score)),
      overlayAlpha,
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
      getFillColor: [viewMode, gapMode, mapStyle],
      data: [viewMode, gapMode],
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
        gapMode={gapMode}
        onGapModeChange={setGapMode}
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
          layers={overlayVisible ? [layer] : []}
          onClick={handleClick}
          getCursor={({ isHovering }) => isHovering ? 'pointer' : 'grab'}
        >
          <Map mapStyle={MAP_STYLES[mapStyle]} />
        </DeckGL>
        <MapDisplayControls
          mapStyle={mapStyle}
          onMapStyleChange={setMapStyle}
          overlayVisible={overlayVisible}
          onOverlayToggle={setOverlayVisible}
        />
      </div>

      <Legend
        viewMode={viewMode}
        gapMode={gapMode}
        resolutionLabel={
          tiles.some(t => t.data_resolution_m === 500)
            ? '500 m neighbourhood view'
            : tiles.length > 0
            ? '9 km regional view'
            : null
        }
      />

      <ModeIndicator viewMode={viewMode} gapMode={gapMode} />

      {selectedTile && (
        <BioregionCard
          tile={selectedTile}
          onClose={() => setSelectedTile(null)}
          onInfo={setActiveExplainer}
          viewMode={viewMode}
          gapMode={gapMode}
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
