import { describe, expect, it } from 'vitest'
import { createAnalysisArea, normalizeGeoJsonGeometry, validateGeometry } from '../domain/analysisArea'

describe('analysis area utilities', () => {
  it('creates an analysis area from a polygon', () => {
    const polygon: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0, 0.01],
          [0.01, 0.01],
          [0.01, 0],
          [0, 0],
        ],
      ],
    }

    const area = createAnalysisArea(polygon, 'upload', 'Test area')
    expect(area.name).toBe('Test area')
    expect(area.areaKm2).toBeGreaterThan(0)
  })

  it('normalizes a GeoJSON feature collection into a polygon geometry', () => {
    const parsed = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [0, 0.01],
                [0.01, 0.01],
                [0.01, 0],
                [0, 0],
              ],
            ],
          },
        },
      ],
    }

    const geometry = normalizeGeoJsonGeometry(parsed)
    expect(geometry?.type).toBe('Polygon')
  })

  it('rejects invalid coordinates outside WGS84 bounds', () => {
    const polygon: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [200, 0],
          [200, 0.01],
          [201, 0.01],
          [201, 0],
          [200, 0],
        ],
      ],
    }

    const errors = validateGeometry(polygon)
    expect(errors.length).toBeGreaterThan(0)
  })
})
