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

    return [
      '[out:json][timeout:40];',
      '(',
      `  way["highway"~"^(${highwayClause})$"]["area"!="yes"]${accessExclusions}${bboxClause};`,
      ');',
      'out tags geom;',
    ].join('\n')
  }
}

export const overpassQueryBuilder = new OverpassQueryBuilder()
