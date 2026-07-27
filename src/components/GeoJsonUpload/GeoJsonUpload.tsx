import { useState } from 'react'
import * as turf from '@turf/turf'
import { createAnalysisArea, validateUploadCandidate, MAX_ANALYSIS_AREA_KM2, MAX_UPLOAD_FILE_SIZE_BYTES } from '../../domain/analysisArea'
import type { AnalysisArea } from '../../domain/types'

type PolygonFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>

interface ParsedUpload {
  fileName: string
  singleGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null
  candidateFeatures: PolygonFeature[] | null
}

export interface GeoJsonUploadProps {
  onPreview: (area: AnalysisArea) => void
  onConfirm: (area: AnalysisArea) => void
}

function extractPolygonFeatures(parsed: unknown): { features: PolygonFeature[] | null; typeError: string | null } {
  if (!parsed || typeof parsed !== 'object') {
    return { features: null, typeError: 'The uploaded file does not contain a valid GeoJSON object.' }
  }
  const value = parsed as GeoJSON.GeoJSON

  if (value.type === 'Polygon' || value.type === 'MultiPolygon') {
    return { features: [{ type: 'Feature', properties: {}, geometry: value }], typeError: null }
  }
  if (value.type === 'Feature' && value.geometry && (value.geometry.type === 'Polygon' || value.geometry.type === 'MultiPolygon')) {
    return { features: [value as PolygonFeature], typeError: null }
  }
  if (value.type === 'FeatureCollection') {
    const polygonFeatures = value.features.filter(
      (feature): feature is PolygonFeature => Boolean(feature.geometry) && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon'),
    )
    if (polygonFeatures.length === 0) {
      return { features: null, typeError: 'The FeatureCollection does not contain any Polygon or MultiPolygon features.' }
    }
    return { features: polygonFeatures, typeError: null }
  }

  return { features: null, typeError: `Unsupported GeoJSON type "${value.type}". Upload a Polygon, MultiPolygon, Feature, or FeatureCollection.` }
}

function describeGeometry(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): { areaKm2: number; vertexCount: number } {
  const areaKm2 = turf.area(geometry) / 1_000_000
  const vertexCount = geometry.type === 'Polygon'
    ? geometry.coordinates.reduce((sum, ring) => sum + ring.length, 0)
    : geometry.coordinates.reduce((sum, polygon) => sum + polygon.reduce((innerSum, ring) => innerSum + ring.length, 0), 0)
  return { areaKm2, vertexCount }
}

export function GeoJsonUpload({ onPreview, onConfirm }: GeoJsonUploadProps) {
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [parsed, setParsed] = useState<ParsedUpload | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [pendingGeometry, setPendingGeometry] = useState<GeoJSON.Polygon | GeoJSON.MultiPolygon | null>(null)

  const resetState = () => {
    setParsed(null)
    setPendingGeometry(null)
    setWarnings([])
  }

  const applyCandidate = (geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon, fileName: string) => {
    const validation = validateUploadCandidate(geometry)
    if (validation.errors.length > 0) {
      setError(validation.errors.join(' '))
      setPendingGeometry(null)
      return
    }

    const { areaKm2 } = describeGeometry(geometry)
    const nextWarnings = [...validation.warnings]
    if (areaKm2 > MAX_ANALYSIS_AREA_KM2) {
      setError(`This geometry covers approximately ${Math.round(areaKm2).toLocaleString()} km², which exceeds the ${MAX_ANALYSIS_AREA_KM2.toLocaleString()} km² limit for a single analysis. Upload a smaller area.`)
      setPendingGeometry(null)
      return
    }
    const kinks = geometry.type === 'Polygon' ? turf.kinks(geometry) : null
    if (kinks && kinks.features.length > 0) {
      nextWarnings.push('The polygon appears to self-intersect. Processing will attempt to repair it automatically, but the result should be reviewed.')
    }

    setWarnings(nextWarnings)
    setError(null)
    setPendingGeometry(geometry)
    onPreview(createAnalysisArea(geometry, 'upload', fileName))
  }

  const handleFile = async (file: File) => {
    resetState()
    setError(null)

    if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
      setError(`The file is ${(file.size / (1024 * 1024)).toFixed(1)} MB, which exceeds the ${MAX_UPLOAD_FILE_SIZE_BYTES / (1024 * 1024)} MB limit.`)
      return
    }

    let text: string
    try {
      text = await file.text()
    } catch {
      setError('The file could not be read.')
      return
    }

    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      setError('The uploaded file is not valid JSON.')
      return
    }

    const { features, typeError } = extractPolygonFeatures(json)
    if (!features) {
      setError(typeError)
      return
    }

    if (features.length === 1) {
      setParsed({ fileName: file.name, singleGeometry: features[0].geometry, candidateFeatures: null })
      applyCandidate(features[0].geometry, file.name)
      return
    }

    setParsed({ fileName: file.name, singleGeometry: null, candidateFeatures: features })
  }

  const chooseKeepAsMultiPolygon = () => {
    if (!parsed?.candidateFeatures) return
    const merged: GeoJSON.MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: parsed.candidateFeatures.flatMap((feature) =>
        feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates,
      ),
    }
    applyCandidate(merged, parsed.fileName)
  }

  const chooseMerge = () => {
    if (!parsed?.candidateFeatures) return
    try {
      const union = parsed.candidateFeatures.reduce<PolygonFeature | null>((acc, feature) => {
        if (!acc) return feature
        const result = turf.union(turf.featureCollection([acc, feature]))
        return result && (result.geometry.type === 'Polygon' || result.geometry.type === 'MultiPolygon')
          ? (result as PolygonFeature)
          : acc
      }, null)
      if (union) {
        applyCandidate(union.geometry, parsed.fileName)
      } else {
        setError('Could not merge the uploaded polygons.')
      }
    } catch {
      setError('Could not merge the uploaded polygons: the geometries may be too complex or invalid.')
    }
  }

  const chooseSelectOne = () => {
    if (!parsed?.candidateFeatures) return
    applyCandidate(parsed.candidateFeatures[selectedIndex].geometry, parsed.fileName)
  }

  const cancelUpload = () => {
    resetState()
  }

  const confirmUpload = () => {
    if (!pendingGeometry || !parsed) return
    onConfirm(createAnalysisArea(pendingGeometry, 'upload', parsed.fileName))
  }

  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      <label htmlFor="geojson-upload">GeoJSON file</label>
      <input
        id="geojson-upload"
        type="file"
        accept=".geojson,.json,application/geo+json"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) {
            void handleFile(file)
          }
          event.target.value = ''
        }}
      />
      <p style={{ fontSize: '0.8rem', color: '#475569' }}>
        Uploaded files stay in your browser and are never sent to an application server. Supported types: Polygon, MultiPolygon, Feature, FeatureCollection.
      </p>

      {error ? <p role="alert">{error}</p> : null}
      {warnings.map((warning) => <p key={warning} role="status">{warning}</p>)}

      {parsed?.candidateFeatures && !pendingGeometry ? (
        <div style={{ display: 'grid', gap: '0.5rem', border: '1px solid #e2e8f0', padding: '0.5rem' }}>
          <p>This file contains {parsed.candidateFeatures.length} polygon features. How should they be used?</p>
          <button type="button" onClick={chooseKeepAsMultiPolygon}>Keep as MultiPolygon</button>
          <button type="button" onClick={chooseMerge}>Merge into one polygon</button>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <label htmlFor="feature-select">Select one feature</label>
            <select id="feature-select" value={selectedIndex} onChange={(event) => setSelectedIndex(Number(event.target.value))}>
              {parsed.candidateFeatures.map((feature, index) => (
                <option key={index} value={index}>{feature.properties?.name ?? `Feature ${index + 1}`}</option>
              ))}
            </select>
            <button type="button" onClick={chooseSelectOne}>Use this feature</button>
          </div>
          <button type="button" onClick={cancelUpload}>Cancel upload</button>
        </div>
      ) : null}

      {pendingGeometry ? (
        <div style={{ display: 'grid', gap: '0.35rem' }}>
          <p>
            Preview ready: {Math.round(describeGeometry(pendingGeometry).areaKm2 * 100) / 100} km², {describeGeometry(pendingGeometry).vertexCount} vertices.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" onClick={confirmUpload}>Confirm this area</button>
            <button type="button" onClick={cancelUpload}>Cancel</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
