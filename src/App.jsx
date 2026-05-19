import { useState, useEffect, useCallback, useRef } from 'react'
import DeckGL from '@deck.gl/react'
import { WebMercatorViewport, FlyToInterpolator } from '@deck.gl/core'
import { H3HexagonLayer } from '@deck.gl/geo-layers'
import { ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { latLngToCell } from 'h3-js'
import { Map } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'

import { supabase } from './lib/supabase'
import { hrcColor, gapColor, coolingWorkColor } from './lib/hrcColor'
import {
  METHODOLOGY_MODES,
  hasV22Data,
  getActiveScore,
  getActiveGap,
} from './lib/methodologyMode'
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
      <button
        className={`view-toggle-btn ${viewMode === 'cooling' ? 'active' : ''}`}
        onClick={() => onChange('cooling')}
      >
        Cooling work
      </button>
    </div>
  )
}

function MethodologyToggle({ methodologyMode, onChange, onInfo }) {
  // Surfaced only when at least one tile in view has v2.2 data — keeps
  // the headline bar uncluttered when looking at Wales / LA / SF Bay /
  // Tapajós (none of which carry v2.2 data yet).
  return (
    <div className="gap-mode-toggle methodology-toggle">
      <span className="gap-mode-label">
        Methodology
        {onInfo && <InfoBtn onClick={() => onInfo('methodologyVersion')} />}
      </span>
      <div className="gap-mode-btns">
        {METHODOLOGY_MODES.map(mode => (
          <button
            key={mode}
            className={`gap-mode-btn ${methodologyMode === mode ? 'active' : ''}`}
            onClick={() => onChange(mode)}
          >
            {mode}
          </button>
        ))}
      </div>
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

// Small floating panel that explains the reference-centroid colours.
// Mirrors the Legend pattern — fixed-position, low-profile, on top of
// the map. Shows a "focused" hint when a tile is selected so the user
// understands why some dots got bigger.
function CentroidLegend({ focusedEcoId }) {
  const rows = [
    { color: 'rgb(29, 158, 117)',  label: 'Kept (in v2.2 reference)' },
    { color: 'rgb(228, 126, 34)',  label: 'Rejected — class at centroid is cropland / urban / water' },
    { color: 'rgb(240, 200, 80)',  label: 'Rejected — cropland surrounds (1 km buffer)' },
    { color: 'rgb(127, 179, 213)', label: 'Rejected — wetland edge (500 m buffer)' },
    { color: 'rgb(140, 140, 140)', label: 'Rejected — no albedo / no EF' },
  ]
  return (
    <div className="legend legend-centroids">
      <div className="legend-title">Reference centroids</div>
      <div className="legend-subtitle">WDPA centroids feeding the v2.2 albedo reference</div>
      {rows.map(r => (
        <div key={r.label} className="legend-row">
          <span className="legend-swatch" style={{ background: r.color, borderRadius: '50%' }} />
          <span className="legend-label">{r.label}</span>
        </div>
      ))}
      {focusedEcoId != null && (
        <div className="legend-subtitle" style={{ marginTop: 6 }}>
          Centroids for the selected tile&apos;s ecoregion are enlarged.
        </div>
      )}
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
  if (viewMode === 'cooling') {
    return (
      <div className="mode-indicator">
        Cooling work (W/m²)
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
function MapDisplayControls({
  mapStyle, onMapStyleChange,
  overlayVisible, onOverlayToggle,
  centroidsVisible, onCentroidsToggle, centroidsAvailable,
}) {
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
      {centroidsAvailable && (
        <button
          className={`view-toggle-btn map-display-overlay-btn ${centroidsVisible ? 'active' : ''}`}
          onClick={() => onCentroidsToggle(!centroidsVisible)}
          title={centroidsVisible
            ? 'Hide intact-reference centroids'
            : 'Show the WDPA centroids that feed the v2.2 albedo reference'}
        >
          {centroidsVisible ? 'Hide reference sites' : 'Show reference sites'}
        </button>
      )}
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

function HeadlineBar({
  tiles, loading, onInfo, viewMode, onViewChange,
  gapMode, onGapModeChange, methodologyMode, onMethodologyChange, onFly,
}) {
  // The methodology toggle only matters when at least one loaded tile
  // has v2.2 data — otherwise it would imply a choice with no effect.
  const v22Available = tiles.some(hasV22Data)

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
        {v22Available && (
          <MethodologyToggle
            methodologyMode={methodologyMode}
            onChange={onMethodologyChange}
            onInfo={onInfo}
          />
        )}
        <ViewToggle viewMode={viewMode} onChange={onViewChange} />
      </div>
    )
  }

  if (viewMode === 'cooling') {
    const tilesWithCw = tiles.filter(t => t.latent_heat_flux_annual_wm2 != null)
    const meanCw = tilesWithCw.length
      ? tilesWithCw.reduce((sum, t) => sum + t.latent_heat_flux_annual_wm2, 0) / tilesWithCw.length
      : null
    const noDataCount = tiles.length - tilesWithCw.length

    return (
      <div className="headline-bar">
        {meanCw !== null && (
          <div className="headline-stat">
            <span className="headline-number">{Math.round(meanCw)} W/m²</span>
            <span className="headline-desc">
              Mean cooling work
              <InfoBtn onClick={() => onInfo('coolingWork')} />
            </span>
          </div>
        )}
        <div className="headline-divider" />
        <div className="headline-stat">
          <span className="headline-number">{tilesWithCw.length}</span>
          <span className="headline-desc">
            v2.1.2 tiles in view
            <InfoBtn onClick={() => onInfo('tilesLoaded')} />
          </span>
        </div>
        {noDataCount > 0 && (
          <>
            <div className="headline-divider" />
            <div className="headline-stat">
              <span className="headline-number">{noDataCount}</span>
              <span className="headline-desc">No data (pre-v2.1.2)</span>
            </div>
          </>
        )}
        <div className="headline-divider" />
        <RegionNav onFly={onFly} />
        {v22Available && (
          <MethodologyToggle
            methodologyMode={methodologyMode}
            onChange={onMethodologyChange}
            onInfo={onInfo}
          />
        )}
        <ViewToggle viewMode={viewMode} onChange={onViewChange} />
      </div>
    )
  }

  if (viewMode === 'relative') {
    // Under v2.2 mode the per-tile gap is recomputed from
    // reference_p90_v2_2 − hrc_score_v2_2; under v2.1.1 mode it stays
    // on the stored `restoration_gap` column. Historical mode is
    // methodology-agnostic and reads restoration_gap_historical.
    const activeGapForTile = (t) =>
      gapMode === 'historical'
        ? t.restoration_gap_historical
        : getActiveGap(t, methodologyMode, gapMode)
    const tilesWithGap = tiles.filter(t => activeGapForTile(t) != null)
    const meanGap = tilesWithGap.length
      ? tilesWithGap.reduce((sum, t) => sum + activeGapForTile(t), 0) / tilesWithGap.length
      : null
    const priorityCount = tilesWithGap.filter(t => activeGapForTile(t) > 1.0).length
    const atReferenceCount = tilesWithGap.filter(t => activeGapForTile(t) <= 0.1).length

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
        {v22Available && (
          <MethodologyToggle
            methodologyMode={methodologyMode}
            onChange={onMethodologyChange}
            onInfo={onInfo}
          />
        )}
        <ViewToggle viewMode={viewMode} onChange={onViewChange} />
      </div>
    )
  }

  // Absolute view
  const tilesWithGap = tiles.filter(t => getActiveGap(t, methodologyMode, 'intact') != null)
  const meanGap = tilesWithGap.length
    ? tilesWithGap.reduce((sum, t) => sum + getActiveGap(t, methodologyMode, 'intact'), 0) / tilesWithGap.length
    : null
  const scoredTiles = tiles.filter(t => getActiveScore(t, methodologyMode) != null)
  const mean = scoredTiles.length
    ? scoredTiles.reduce((sum, t) => sum + getActiveScore(t, methodologyMode), 0) / scoredTiles.length
    : 0

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
      {v22Available && (
        <MethodologyToggle
          methodologyMode={methodologyMode}
          onChange={onMethodologyChange}
          onInfo={onInfo}
        />
      )}
      <ViewToggle viewMode={viewMode} onChange={onViewChange} />
    </div>
  )
}

function Legend({ viewMode, gapMode, resolutionLabel }) {
  if (viewMode === 'cooling') {
    // Finer-grained legend at 5 W/m² intervals through the IDF-dense
    // 20–50 range, then 10 W/m² above; swatches sampled from the
    // continuous coolingWorkColor gradient.
    const bins = [
      { sample: 17,  label: '< 20',    text: 'Minimal' },
      { sample: 22,  label: '20–25' },
      { sample: 27,  label: '25–30' },
      { sample: 32,  label: '30–35' },
      { sample: 37,  label: '35–40' },
      { sample: 42,  label: '40–45' },
      { sample: 47,  label: '45–50' },
      { sample: 55,  label: '50–60' },
      { sample: 65,  label: '60–70' },
      { sample: 75,  label: '70–80' },
      { sample: 85,  label: '80–90' },
      { sample: 95,  label: '90–100' },
      { sample: 115, label: '100+',   text: 'Very high' },
    ]
    const rgbToHex = (rgb) => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('')
    return (
      <div className="legend">
        <div className="legend-title">Cooling work (W/m²)</div>
        {bins.map(b => (
          <div key={b.label} className="legend-row">
            <span className="legend-swatch" style={{ background: rgbToHex(coolingWorkColor(b.sample)) }} />
            <span className="legend-range">{b.label}</span>
            <span className="legend-text">{b.text}</span>
          </div>
        ))}
        <div className="legend-row">
          <span className="legend-swatch" style={{ background: '#888780' }} />
          <span className="legend-range">n/a</span>
          <span className="legend-text">Pre-v2.1.2 tile</span>
        </div>
        <div className="legend-subtitle">Annual mean latent heat flux</div>
        {resolutionLabel && (
          <div className="legend-subtitle">{resolutionLabel}</div>
        )}
      </div>
    )
  }
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
    { label: '0–1',  color: '#8B2500', text: 'Severely degraded' },
    { label: '1–2',  color: '#A03205' },
    { label: '2–3',  color: '#B43C05' },
    { label: '3–4',  color: '#D4550A' },
    { label: '4–5',  color: '#E88219' },
    { label: '5–6',  color: '#F4A623', text: 'Moderate' },
    { label: '6–7',  color: '#DEBF36' },
    { label: '7–8',  color: '#C8D84A' },
    { label: '8–9',  color: '#73BB60' },
    { label: '9–10', color: '#1D9E75', text: 'High capacity' },
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
  // 'v2.2' (default) reads hrc_score_v2_2 / reference_p90_v2_2 when
  // available, falling back to v2.1.x columns for tiles without v2.2
  // data. 'v2.1.1' forces v2.1.x display even when v2.2 is present.
  const [methodologyMode, setMethodologyMode] = useState('v2.2')
  const [mapStyle, setMapStyle] = useState('dark')
  const [overlayVisible, setOverlayVisible] = useState(true)
  // WDPA reference centroids that feed the v2.2 albedo modifier.
  // Loaded once from /public/idf_reference_centroids.json (produced by
  // scripts/convert_centroid_audit_to_json.py from script 38's audit CSV).
  // The file is optional — when absent the toggle stays hidden.
  const [centroids, setCentroids] = useState(null)
  const [centroidsVisible, setCentroidsVisible] = useState(false)
  const debounceTimer = useRef(null)

  useEffect(() => {
    let cancelled = false
    fetch('/idf_reference_centroids.json')
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (!cancelled && Array.isArray(data)) setCentroids(data) })
      .catch(() => { /* missing file → leave centroids null and toggle hidden */ })
    return () => { cancelled = true }
  }, [])

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

  // In gap view we colour tiles by the active gap value. For the intact
  // reference this is methodology-aware (reads v2.2 gap when in v2.2
  // mode and a v2.2 reference exists; otherwise the stored
  // restoration_gap). Historical gap is methodology-agnostic and uses
  // the stored column directly.
  const activeGapForTile = (t) =>
    gapMode === 'historical' ? t.restoration_gap_historical
                              : getActiveGap(t, methodologyMode, 'intact')

  // Hex fill alpha — denser on satellite imagery so the colour palette
  // stays readable against the busy underlying photography.
  const overlayAlpha = mapStyle === 'satellite' ? 215 : 140
  const layer = new H3HexagonLayer({
    id: 'hrc-tiles',
    // H3 hex grid sits on an icosahedron projection; without
    // highPrecision adjacent hexes sometimes leave tiny gaps where
    // icosahedral faces meet. Visible on satellite, hidden on dark.
    highPrecision: true,
    // In gap view, exclude tiles with no value for the active gap reference.
    // In cooling-work view, keep all tiles (the colour function renders gray
    // for tiles without a v2.1.2 latent_heat_flux_annual_wm2 value).
    data: viewMode === 'relative'
      ? tiles.filter(t => activeGapForTile(t) != null)
      : tiles,
    getHexagon: d => d.h3Index,
    getFillColor: d => [
      ...(viewMode === 'relative' ? gapColor(activeGapForTile(d))
         : viewMode === 'cooling' ? coolingWorkColor(d.latent_heat_flux_annual_wm2)
         : hrcColor(getActiveScore(d, methodologyMode))),
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
      getFillColor: [viewMode, gapMode, methodologyMode, mapStyle],
      data: [viewMode, gapMode, methodologyMode],
    },
  })

  // Reference-centroid overlay. The selected tile's ecoregion_id (if
  // any) decides which centroids get the "focused" treatment — larger
  // radius + opaque fill — so the user can see exactly which WDPA
  // centroids contribute to the reference that the focused tile is
  // being compared against. Colours encode the trust-filter outcome:
  // green for kept (in the reference), orange/blue/grey for the
  // three rejection reasons.
  const CENTROID_KEPT       = [29, 158, 117]   // matches "intact" green
  const CENTROID_REJ_LC     = [228, 126, 34]   // class 12/13/14/17 at centroid
  const CENTROID_REJ_CROP   = [240, 200, 80]   // v2.2.1 — 1 km cropland buffer
  const CENTROID_REJ_WET    = [127, 179, 213]  // 500 m wetland-buffer reject
  const CENTROID_REJ_OTHER  = [140, 140, 140]  // no_albedo / no_ef / unknown
  function centroidColor(c) {
    if (c.keep) return CENTROID_KEPT
    if (c.reject_reason === 'lc_class_rejected')       return CENTROID_REJ_LC
    if (c.reject_reason === 'cropland_buffer_exceeds') return CENTROID_REJ_CROP
    if (c.reject_reason === 'wetland_buffer_exceeds')  return CENTROID_REJ_WET
    return CENTROID_REJ_OTHER
  }
  const focusedEcoId = selectedTile ? selectedTile.ecoregion_id : null

  // Hover tooltip for the centroid overlay. Returns a Deck.gl tooltip
  // descriptor object when the user hovers a centroid; null elsewhere so
  // hovering the underlying H3 hex grid doesn't trigger a tooltip
  // (the click-to-open BioregionCard handles tiles).
  const getCentroidTooltip = ({ object, layer }) => {
    if (!object || !layer || layer.id !== 'reference-centroids') return null
    const fmt2 = (v) => (v == null ? '—' : Number(v).toFixed(2))
    const fmt3 = (v) => (v == null ? '—' : Number(v).toFixed(3))
    const status = object.keep ? 'Kept (feeds reference)' : `Rejected — ${object.reject_reason || 'unknown'}`
    const wb = object.wetland_buffer_frac
    const cb = object.cropland_buffer_frac
    const lines = [
      `<div style="font-weight:600;font-size:12px;margin-bottom:4px;">${object.pa_name || '(unnamed PA)'}</div>`,
      `<div style="font-size:11px;color:#aaa;margin-bottom:6px;">IUCN ${object.iucn_cat || '—'} · ${object.ecoregion_name || '—'}</div>`,
      `<div style="font-size:11px;color:${object.keep ? '#1D9E75' : '#E47E22'};margin-bottom:6px;">${status}</div>`,
      `<div style="font-size:11px;">HRC v2.1.1: ${fmt2(object.hrc_v2_1_1)} &nbsp;|&nbsp; Albedo: ${fmt3(object.albedo)}</div>`,
      `<div style="font-size:11px;">EF: ${fmt3(object.ef)} &nbsp;|&nbsp; LC: ${object.lc_type1 ?? '—'}</div>`,
      (wb != null || cb != null)
        ? `<div style="font-size:11px;color:#888;margin-top:4px;">Wetland buffer: ${fmt2(wb)} &nbsp;|&nbsp; Cropland buffer: ${fmt2(cb)}</div>`
        : '',
    ]
    return {
      html: lines.filter(Boolean).join(''),
      style: {
        background: 'rgba(15,15,15,0.95)',
        color: '#eee',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '6px',
        padding: '8px 10px',
        maxWidth: '260px',
        pointerEvents: 'none',
      },
    }
  }

  // Text labels next to each centroid showing the HRC v2.1.1 value. Lets
  // the user compare against the ecoregion reference at a glance without
  // hovering. Skip rendering text when the centroid has no HRC value
  // (e.g. no_albedo / no_ef rejections).
  const centroidLabelData = (centroidsVisible && centroids && centroids.length)
    ? centroids.filter(c => c.hrc_v2_1_1 != null)
    : null

  const centroidLabelLayer = centroidLabelData
    ? new TextLayer({
        id: 'reference-centroid-labels',
        data: centroidLabelData,
        getPosition: d => [d.longitude, d.latitude],
        getText: d => d.hrc_v2_1_1.toFixed(2),
        getSize: 11,
        sizeUnits: 'pixels',
        getColor: [255, 255, 255, 235],
        // Halo so the text reads clearly on light cropland + dark forest.
        outlineWidth: 2,
        outlineColor: [0, 0, 0, 220],
        fontSettings: { sdf: true },
        // Sit the label just to the right of the dot so neither
        // occludes the other. 12 px right of the centroid.
        getPixelOffset: [12, 0],
        getTextAnchor: 'start',
        getAlignmentBaseline: 'center',
        pickable: false,    // dots handle hover; labels stay transparent to clicks
      })
    : null

  const centroidLayer = (centroidsVisible && centroids && centroids.length)
    ? new ScatterplotLayer({
        id: 'reference-centroids',
        data: centroids,
        getPosition: d => [d.longitude, d.latitude],
        getFillColor: d => {
          const [r, g, b] = centroidColor(d)
          const focused = focusedEcoId != null && d.ecoregion_id === focusedEcoId
          return [r, g, b, focused ? 245 : 170]
        },
        getLineColor: d => {
          const focused = focusedEcoId != null && d.ecoregion_id === focusedEcoId
          return focused ? [255, 255, 255, 220] : [0, 0, 0, 150]
        },
        getRadius: d => {
          const focused = focusedEcoId != null && d.ecoregion_id === focusedEcoId
          return focused ? 380 : 220   // metres
        },
        radiusMinPixels: 5,
        radiusMaxPixels: 18,
        lineWidthMinPixels: 1,
        stroked: true,
        filled: true,
        pickable: true,
        updateTriggers: {
          getFillColor: [focusedEcoId],
          getLineColor: [focusedEcoId],
          getRadius:    [focusedEcoId],
        },
      })
    : null

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
        methodologyMode={methodologyMode}
        onMethodologyChange={setMethodologyMode}
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
          layers={[
            overlayVisible ? layer : null,
            centroidLayer,
            centroidLabelLayer,
          ].filter(Boolean)}
          onClick={handleClick}
          getTooltip={getCentroidTooltip}
          getCursor={({ isHovering }) => isHovering ? 'pointer' : 'grab'}
        >
          <Map mapStyle={MAP_STYLES[mapStyle]} />
        </DeckGL>
        <MapDisplayControls
          mapStyle={mapStyle}
          onMapStyleChange={setMapStyle}
          overlayVisible={overlayVisible}
          onOverlayToggle={setOverlayVisible}
          centroidsVisible={centroidsVisible}
          onCentroidsToggle={setCentroidsVisible}
          centroidsAvailable={centroids != null && centroids.length > 0}
        />
        {centroidsVisible && centroids && centroids.length > 0 && (
          <CentroidLegend focusedEcoId={selectedTile && selectedTile.ecoregion_id} />
        )}
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
          methodologyMode={methodologyMode}
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
