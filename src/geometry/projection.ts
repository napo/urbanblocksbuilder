import proj4 from 'proj4'

/**
 * A local metric projection is required because area, perimeter, buffering,
 * noding tolerance and snapping must never be computed directly on WGS84
 * longitude/latitude degrees. We select a UTM zone from the analysis-area
 * centre longitude; this is a documented v1 limitation for areas that
 * straddle a UTM zone boundary or sit at extreme latitudes (see
 * docs/algorithm.md, "Projection selection").
 */
export function getProjectionDefinition(centerLongitude: number, centerLatitude: number): string {
  const zone = Math.min(60, Math.max(1, Math.floor((centerLongitude + 180) / 6) + 1))
  const hemisphere = centerLatitude >= 0 ? '+north' : '+south'
  return `+proj=utm +zone=${zone} ${hemisphere} +datum=WGS84 +units=m +no_defs`
}

export function getProjectionForBbox(bbox: [number, number, number, number]): string {
  const centerLongitude = (bbox[0] + bbox[2]) / 2
  const centerLatitude = (bbox[1] + bbox[3]) / 2
  return getProjectionDefinition(centerLongitude, centerLatitude)
}

export function projectPoint(lon: number, lat: number, projection: string): [number, number] {
  return proj4('EPSG:4326', projection, [lon, lat]) as [number, number]
}

export function unprojectPoint(x: number, y: number, projection: string): [number, number] {
  return proj4(projection, 'EPSG:4326', [x, y]) as [number, number]
}

function projectRing(ring: GeoJSON.Position[], projection: string): GeoJSON.Position[] {
  return ring.map(([lon, lat]) => projectPoint(lon, lat, projection))
}

function unprojectRing(ring: GeoJSON.Position[], projection: string): GeoJSON.Position[] {
  return ring.map(([x, y]) => unprojectPoint(x, y, projection))
}

export function projectGeometry<T extends GeoJSON.Geometry>(geometry: T, projection: string): T {
  switch (geometry.type) {
    case 'Point': {
      const [x, y] = projectPoint(geometry.coordinates[0], geometry.coordinates[1], projection)
      return { type: 'Point', coordinates: [x, y] } as T
    }
    case 'LineString':
      return { type: 'LineString', coordinates: projectRing(geometry.coordinates, projection) } as T
    case 'MultiLineString':
      return {
        type: 'MultiLineString',
        coordinates: geometry.coordinates.map((line) => projectRing(line, projection)),
      } as T
    case 'Polygon':
      return {
        type: 'Polygon',
        coordinates: geometry.coordinates.map((ring) => projectRing(ring, projection)),
      } as T
    case 'MultiPolygon':
      return {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map((polygon) => polygon.map((ring) => projectRing(ring, projection))),
      } as T
    default:
      return geometry
  }
}

export function unprojectGeometry<T extends GeoJSON.Geometry>(geometry: T, projection: string): T {
  switch (geometry.type) {
    case 'Point': {
      const [lon, lat] = unprojectPoint(geometry.coordinates[0], geometry.coordinates[1], projection)
      return { type: 'Point', coordinates: [lon, lat] } as T
    }
    case 'LineString':
      return { type: 'LineString', coordinates: unprojectRing(geometry.coordinates, projection) } as T
    case 'MultiLineString':
      return {
        type: 'MultiLineString',
        coordinates: geometry.coordinates.map((line) => unprojectRing(line, projection)),
      } as T
    case 'Polygon':
      return {
        type: 'Polygon',
        coordinates: geometry.coordinates.map((ring) => unprojectRing(ring, projection)),
      } as T
    case 'MultiPolygon':
      return {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map((polygon) => polygon.map((ring) => unprojectRing(ring, projection))),
      } as T
    default:
      return geometry
  }
}
