import { appName, appVersion } from '../../config/defaults'
import type { AnalysisArea, AnalysisConfig, AnalysisReport } from '../../domain/types'
import type { DistrictStatistics } from '../../domain/district'
import { exportJson, OSM_DATA_ATTRIBUTION } from './exportGeoJson'

export const OSM_ATTRIBUTION = `${OSM_DATA_ATTRIBUTION.copyright} - ${OSM_DATA_ATTRIBUTION.attribution}`

export interface BuildAnalysisReportInput {
  area: AnalysisArea
  config: AnalysisConfig
  projection: string
  exactQueries: string[]
  overpassEndpoints: string[]
  gridConfiguration: Record<string, number>
  acquisitionStatistics: Record<string, number>
  geometryStatistics: Record<string, number>
  districtStatistics: DistrictStatistics[]
  warnings: string[]
  errors: string[]
  cacheInformation: Record<string, unknown>
}

export function buildAnalysisReport(input: BuildAnalysisReportInput): AnalysisReport {
  return {
    applicationName: appName,
    applicationVersion: appVersion,
    algorithmVersion: input.config.algorithmVersion,
    generatedAt: new Date().toISOString(),
    analysisAreaName: input.area.name,
    analysisAreaSummary: `${input.area.source} selection, ${input.area.areaKm2.toFixed(3)} km², bbox [${input.area.bbox.map((value) => value.toFixed(5)).join(', ')}]`,
    configuration: input.config,
    highwayFilters: input.config.highwayFilters,
    accessFilters: input.config.accessFilters,
    overpassEndpoints: input.overpassEndpoints,
    exactQueries: input.exactQueries,
    projection: input.projection,
    tolerances: {
      snappingToleranceMeters: input.config.snappingToleranceMeters,
      minAreaM2: input.config.minAreaM2,
      maxAreaM2: input.config.maxAreaM2,
    },
    gridConfiguration: input.gridConfiguration,
    acquisitionStatistics: input.acquisitionStatistics,
    geometryStatistics: input.geometryStatistics,
    districtStatistics: { districts: input.districtStatistics },
    warnings: input.warnings,
    errors: input.errors,
    cacheInformation: input.cacheInformation,
    osmAttribution: OSM_ATTRIBUTION,
    dataLicense: OSM_DATA_ATTRIBUTION.license,
  }
}

export function downloadAnalysisReport(report: AnalysisReport): void {
  exportJson(`urban-blocks-builder-report-${report.generatedAt.replace(/[:.]/g, '-')}.json`, report)
}
