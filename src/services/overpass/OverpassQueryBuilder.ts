import type { AnalysisConfig } from '../../domain/types'
import { defaultAnalysisConfig } from '../../config/defaults'

export interface OverpassQueryOptions {
  bbox: [number, number, number, number]
  config?: AnalysisConfig
}

/**
 * Builds the exact Overpass QL query text for a bounding box, honouring the
 * configured highway/access filters and the advanced include toggles. The
 * resulting query string is also what gets stored verbatim in the analysis
 * report, so its exact wording matters.
 *
 * Surface waterways and at-grade railways are requested alongside roads (not
 * as a separate query) because they act as block boundaries in their own
 * right - a stream or rail line can divide two blocks with no parallel road
 * anywhere nearby - so the noding/2-core/polygonize pipeline needs them in
 * the same line network from the start (see analysisPipeline.ts).
 *
 * Building footprints, when requested, are fetched in the same HTTP call as
 * a second named result set output with `out center` (just a point per
 * building, not its full outline) - cheap enough to always ask for, and it
 * avoids doubling the number of Overpass requests. They are used to merge
 * any block with no building inside it into a neighbour (see
 * blockMerging.ts), not for topology, so a point is all that's needed.
 */
export class OverpassQueryBuilder {
  build({ bbox, config = defaultAnalysisConfig }: OverpassQueryOptions): string {
    const [minLon, minLat, maxLon, maxLat] = bbox

    const highwayValues = [
      ...config.highwayFilters,
      ...(config.includeService ? ['service'] : []),
      ...(config.includeTrack ? ['track'] : []),
      ...(config.includeFootway ? ['footway'] : []),
      ...(config.includeCycleway ? ['cycleway'] : []),
      ...(config.includePath ? ['path'] : []),
      ...(config.includeMotorway ? ['motorway'] : []),
      ...(config.includeTrunk ? ['trunk'] : []),
    ]

    const highwayClause = highwayValues.join('|')
    const accessExclusions = config.accessFilters.map((value) => `["access"!="${value}"]`).join('')
    const bboxClause = `(${minLat},${minLon},${maxLat},${maxLon})`

    const separatorClauses = [`  way["highway"~"^(${highwayClause})$"]["area"!="yes"]${accessExclusions}${bboxClause};`]

    if (config.includeWaterway && config.waterwayFilters.length > 0) {
      const waterwayClause = config.waterwayFilters.join('|')
      // Excludes culverts so only surface watercourses count as separators.
      separatorClauses.push(`  way["waterway"~"^(${waterwayClause})$"]["tunnel"!="culvert"]${bboxClause};`)
    }

    if (config.includeRailway && config.railwayFilters.length > 0) {
      const railwayClause = config.railwayFilters.join('|')
      separatorClauses.push(`  way["railway"~"^(${railwayClause})$"]${bboxClause};`)
    }

    const lines = [
      '[out:json][timeout:40];',
      '(',
      ...separatorClauses,
      ')->.separators;',
      '.separators out tags geom;',
    ]

    if (config.mergeBuildinglessBlocks) {
      lines.push(`way["building"]["building"!="no"]${bboxClause}->.buildings;`, '.buildings out center;')
    }

    return lines.join('\n')
  }
}

export const overpassQueryBuilder = new OverpassQueryBuilder()
