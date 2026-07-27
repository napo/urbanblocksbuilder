import type { AnalysisConfig } from '../../domain/types'
import { defaultAnalysisConfig } from '../../config/defaults'
import { describeOverpassError } from './OverpassErrors'
import { OverpassEndpointRotation } from './OverpassEndpoints'
import { OverpassQueryBuilder } from './OverpassQueryBuilder'
import type { OverpassResponse } from './OverpassParser'

export { parseOverpassWays, deduplicateOsmWays } from './OverpassParser'
export type { OverpassResponse } from './OverpassParser'

/** Tags guaranteed to be present in every parsed way, via `out tags geom`. */
export const REQUESTED_TAGS = ['highway', 'bridge', 'tunnel', 'layer', 'access', 'service', 'area', 'covered', 'junction', 'name', 'oneway']

export interface OverpassClientOptions {
  timeoutMs?: number
  rotateEndpoints?: boolean
}

/**
 * A minimal, dependency-free Overpass HTTP client. Endpoint rotation,
 * timeouts and readable errors live here so callers (the grid scheduler)
 * only deal with a promise that resolves to parsed elements or rejects with
 * a user-facing message.
 */
export class OverpassClient {
  private readonly config: AnalysisConfig
  private readonly rotation: OverpassEndpointRotation
  private readonly timeoutMs: number
  private readonly rotateEndpoints: boolean
  private readonly queryBuilder = new OverpassQueryBuilder()

  constructor(config: AnalysisConfig = defaultAnalysisConfig, options: OverpassClientOptions = {}) {
    this.config = config
    this.rotation = new OverpassEndpointRotation(config.endpoints.length > 0 ? config.endpoints : [config.endpoint])
    this.timeoutMs = options.timeoutMs ?? 45000
    this.rotateEndpoints = options.rotateEndpoints ?? false
  }

  buildRoadQuery(bbox: [number, number, number, number]): string {
    return this.queryBuilder.build({ bbox, config: this.config })
  }

  async query(bbox: [number, number, number, number], query?: string, signal?: AbortSignal): Promise<OverpassResponse> {
    const endpoint = this.rotateEndpoints ? this.rotation.next() : this.rotation.current()
    const body = query ?? this.buildRoadQuery(bbox)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    const combinedSignal = signal ? anySignal([signal, controller.signal]) : controller.signal

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(body)}`,
        signal: combinedSignal,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })

      if (!response.ok) {
        throw new Error(`Overpass request failed with HTTP ${response.status}`)
      }

      return (await response.json()) as OverpassResponse
    } catch (error) {
      throw describeOverpassError(error)
    } finally {
      clearTimeout(timeout)
    }
  }
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort()
      break
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return controller.signal
}
