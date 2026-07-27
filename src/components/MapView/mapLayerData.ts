import type { AnalysisArea, UrbanBlock, UrbanBlockProperties } from '../../domain/types'
import type { District } from '../../domain/district'

export function buildAreaFeatureCollection(area: AnalysisArea | null): GeoJSON.FeatureCollection {
  if (!area) {
    return { type: 'FeatureCollection', features: [] }
  }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: area.geometry,
      properties: { name: area.name ?? 'Analysis area' },
    }],
  }
}

export function buildBlocksFeatureCollection(blocks: UrbanBlock[]): GeoJSON.FeatureCollection<GeoJSON.Polygon, UrbanBlockProperties> {
  return {
    type: 'FeatureCollection',
    features: blocks.map((block) => ({
      type: 'Feature',
      geometry: block.geometry,
      properties: block.properties,
    })),
  }
}

export function buildDistrictsFeatureCollection(districts: District[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: districts.map((district) => ({
      type: 'Feature',
      geometry: district.geometry,
      properties: { districtId: district.id, name: district.name ?? district.id },
    })),
  }
}

export function buildSingleFeatureCollection<T extends GeoJSON.Feature | undefined>(feature: T): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: feature ? [feature] : [] }
}
