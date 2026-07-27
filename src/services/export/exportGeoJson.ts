import { appName, appVersion } from '../../config/defaults'

/**
 * Mirrors the root attributes OSM's own API puts on every XML response
 * (`<osm version="0.6" generator="..." copyright="OpenStreetMap and
 * contributors" attribution="http://www.openstreetmap.org/copyright"
 * license="http://opendatacommons.org/licenses/odbl/1-0/">`), so anyone
 * who has seen an Overpass/API response recognises the same convention
 * here - a generator, a copyright line, and attribution/license URLs.
 */
export const OSM_DATA_ATTRIBUTION = {
  copyright: 'OpenStreetMap and contributors',
  attribution: 'http://www.openstreetmap.org/copyright',
  license: 'http://opendatacommons.org/licenses/odbl/1-0/',
} as const

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Every FeatureCollection this application exports is derived from
 * OpenStreetMap data, so a `metadata` member carrying the licence and
 * attribution is always attached alongside `type`/`features` - not just
 * mentioned in the UI. `metadata` is not part of the GeoJSON spec (RFC
 * 7946 allows foreign members), but it is a widely recognised convention
 * for exactly this purpose, so a `metadata` key rather than flat top-level
 * fields keeps it self-describing and avoids any risk of colliding with a
 * real GeoJSON member name.
 */
export function exportGeoJson(filename: string, featureCollection: GeoJSON.FeatureCollection): void {
  const withMetadata = {
    ...featureCollection,
    metadata: {
      generator: `${appName} ${appVersion}`,
      generatedAt: new Date().toISOString(),
      ...OSM_DATA_ATTRIBUTION,
    },
  }
  downloadBlob(filename, new Blob([JSON.stringify(withMetadata, null, 2)], { type: 'application/geo+json' }))
}

export function exportJson(filename: string, data: unknown): void {
  downloadBlob(filename, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
}
