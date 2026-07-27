import type { GeocodingResult } from '../../domain/types'

export interface Geocoder {
  search(query: string, signal?: AbortSignal): Promise<GeocodingResult[]>
}
