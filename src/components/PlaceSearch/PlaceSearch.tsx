import { useEffect, useRef, useState } from 'react'
import * as turf from '@turf/turf'
import { NominatimGeocoder } from '../../services/geocoding/NominatimGeocoder'
import { createAnalysisArea } from '../../domain/analysisArea'
import type { AnalysisArea, GeocodingResult } from '../../domain/types'

const geocoder = new NominatimGeocoder()
const DEBOUNCE_MS = 400
const RADIUS_OPTIONS_METERS = [500, 1000, 2000, 3000, 5000]

export interface PlaceSearchProps {
  onPreview: (area: AnalysisArea) => void
  onConfirm: (area: AnalysisArea) => void
}

export function PlaceSearch({ onPreview, onConfirm }: PlaceSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeocodingResult[]>([])
  const [selected, setSelected] = useState<GeocodingResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [radiusMeters, setRadiusMeters] = useState(2000)
  const [customRadius, setCustomRadius] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }

    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setLoading(false)
      return
    }

    timerRef.current = setTimeout(() => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setLoading(true)
      setError(null)

      geocoder
        .search(trimmed, controller.signal)
        .then((found) => {
          setResults(found)
          if (found.length === 0) {
            setError('No place matches were found. Try a different search term.')
          }
        })
        .catch((searchError: unknown) => {
          if (searchError instanceof DOMException && searchError.name === 'AbortError') {
            return
          }
          setError('Place search is temporarily unavailable. Please try again.')
          setResults([])
        })
        .finally(() => setLoading(false))
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [query])

  const effectiveRadius = customRadius.trim() ? Number(customRadius) : radiusMeters

  const selectResult = (result: GeocodingResult) => {
    setSelected(result)
    setError(null)

    if (result.geometry && (result.geometry.type === 'Polygon' || result.geometry.type === 'MultiPolygon')) {
      const area = createAnalysisArea(result.geometry, 'geocoder', result.displayName)
      onPreview(area)
      return
    }

    if (typeof result.lon === 'number' && typeof result.lat === 'number') {
      previewRadiusArea(result, effectiveRadius)
      return
    }

    setError('This result has no usable geometry or coordinates.')
  }

  const previewRadiusArea = (result: GeocodingResult, radius: number) => {
    if (!Number.isFinite(radius) || radius <= 0) {
      setError('Enter a valid radius greater than zero.')
      return
    }
    const circle = turf.circle([result.lon as number, result.lat as number], radius, { steps: 64, units: 'meters' })
    const area = createAnalysisArea(circle.geometry, 'radius', result.displayName, radius)
    onPreview(area)
  }

  useEffect(() => {
    if (selected && typeof selected.lon === 'number' && typeof selected.lat === 'number' && !(selected.geometry?.type === 'Polygon' || selected.geometry?.type === 'MultiPolygon')) {
      previewRadiusArea(selected, effectiveRadius)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveRadius])

  const isPointResult = Boolean(selected) && !(selected?.geometry?.type === 'Polygon' || selected?.geometry?.type === 'MultiPolygon')

  const confirmSelection = () => {
    if (!selected) {
      return
    }
    if (selected.geometry && (selected.geometry.type === 'Polygon' || selected.geometry.type === 'MultiPolygon')) {
      onConfirm(createAnalysisArea(selected.geometry, 'geocoder', selected.displayName))
      return
    }
    if (typeof selected.lon === 'number' && typeof selected.lat === 'number') {
      const radius = effectiveRadius
      if (!Number.isFinite(radius) || radius <= 0) {
        setError('Enter a valid radius greater than zero.')
        return
      }
      const circle = turf.circle([selected.lon, selected.lat], radius, { steps: 64, units: 'meters' })
      onConfirm(createAnalysisArea(circle.geometry, 'radius', selected.displayName, radius))
    }
  }

  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      <label htmlFor="place-search">Place name</label>
      <input
        id="place-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Type a city, district or address"
        autoComplete="off"
      />
      {loading ? <p aria-live="polite">Searching…</p> : null}
      {error ? <p role="alert">{error}</p> : null}

      {results.length > 0 ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.25rem', maxHeight: '180px', overflowY: 'auto' }}>
          {results.map((result) => (
            <li key={result.placeId}>
              <button
                type="button"
                onClick={() => selectResult(result)}
                aria-pressed={selected?.placeId === result.placeId}
                style={{ width: '100%', textAlign: 'left', padding: '0.35rem 0.5rem' }}
              >
                <strong>{result.displayName}</strong>
                <br />
                <span style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.85)' }}>{result.type}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {isPointResult ? (
        <div style={{ display: 'grid', gap: '0.35rem' }}>
          <label htmlFor="radius-select">Radius around this point</label>
          <select
            id="radius-select"
            value={customRadius ? 'custom' : radiusMeters}
            onChange={(event) => {
              if (event.target.value === 'custom') {
                setCustomRadius(String(radiusMeters))
                return
              }
              setCustomRadius('')
              setRadiusMeters(Number(event.target.value))
            }}
          >
            {RADIUS_OPTIONS_METERS.map((option) => (
              <option key={option} value={option}>{option >= 1000 ? `${option / 1000} km` : `${option} m`}</option>
            ))}
            <option value="custom">Custom…</option>
          </select>
          {customRadius || customRadius === '0' ? (
            <input
              type="number"
              aria-label="Custom radius in metres"
              min={1}
              value={customRadius}
              onChange={(event) => setCustomRadius(event.target.value)}
            />
          ) : null}
        </div>
      ) : null}

      {selected ? (
        <button type="button" onClick={confirmSelection}>
          Confirm this area
        </button>
      ) : null}
    </div>
  )
}
