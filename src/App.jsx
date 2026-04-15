import { useState, useEffect, useCallback, useMemo } from 'react'
import DeckGL from '@deck.gl/react'
import { ScatterplotLayer } from 'deck.gl'
import { WebMercatorViewport } from '@deck.gl/core'
import { Map } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'

import { supabase } from './lib/supabase'
import { hrcColor } from './lib/hrcColor'
import BioregionCard from './components/BioregionCard'
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

function HeadlineBar({ tiles, loading }) {
  if (loading) {
    return (
      <div className="headline-bar">
        <span className="headline-loading">Loading HRC data…</span>
      </div>
    )
  }
  if (!tiles.length) return null

  const mean = tiles.reduce((sum, t) => sum + (t.hrc_score || 0), 0) / tiles.length
  const tilesWithGap = tiles.filter(t => t.restoration_gap !== null && t.restoration_gap !== undefined)
  const meanGap = tilesWithGap.length
    ? tilesWithGap.reduce((sum, t) => sum + t.restoration_gap, 0) / tilesWithGap.length
    : null

  return (
    <div className="headline-bar">
      <div className="headline-stat">
        <span className="headline-number">{mean.toFixed(2)}</span>
        <span className="headline-desc">Mean HRC score</span>
      </div>
      <div className="headline-divider" />
      <div className="headline-stat">
        <span className="headline-number">{tiles.length}</span>
        <span className="headline-desc">Tiles loaded</span>
      </div>
      {meanGap !== null && (
        <>
          <div className="headline-divider" />
          <div className="headline-stat">
            <span className="headline-number restoration">+{meanGap.toFixed(2)}</span>
            <span className="headline-desc">Mean restoration gap</span>
          </div>
        </>
      )}
      <div className="headline-divider" />
      <div className="headline-stat">
        <span className="headline-region">Wales · Los Angeles · Barbados</span>
      </div>
    </div>
  )
}

function Legend() {
  const stops = [
    { label: '0–2', color: '#8B2500', text: 'Severely degraded' },
    { label: '2–4', color: '#D4550A', text: 'Degraded' },
    { label: '4–6', color: '#F4A623', text: 'Moderate' },
    { label: '6–8', color: '#C8D84A', text: 'Healthy' },
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

  // Fetch all tiles from Supabase on load
  useEffect(() => {
    async function fetchTiles() {
      const { data, error } = await supabase
        .from('hrc_tiles')
        .select('*')

      if (error) {
        console.error('Supabase fetch error:', error)
        setError('Could not load tile data. Please check your .env file.')
      } else {
        setTiles(data)
      }
      setLoading(false)
    }
    fetchTiles()
  }, [])

  // Filter tiles to only those visible in the current viewport
  const visibleTiles = useMemo(() => {
    if (!tiles.length) return tiles
    const viewport = new WebMercatorViewport({
      ...viewState,
      width: window.innerWidth,
      height: window.innerHeight - 56, // subtract headline bar height
    })
    const [minLon, minLat, maxLon, maxLat] = viewport.getBounds()
    return tiles.filter(t =>
      t.longitude >= minLon && t.longitude <= maxLon &&
      t.latitude >= minLat && t.latitude <= maxLat
    )
  }, [tiles, viewState])

  const handleClick = useCallback((info) => {
    if (info && info.object) {
      setSelectedTile(info.object)
    } else {
      setSelectedTile(null)
    }
  }, [])

  const layer = new ScatterplotLayer({
    id: 'hrc-tiles',
    data: tiles,
    getPosition: d => [d.longitude, d.latitude],
    getRadius: 6000,           // ~6km to tile nicely at ERA5 ~9km grid
    radiusUnits: 'meters',
    radiusMinPixels: 3,
    radiusMaxPixels: 40,
    getFillColor: d => [...hrcColor(d.hrc_score), 220],  // slight transparency
    getLineColor: [0, 0, 0, 60],
    lineWidthMinPixels: 0.5,
    stroked: true,
    filled: true,
    pickable: true,
    autoHighlight: true,
    highlightColor: [255, 255, 255, 80],
    onClick: handleClick,
  })

  return (
    <div className="app-container">
      <HeadlineBar tiles={visibleTiles} loading={loading} />

      {error && (
        <div className="error-banner">
          ⚠ {error}
        </div>
      )}

      <div className="map-container">
        <DeckGL
          viewState={viewState}
          onViewStateChange={({ viewState: vs }) => setViewState(vs)}
          controller={true}
          layers={[layer]}
          onClick={handleClick}
          getCursor={({ isHovering }) => isHovering ? 'pointer' : 'grab'}
        >
          <Map mapStyle={MAP_STYLE} />
        </DeckGL>
      </div>

      <Legend />

      {selectedTile && (
        <BioregionCard
          tile={selectedTile}
          onClose={() => setSelectedTile(null)}
        />
      )}
    </div>
  )
}
