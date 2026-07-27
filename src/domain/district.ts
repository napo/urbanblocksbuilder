export type DistrictSource = 'geocoder' | 'upload' | 'osm-boundary' | 'drawn'

export interface District {
  id: string
  name?: string
  source: DistrictSource
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
  bbox: [number, number, number, number]
  areaKm2: number
}

export type DistrictAssignmentStrategy = 'largest-overlap' | 'point-on-surface' | 'intersection'

export interface DistrictStatistics {
  districtId: string
  districtName?: string
  blockCount: number
  meanBlockAreaM2: number
  medianBlockAreaM2: number
  minBlockAreaM2: number
  maxBlockAreaM2: number
  firstQuartileAreaM2: number
  thirdQuartileAreaM2: number
  meanCompactness: number
  totalBlockAreaM2: number
  areaClassDistribution: Record<string, number>
  percentAboveAreaThreshold: number
  percentDistrictAreaAnalysed: number
}
