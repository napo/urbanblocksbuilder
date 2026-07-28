import { InteriorPointArea } from 'jsts/org/locationtech/jts/algorithm.js'
import { createGeometryFactory, toJstsGeometry, type JstsGeometry } from './validation'
import { polygonBbox, bboxesOverlap, type Bbox } from './bbox'
import type { DistrictAssignmentStrategy, DistrictStatistics } from '../domain/district'

export interface DistrictAssignmentBlockInput {
  blockId: string
  polygonMetric: GeoJSON.Polygon
  areaM2: number
  compactness: number
}

export interface DistrictAssignmentDistrictInput {
  districtId: string
  districtName?: string
  polygonMetric: GeoJSON.Polygon | GeoJSON.MultiPolygon
  areaM2: number
}

export interface DistrictAssignmentResult {
  blockId: string
  districtId: string | null
  overlapRatio: number
}

function intersectionArea(a: JstsGeometry, b: JstsGeometry): number {
  try {
    const intersection = (a as unknown as { intersection: (other: JstsGeometry) => JstsGeometry }).intersection(b)
    return (intersection as unknown as { getArea: () => number }).getArea()
  } catch {
    return 0
  }
}

/**
 * Assigns each urban block to at most one district using either the largest
 * geometric overlap (default) or point-on-surface containment. Blocks are
 * never split for this assignment - `areaM2` on the block always stays the
 * whole-block planar area computed in indicators.ts.
 */
export function assignBlocksToDistricts(
  blocks: DistrictAssignmentBlockInput[],
  districts: DistrictAssignmentDistrictInput[],
  strategy: Exclude<DistrictAssignmentStrategy, 'intersection'>,
  toleranceMeters: number,
): DistrictAssignmentResult[] {
  if (districts.length === 0) {
    return blocks.map((block) => ({ blockId: block.blockId, districtId: null, overlapRatio: 0 }))
  }

  const factory = createGeometryFactory(toleranceMeters)
  // Precompute each district's bbox once so every block can cheaply skip the
  // (much more expensive) JSTS intersection/point-in-polygon test against
  // districts it cannot possibly overlap - without this, assignment cost is
  // blocks x districts unconditionally, which is the actual bottleneck for
  // a city-sized analysis with many districts (JSTS calls dominate; the bbox
  // check is a handful of comparisons).
  const districtGeometries = districts.map((district) => ({
    districtId: district.districtId,
    geometry: toJstsGeometry(district.polygonMetric, factory) as JstsGeometry,
    bbox: polygonBbox(district.polygonMetric),
  }))

  return blocks.map((block) => {
    let blockGeometry: JstsGeometry
    try {
      blockGeometry = toJstsGeometry(block.polygonMetric, factory) as JstsGeometry
    } catch {
      return { blockId: block.blockId, districtId: null, overlapRatio: 0 }
    }
    const blockBbox = polygonBbox(block.polygonMetric)
    const candidateDistricts = districtGeometries.filter((district) => bboxesOverlap(blockBbox, district.bbox))

    if (strategy === 'point-on-surface') {
      const interiorPoint = InteriorPointArea.getInteriorPoint(blockGeometry)
      if (!interiorPoint) {
        return { blockId: block.blockId, districtId: null, overlapRatio: 0 }
      }
      const point = (factory as unknown as { createPoint: (coordinate: unknown) => JstsGeometry }).createPoint(interiorPoint)
      const pointBbox: Bbox = [interiorPoint.x, interiorPoint.y, interiorPoint.x, interiorPoint.y]
      for (const district of candidateDistricts) {
        if (!bboxesOverlap(pointBbox, district.bbox)) continue
        const contains = (district.geometry as unknown as { intersects: (other: JstsGeometry) => boolean }).intersects(point)
        if (contains) {
          return { blockId: block.blockId, districtId: district.districtId, overlapRatio: 1 }
        }
      }
      return { blockId: block.blockId, districtId: null, overlapRatio: 0 }
    }

    let bestDistrictId: string | null = null
    let bestArea = 0
    for (const district of candidateDistricts) {
      const area = intersectionArea(blockGeometry, district.geometry)
      if (area > bestArea) {
        bestArea = area
        bestDistrictId = district.districtId
      }
    }

    const overlapRatio = block.areaM2 > 0 ? Math.min(1, bestArea / block.areaM2) : 0
    return { blockId: block.blockId, districtId: bestDistrictId, overlapRatio }
  })
}

/**
 * Computes per-district statistics. The 'intersection' strategy distributes
 * each block's area across every district it overlaps, proportionally to
 * the overlap area, instead of committing the whole block to a single
 * district - this is the statistical-allocation mode requested for district
 * area totals when blocks straddle a boundary.
 */
export function computeDistrictStatistics(
  blocks: DistrictAssignmentBlockInput[],
  districts: DistrictAssignmentDistrictInput[],
  assignments: DistrictAssignmentResult[],
  strategy: DistrictAssignmentStrategy,
  toleranceMeters: number,
  largeAreaThresholdM2: number,
): DistrictStatistics[] {
  const factory = createGeometryFactory(toleranceMeters)
  const districtGeometries = districts.map((district) => ({
    districtId: district.districtId,
    districtName: district.districtName,
    areaM2: district.areaM2,
    geometry: toJstsGeometry(district.polygonMetric, factory) as JstsGeometry,
    bbox: polygonBbox(district.polygonMetric),
  }))

  const contributionsByDistrict = new Map<string, Array<{ areaM2: number; compactness: number }>>()
  for (const district of districts) {
    contributionsByDistrict.set(district.districtId, [])
  }

  if (strategy === 'intersection') {
    for (const block of blocks) {
      let blockGeometry: JstsGeometry
      try {
        blockGeometry = toJstsGeometry(block.polygonMetric, factory) as JstsGeometry
      } catch {
        continue
      }
      const blockBbox = polygonBbox(block.polygonMetric)
      for (const district of districtGeometries) {
        if (!bboxesOverlap(blockBbox, district.bbox)) continue
        const overlap = intersectionArea(blockGeometry, district.geometry)
        if (overlap > 0) {
          contributionsByDistrict.get(district.districtId)?.push({ areaM2: overlap, compactness: block.compactness })
        }
      }
    }
  } else {
    const blocksById = new Map(blocks.map((block) => [block.blockId, block]))
    for (const assignment of assignments) {
      if (!assignment.districtId) {
        continue
      }
      const block = blocksById.get(assignment.blockId)
      if (!block) {
        continue
      }
      contributionsByDistrict.get(assignment.districtId)?.push({ areaM2: block.areaM2, compactness: block.compactness })
    }
  }

  return districtGeometries.map((district) => {
    const contributions = contributionsByDistrict.get(district.districtId) ?? []
    const areas = contributions.map((entry) => entry.areaM2).sort((a, b) => a - b)
    const totalBlockAreaM2 = areas.reduce((sum, value) => sum + value, 0)
    const meanCompactness = contributions.length > 0
      ? contributions.reduce((sum, entry) => sum + entry.compactness, 0) / contributions.length
      : 0

    return {
      districtId: district.districtId,
      districtName: district.districtName,
      blockCount: contributions.length,
      meanBlockAreaM2: contributions.length > 0 ? totalBlockAreaM2 / contributions.length : 0,
      medianBlockAreaM2: percentile(areas, 0.5),
      minBlockAreaM2: areas.length > 0 ? areas[0] : 0,
      maxBlockAreaM2: areas.length > 0 ? areas[areas.length - 1] : 0,
      firstQuartileAreaM2: percentile(areas, 0.25),
      thirdQuartileAreaM2: percentile(areas, 0.75),
      meanCompactness,
      totalBlockAreaM2,
      areaClassDistribution: buildAreaClassDistribution(areas),
      percentAboveAreaThreshold: areas.length > 0
        ? (areas.filter((value) => value > largeAreaThresholdM2).length / areas.length) * 100
        : 0,
      percentDistrictAreaAnalysed: district.areaM2 > 0 ? Math.min(100, (totalBlockAreaM2 / district.areaM2) * 100) : 0,
    }
  })
}

function percentile(sortedValues: number[], fraction: number): number {
  if (sortedValues.length === 0) {
    return 0
  }
  const index = (sortedValues.length - 1) * fraction
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) {
    return sortedValues[lower]
  }
  const weight = index - lower
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight
}

const AREA_CLASS_BOUNDARIES_M2 = [1000, 5000, 20000, 50000, 100000]

function buildAreaClassDistribution(areas: number[]): Record<string, number> {
  const labels = [
    `< ${AREA_CLASS_BOUNDARIES_M2[0]} m²`,
    ...AREA_CLASS_BOUNDARIES_M2.slice(0, -1).map((value, index) => `${value}-${AREA_CLASS_BOUNDARIES_M2[index + 1]} m²`),
    `> ${AREA_CLASS_BOUNDARIES_M2[AREA_CLASS_BOUNDARIES_M2.length - 1]} m²`,
  ]
  const counts = new Array(labels.length).fill(0)

  for (const area of areas) {
    let bucket = labels.length - 1
    for (let i = 0; i < AREA_CLASS_BOUNDARIES_M2.length; i += 1) {
      if (area < AREA_CLASS_BOUNDARIES_M2[i]) {
        bucket = i
        break
      }
    }
    counts[bucket] += 1
  }

  return Object.fromEntries(labels.map((label, index) => [label, counts[index]]))
}
