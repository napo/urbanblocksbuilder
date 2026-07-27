import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
// Not used directly - importing it makes Vite emit it as an asset too, next
// to the worker file above, which statically imports it by relative path
// (see the assetFileNames comment in vite.config.ts).
import 'maplibre-gl/dist/maplibre-gl-shared.mjs?url'
import type { TerraDraw } from 'terra-draw'
import { useAnalysisStore, type LayerVisibility } from '../../state/analysisStore'
import {
  buildAreaFeatureCollection,
  buildBlocksFeatureCollection,
  buildDistrictsFeatureCollection,
  buildSingleFeatureCollection,
} from './mapLayerData'
import { buildBlockFillExpression } from './blockStyling'
import { createTerraDraw, ClearDrawControl } from './drawTools'
import { createAnalysisArea } from '../../domain/analysisArea'
import type { AnalysisArea } from '../../domain/types'

// MapLibre otherwise derives its worker URL from import.meta.url of its own
// bundled chunk, which resolves to *our* app bundle once Vite inlines it -
// there is no such file next to it on the server, so the request 404s (and
// on GitHub Pages that 404 comes back as HTML, which the browser then
// refuses to load as a worker). Importing the worker file with `?url` makes
// Vite emit it as a real, base-aware asset and rewrites this to that URL.
maplibregl.setWorkerUrl(maplibreWorkerUrl)

const LINE_LAYERS: Array<{ id: keyof LayerVisibility; source: string; color: string; dashArray?: number[] }> = [
  { id: 'originalRoads', source: 'original-roads', color: '#94a3b8' },
  { id: 'nodedRoads', source: 'noded-roads', color: '#0ea5e9' },
  { id: 'removedBranches', source: 'removed-branches', color: '#f97316', dashArray: [2, 1] },
  { id: 'twoCoreRoads', source: 'two-core-roads', color: '#64748b' },
]

export function MapView() {
  const mapContainer = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const terraDrawRef = useRef<TerraDraw | null>(null)
  const clearControlRef = useRef<ClearDrawControl | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const drawModeRef = useRef<{ areaSelectionMode: string; drawingMode: string }>({ areaSelectionMode: 'geocoder', drawingMode: 'rectangle' })

  const selectedArea = useAnalysisStore((state) => state.selectedArea)
  const previewArea = useAnalysisStore((state) => state.previewArea)
  const blocks = useAnalysisStore((state) => state.blocks)
  const districts = useAnalysisStore((state) => state.districts)
  const originalRoads = useAnalysisStore((state) => state.originalRoads)
  const nodedRoads = useAnalysisStore((state) => state.nodedRoads)
  const removedBranches = useAnalysisStore((state) => state.removedBranches)
  const twoCoreRoads = useAnalysisStore((state) => state.twoCoreRoads)
  const grid = useAnalysisStore((state) => state.grid)
  const layerVisibility = useAnalysisStore((state) => state.layerVisibility)
  const blockStyleAttribute = useAnalysisStore((state) => state.blockStyleAttribute)
  const classificationMethod = useAnalysisStore((state) => state.classificationMethod)
  const manualBreaks = useAnalysisStore((state) => state.manualBreaks)
  const blockColorPalette = useAnalysisStore((state) => state.blockColorPalette)
  const selectedBlockId = useAnalysisStore((state) => state.selectedBlockId)
  const selectedDistrictId = useAnalysisStore((state) => state.selectedDistrictId)
  const areaSelectionMode = useAnalysisStore((state) => state.areaSelectionMode)
  const drawingMode = useAnalysisStore((state) => state.drawingMode)
  const drawSessionToken = useAnalysisStore((state) => state.drawSessionToken)
  const setSelectedBlockId = useAnalysisStore((state) => state.setSelectedBlockId)
  const setSelectedDistrictId = useAnalysisStore((state) => state.setSelectedDistrictId)
  const setPreviewArea = useAnalysisStore((state) => state.setPreviewArea)

  drawModeRef.current = { areaSelectionMode, drawingMode }

  useEffect(() => {
    if (!mapContainer.current) {
      return
    }

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://styles.maptoolkit.org/street-en.json',
      center: [0, 0],
      zoom: 2,
      // The basemap's vector tiles (mtk source) top out at zoom 15; MapLibre
      // can overzoom a few levels past that by stretching the last tile, but
      // beyond ~18-19 there's nothing left to stretch and the map goes blank.
      // Capping here keeps zooming useful instead of scrolling into a void.
      maxZoom: 18,
      attributionControl: { customAttribution: '© OpenStreetMap contributors' },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right')

    map.on('load', () => {
      const emptyCollection: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

      map.addSource('analysis-area', { type: 'geojson', data: emptyCollection })
      map.addSource('districts', { type: 'geojson', data: emptyCollection })
      map.addSource('selected-district', { type: 'geojson', data: emptyCollection })
      map.addSource('grid', { type: 'geojson', data: emptyCollection })
      map.addSource('original-roads', { type: 'geojson', data: emptyCollection })
      map.addSource('noded-roads', { type: 'geojson', data: emptyCollection })
      map.addSource('removed-branches', { type: 'geojson', data: emptyCollection })
      map.addSource('two-core-roads', { type: 'geojson', data: emptyCollection })
      map.addSource('blocks', { type: 'geojson', data: emptyCollection })
      map.addSource('selected-block', { type: 'geojson', data: emptyCollection })

      map.addLayer({ id: 'grid-outline', type: 'line', source: 'grid', paint: { 'line-color': '#f59e0b', 'line-width': 1 } })
      map.addLayer({
        id: 'grid-fill',
        type: 'fill',
        source: 'grid',
        paint: {
          'fill-color': ['match', ['get', 'state'], 'Completed', '#22c55e', 'Failed', '#ef4444', 'Querying', '#3b82f6', 'Subdivided', '#a3a3a3', '#e2e8f0'],
          'fill-opacity': 0.15,
        },
      })

      // Added early (i.e. rendered *below*) everything that represents an
      // actual result, so once blocks appear they are always drawn on top
      // of the selection boundary, never hidden underneath it. Starts as a
      // solid grey selection; restyled to a transparent, long-dashed black
      // outline once a result exists (see the "Analysis area styling" effect).
      map.addLayer({ id: 'analysis-area-fill', type: 'fill', source: 'analysis-area', paint: { 'fill-color': '#64748b', 'fill-opacity': 0.25 } })
      map.addLayer({ id: 'analysis-area-outline', type: 'line', source: 'analysis-area', paint: { 'line-color': '#334155', 'line-width': 2 } })

      map.addLayer({ id: 'districts-fill', type: 'fill', source: 'districts', paint: { 'fill-color': '#a855f7', 'fill-opacity': 0.08 } })
      map.addLayer({ id: 'districts-outline', type: 'line', source: 'districts', paint: { 'line-color': '#7e22ce', 'line-width': 1.5, 'line-dasharray': [3, 2] } })

      for (const layer of LINE_LAYERS) {
        map.addLayer({
          id: `${layer.source}-line`,
          type: 'line',
          source: layer.source,
          paint: {
            'line-color': layer.color,
            'line-width': 1.5,
            ...(layer.dashArray ? { 'line-dasharray': layer.dashArray } : {}),
          },
        })
      }

      map.addLayer({ id: 'blocks-fill', type: 'fill', source: 'blocks', paint: { 'fill-color': '#14b8a6', 'fill-opacity': 0.45 } })
      map.addLayer({ id: 'blocks-outline', type: 'line', source: 'blocks', paint: { 'line-color': '#0f766e', 'line-width': 1 } })

      map.addLayer({ id: 'selected-block-outline', type: 'line', source: 'selected-block', paint: { 'line-color': '#facc15', 'line-width': 3 } })
      map.addLayer({ id: 'selected-district-outline', type: 'line', source: 'selected-district', paint: { 'line-color': '#facc15', 'line-width': 3, 'line-dasharray': [1, 0] } })

      map.on('click', 'blocks-fill', (event) => {
        const feature = event.features?.[0]
        if (!feature) return
        const properties = feature.properties as Record<string, unknown>
        setSelectedBlockId(String(properties.blockId))

        popupRef.current?.remove()
        popupRef.current = new maplibregl.Popup({ closeButton: true })
          .setLngLat(event.lngLat)
          .setHTML(buildBlockPopupHtml(properties))
          .addTo(map)
      })

      map.on('click', 'districts-fill', (event) => {
        const feature = event.features?.[0]
        if (!feature) return
        const properties = feature.properties as Record<string, unknown>
        setSelectedDistrictId(String(properties.districtId))
      })

      map.on('mouseenter', 'blocks-fill', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'blocks-fill', () => { map.getCanvas().style.cursor = '' })

      const terraDraw = createTerraDraw(map)
      terraDrawRef.current = terraDraw

      const emitPreviewFromSnapshot = (featureId: string | number) => {
        const { areaSelectionMode: currentMode } = drawModeRef.current
        if (currentMode !== 'rectangle' && currentMode !== 'polygon') return
        const feature = terraDraw.getSnapshot().find((entry) => entry.id === featureId)
        if (feature && feature.geometry.type === 'Polygon') {
          const area = createAnalysisArea(
            feature.geometry as GeoJSON.Polygon,
            currentMode as AnalysisArea['source'],
            `${currentMode === 'rectangle' ? 'Rectangle' : 'Polygon'} selection`,
          )
          setPreviewArea(area)
        }
      }

      terraDraw.on('finish', (id) => {
        emitPreviewFromSnapshot(id)
        // Switch straight to select mode so the just-drawn shape can be
        // dragged/resized/deleted without picking a tool again.
        terraDraw.setMode('select')
      })

      terraDraw.on('change', (ids, type) => {
        if (type === 'delete') {
          setPreviewArea(null)
          return
        }
        if ((type === 'update' || type === 'drag') && ids[0] !== undefined) {
          emitPreviewFromSnapshot(ids[0])
        }
      })
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [setSelectedBlockId, setSelectedDistrictId, setPreviewArea])

  // Analysis area preview / selection
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const area = selectedArea ?? previewArea
    const source = map.getSource('analysis-area') as maplibregl.GeoJSONSource | undefined
    source?.setData(buildAreaFeatureCollection(area))

    // Never re-centre/zoom while the user is actively drawing or dragging a
    // rectangle/polygon vertex: every mouse move updates previewArea, and
    // fitBounds on each of those made the map visibly jump/zoom mid-drag.
    // Auto-fitting only makes sense for area sources the user doesn't
    // already have framed - a place search result or an uploaded file.
    const isDrawingMode = areaSelectionMode === 'rectangle' || areaSelectionMode === 'polygon'
    if (area && !isDrawingMode) {
      map.fitBounds(new maplibregl.LngLatBounds([area.bbox[0], area.bbox[1]], [area.bbox[2], area.bbox[3]]), { padding: 40, maxZoom: 17 })
    }
  }, [selectedArea, previewArea, areaSelectionMode])

  // Analysis area styling: solid grey while it's just a selection, but once
  // a result exists the blocks are the thing to look at, so the selection
  // boundary steps back into a transparent, long-dashed black outline
  // instead of competing with the choropleth fill.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!map.getLayer('analysis-area-fill') || !map.getLayer('analysis-area-outline')) return

    const hasResult = blocks.length > 0
    if (hasResult) {
      map.setPaintProperty('analysis-area-fill', 'fill-opacity', 0)
      map.setPaintProperty('analysis-area-outline', 'line-color', '#000000')
      map.setPaintProperty('analysis-area-outline', 'line-dasharray', [6, 4])
      map.setPaintProperty('analysis-area-outline', 'line-width', 2)
    } else {
      map.setPaintProperty('analysis-area-fill', 'fill-opacity', 0.25)
      map.setPaintProperty('analysis-area-outline', 'line-color', '#334155')
      map.setPaintProperty('analysis-area-outline', 'line-dasharray', [1, 0])
      map.setPaintProperty('analysis-area-outline', 'line-width', 2)
    }
  }, [blocks])

  // Blocks + styling
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const source = map.getSource('blocks') as maplibregl.GeoJSONSource | undefined
    source?.setData(buildBlocksFeatureCollection(blocks))
    if (map.getLayer('blocks-fill')) {
      map.setPaintProperty('blocks-fill', 'fill-color', buildBlockFillExpression(blockStyleAttribute, classificationMethod, blocks, manualBreaks, blockColorPalette) as never)
    }
  }, [blocks, blockStyleAttribute, classificationMethod, manualBreaks, blockColorPalette])

  // Districts
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const source = map.getSource('districts') as maplibregl.GeoJSONSource | undefined
    source?.setData(buildDistrictsFeatureCollection(districts))
  }, [districts])

  // Road / grid layers straight from worker output
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    ;(map.getSource('original-roads') as maplibregl.GeoJSONSource | undefined)?.setData(originalRoads)
  }, [originalRoads])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    ;(map.getSource('noded-roads') as maplibregl.GeoJSONSource | undefined)?.setData(nodedRoads)
  }, [nodedRoads])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    ;(map.getSource('removed-branches') as maplibregl.GeoJSONSource | undefined)?.setData(removedBranches)
  }, [removedBranches])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    ;(map.getSource('two-core-roads') as maplibregl.GeoJSONSource | undefined)?.setData(twoCoreRoads)
  }, [twoCoreRoads])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    ;(map.getSource('grid') as maplibregl.GeoJSONSource | undefined)?.setData(grid)
  }, [grid])

  // Selected block / district highlight
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const feature = blocks.find((block) => block.id === selectedBlockId)
    const geoFeature = feature ? { type: 'Feature' as const, geometry: feature.geometry, properties: feature.properties } : undefined
    ;(map.getSource('selected-block') as maplibregl.GeoJSONSource | undefined)?.setData(buildSingleFeatureCollection(geoFeature))
  }, [blocks, selectedBlockId])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const district = districts.find((entry) => entry.id === selectedDistrictId)
    const geoFeature = district ? { type: 'Feature' as const, geometry: district.geometry, properties: { districtId: district.id } } : undefined
    ;(map.getSource('selected-district') as maplibregl.GeoJSONSource | undefined)?.setData(buildSingleFeatureCollection(geoFeature))
  }, [districts, selectedDistrictId])

  // Layer visibility toggles
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const setVisible = (layerId: string, visible: boolean) => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none')
      }
    }

    setVisible('analysis-area-fill', layerVisibility.analysisArea)
    setVisible('analysis-area-outline', layerVisibility.analysisArea)
    setVisible('districts-fill', layerVisibility.districts)
    setVisible('districts-outline', layerVisibility.districts)
    setVisible('grid-fill', layerVisibility.grid)
    setVisible('grid-outline', layerVisibility.grid)
    setVisible('blocks-fill', layerVisibility.blocks)
    setVisible('blocks-outline', layerVisibility.blocks)
    for (const layer of LINE_LAYERS) {
      setVisible(`${layer.source}-line`, layerVisibility[layer.id])
    }
  }, [layerVisibility])

  // Terra Draw mode sync: start/stop drawing and switch shape type based on
  // the area-selection step; add a small on-map "clear" control (styled
  // like a native MapLibre control) only while a drawing tool is active.
  useEffect(() => {
    const map = mapRef.current
    const terraDraw = terraDrawRef.current
    if (!map || !terraDraw) return

    const isDrawMode = areaSelectionMode === 'rectangle' || areaSelectionMode === 'polygon'

    // A full stop/start cycle (not just clear()) resets Terra Draw's
    // internal interaction state machine, not only its feature store -
    // reusing a mode via clear()+setMode() alone left the next drawing
    // session unable to fire its own 'finish' event. Reads drawingMode from
    // the ref (not the closed-over prop) so the long-lived ClearDrawControl
    // instance always restarts into whichever shape is currently selected.
    const restartDrawing = () => {
      if (terraDraw.enabled) {
        terraDraw.stop()
      }
      terraDraw.start()
      terraDraw.clear()
      terraDraw.setMode(drawModeRef.current.drawingMode)
    }

    if (isDrawMode) {
      restartDrawing()

      if (!clearControlRef.current) {
        const control = new ClearDrawControl(() => {
          restartDrawing()
          setPreviewArea(null)
        })
        map.addControl(control, 'top-left')
        clearControlRef.current = control
      }
    } else {
      // Wipe any drawn shape whenever we're not in rectangle/polygon mode -
      // otherwise switching to another area-selection method, or starting a
      // new analysis, left the previous rectangle/polygon rendered on the
      // map indefinitely (Terra Draw's own layer, independent of the
      // 'analysis-area' source, which stop() alone does not clear). Guarded
      // because clear() can throw if Terra Draw was never started yet
      // (e.g. the very first render, before any drawing tool was touched).
      try {
        terraDraw.clear()
      } catch {
        // Nothing to clear yet.
      }
      if (terraDraw.enabled) {
        terraDraw.stop()
      }
      if (clearControlRef.current) {
        map.removeControl(clearControlRef.current)
        clearControlRef.current = null
      }
    }

    return () => {
      if (!isDrawMode && clearControlRef.current) {
        try {
          map.removeControl(clearControlRef.current)
        } catch {
          // Map may already be torn down.
        }
        clearControlRef.current = null
      }
    }
  }, [areaSelectionMode, drawingMode, drawSessionToken, setPreviewArea])

  return (
    <section aria-label="Map view" style={{ position: 'relative', height: '100%', width: '100%', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
      {areaSelectionMode === 'rectangle' || areaSelectionMode === 'polygon' ? (
        <div
          style={{
            position: 'absolute',
            top: '0.75rem',
            left: '3.25rem',
            zIndex: 1,
            background: 'var(--color-surface)',
            padding: '0.35rem 0.7rem',
            borderRadius: '999px',
            boxShadow: 'var(--shadow-sm)',
            fontSize: '0.78rem',
            fontWeight: 600,
            color: 'var(--color-primary)',
          }}
        >
          Click to draw a {drawingMode} · double-click to finish · use ⬅ to clear
        </div>
      ) : null}
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
    </section>
  )
}

function buildBlockPopupHtml(properties: Record<string, unknown>): string {
  const area = Number(properties.areaM2 ?? 0)
  const perimeter = Number(properties.perimeterM ?? 0)
  const compactness = Number(properties.compactness ?? 0)
  const flags: string[] = []
  if (properties.flaggedSmallArtifact === true || properties.flaggedSmallArtifact === 'true') flags.push('Small artifact')
  if (properties.flaggedLargeArea === true || properties.flaggedLargeArea === 'true') flags.push('Unusually large')
  if (properties.flaggedInvalidGeometry === true || properties.flaggedInvalidGeometry === 'true') flags.push('Invalid geometry (repair failed)')
  const isBoundaryClosed = properties.flaggedBoundaryClosure === true || properties.flaggedBoundaryClosure === 'true'

  return `
    <div style="font-size: 0.85rem; display: grid; gap: 0.15rem;">
      <strong>Block ${escapeHtml(String(properties.blockId ?? ''))}</strong>
      <span>Area: ${area.toLocaleString(undefined, { maximumFractionDigits: 0 })} m²</span>
      <span>Perimeter: ${perimeter.toLocaleString(undefined, { maximumFractionDigits: 0 })} m</span>
      <span>Compactness: ${compactness.toFixed(3)}</span>
      ${properties.districtId ? `<span>District: ${escapeHtml(String(properties.districtId))} (${(Number(properties.districtOverlapRatio ?? 0) * 100).toFixed(0)}% overlap)</span>` : '<span>District: none assigned</span>'}
      ${flags.length > 0 ? `<span style="color:#dc2626;">Warnings: ${flags.join(', ')}</span>` : '<span style="color:#16a34a;">No warnings</span>'}
      ${isBoundaryClosed ? '<span style="color:#b45309;">Part of this block\'s edge is the selection boundary, not a real street.</span>' : ''}
    </div>
  `
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char))
}
