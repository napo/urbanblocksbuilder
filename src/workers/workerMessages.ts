import type {
  AnalysisArea,
  AnalysisConfig,
  AnalysisProgress,
  AnalysisReport,
  GridCell,
  UrbanBlockProperties,
} from '../domain/types'
import type { District, DistrictAssignmentStrategy, DistrictStatistics } from '../domain/district'

export const ANALYSIS_PHASES = [
  'Area validation',
  'Complexity estimation',
  'Grid generation',
  'Cell estimation',
  'Overpass acquisition',
  'Way deduplication',
  'Projection',
  'Noding',
  'Graph construction',
  '2-core extraction',
  'Polygonization',
  'Indicator calculation',
  'District assignment',
  'Export preparation',
  'Completed',
] as const

export type AnalysisPhase = (typeof ANALYSIS_PHASES)[number]

export type WorkerMessageType =
  | 'start'
  | 'progress'
  | 'warning'
  | 'partial-result'
  | 'completed-result'
  | 'cancellation-request'
  | 'cancellation-confirmed'
  | 'processing-error'

export interface WorkerMessage<TPayload = unknown> {
  type: WorkerMessageType
  payload?: TPayload
}

export interface StartMessage extends WorkerMessage {
  type: 'start'
  payload: {
    fixtureMode: boolean
    area: AnalysisArea
    config: AnalysisConfig
    districts: District[]
    districtStrategy: DistrictAssignmentStrategy
  }
}

export interface ProgressMessage extends WorkerMessage {
  type: 'progress'
  payload: AnalysisProgress
}

export interface WarningMessage extends WorkerMessage {
  type: 'warning'
  payload: { message: string }
}

export type NamedFeatureCollection<P = Record<string, unknown>> = GeoJSON.FeatureCollection<GeoJSON.Geometry, P>

export interface CompletedResultPayload {
  blocks: GeoJSON.FeatureCollection<GeoJSON.Polygon, UrbanBlockProperties>
  originalRoads: NamedFeatureCollection
  nodedRoads: NamedFeatureCollection
  removedBranches: NamedFeatureCollection
  twoCoreRoads: NamedFeatureCollection
  grid: NamedFeatureCollection<{ id: string; state: GridCell['state']; depth: number }>
  districtStatistics: DistrictStatistics[]
  projection: string
  report: AnalysisReport
}

export interface CompletedResultMessage extends WorkerMessage {
  type: 'completed-result'
  payload: CompletedResultPayload
}

export interface ProcessingErrorMessage extends WorkerMessage {
  type: 'processing-error'
  payload: { message: string; phase?: string }
}

export interface CancellationConfirmedMessage extends WorkerMessage {
  type: 'cancellation-confirmed'
}

export type IncomingWorkerMessage = StartMessage | { type: 'cancellation-request' }
export type OutgoingWorkerMessage =
  | ProgressMessage
  | WarningMessage
  | CompletedResultMessage
  | ProcessingErrorMessage
  | CancellationConfirmedMessage
