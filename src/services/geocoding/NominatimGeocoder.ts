import type { Geocoder } from './Geocoder'
import type { GeocodingResult } from '../../domain/types'

export class NominatimGeocoder implements Geocoder {
  private readonly endpoint = 'https://nominatim.openstreetmap.org/search'

  async search(query: string, signal?: AbortSignal): Promise<GeocodingResult[]> {
    if (!query.trim()) {
      return []
    }

    const url = new URL(this.endpoint)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('q', query)
    url.searchParams.set('limit', '8')
    url.searchParams.set('addressdetails', '1')

    const response = await fetch(url, {
      signal,
      headers: {
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error('Place search is temporarily unavailable.')
    }

    const payload = (await response.json()) as Array<{
      place_id: number
      display_name: string
      type: string
      boundingbox?: [string, string, string, string]
      lat?: string
      lon?: string
      geojson?: GeoJSON.Geometry | null
    }>

    return payload.map((item) => {
      const bbox = item.boundingbox
        ? [Number(item.boundingbox[2]), Number(item.boundingbox[0]), Number(item.boundingbox[3]), Number(item.boundingbox[1])] as [number, number, number, number]
        : undefined

      return {
        placeId: String(item.place_id),
        displayName: item.display_name,
        type: item.type,
        bbox,
        geometry: item.geojson ?? null,
        lat: item.lat ? Number(item.lat) : undefined,
        lon: item.lon ? Number(item.lon) : undefined,
      }
    })
  }
}
