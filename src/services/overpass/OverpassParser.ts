import type { OSMWay } from '../../domain/types'

export interface OverpassResponse {
  elements: Array<{
    type: string
    id: number
    lat?: number
    lon?: number
    tags?: Record<string, string>
    geometry?: Array<{ lat: number; lon: number }>
    nodes?: number[]
  }>
}

export function parseOverpassWays(response: OverpassResponse): OSMWay[] {
  return (response.elements ?? [])
    .filter((element) => element.type === 'way' && (element.geometry?.length ?? 0) >= 2)
    .map((element) => ({
      id: `${element.id}`,
      tags: element.tags ?? {},
      coordinates: (element.geometry ?? []).map((point) => [point.lon, point.lat] as [number, number]),
      logicalLevel: 0,
      sourceCellIds: [] as string[],
      originalGeometry: {
        type: 'LineString' as const,
        coordinates: (element.geometry ?? []).map((point) => [point.lon, point.lat] as [number, number]),
      },
      status: 'downloaded' as const,
    }))
}

/**
 * Deduplicates ways downloaded from overlapping (buffered) grid cells by OSM
 * way ID. When the same way was returned by more than one cell, the most
 * complete geometry (most coordinates) is kept, and the cell references are
 * merged so the source cells remain traceable.
 */
export function deduplicateOsmWays(ways: OSMWay[]): OSMWay[] {
  const byId = new Map<string, OSMWay>()

  for (const way of ways) {
    const existing = byId.get(way.id)
    if (!existing) {
      byId.set(way.id, { ...way, status: 'deduped' })
      continue
    }

    const merged: OSMWay = {
      ...(way.coordinates.length > existing.coordinates.length ? way : existing),
      sourceCellIds: Array.from(new Set([...existing.sourceCellIds, ...way.sourceCellIds])),
      status: 'deduped',
    }
    byId.set(way.id, merged)
  }

  return Array.from(byId.values())
}
