import type { AnalysisConfig } from '../domain/types'
import { defaultGridThresholds, defaultLargeBlockAreaThresholdM2, defaultSmallArtifactAreaThresholdM2 } from './thresholds'

export const appName = 'UrbanBlocksBuilder'
export const appVersion = '0.1.0'
export const algorithmVersion = 'v0.1.0'
export const defaultOverpassEndpoint = 'https://overpass-api.de/api/interpreter'

/**
 * Public Overpass instances to rotate through when one is slow, rate-limited,
 * or erroring - the primary is tried first, and failed retries move on to
 * the next entry (see OverpassClient's `rotateEndpoints` option).
 */
export const fallbackOverpassEndpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

export const defaultHighwayFilters = ['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'road', 'pedestrian']

export const defaultAnalysisConfig: AnalysisConfig = {
  queryVersion: 'v1',
  algorithmVersion,
  endpoint: defaultOverpassEndpoint,
  endpoints: fallbackOverpassEndpoints,
  highwayFilters: defaultHighwayFilters,
  accessFilters: ['no', 'private'],
  includeService: false,
  includeTrack: false,
  includeFootway: false,
  includeCycleway: false,
  includePath: false,
  includeMotorway: false,
  includeTrunk: false,
  contextBufferMeters: defaultGridThresholds.contextBufferMeters,
  initialCellSizeMeters: defaultGridThresholds.initialCellSizeMeters,
  maxDepth: defaultGridThresholds.maxDepth,
  maxWaysPerCell: defaultGridThresholds.maxWaysPerCell,
  maxCoordinatesPerCell: defaultGridThresholds.maxCoordinatesPerCell,
  maxResponseSizeKb: defaultGridThresholds.maxResponseSizeKb,
  maxRetries: defaultGridThresholds.maxRetries,
  concurrency: 2,
  snappingToleranceMeters: 3,
  minAreaM2: defaultSmallArtifactAreaThresholdM2,
  maxAreaM2: 20000000,
  largeBlockAreaThresholdM2: defaultLargeBlockAreaThresholdM2,
}

/**
 * Fixture road network for offline demo mode: a closed square block (four
 * ways sharing corner nodes, so noding + the 2-core keep them all) plus one
 * terminal branch dangling off a corner, so 2-core extraction has something
 * real to remove. At this coordinate scale (~0.001 degrees) the block is
 * roughly 110 m x 110 m, comfortably between the default small-artifact and
 * large-block-area thresholds.
 */
export const fixtureRoads = [
  {
    id: 'fixture-square-north',
    coordinates: [
      [0.0, 0.0],
      [0.0, 0.001],
    ],
  },
  {
    id: 'fixture-square-east',
    coordinates: [
      [0.0, 0.001],
      [0.001, 0.001],
    ],
  },
  {
    id: 'fixture-square-south',
    coordinates: [
      [0.001, 0.001],
      [0.001, 0.0],
    ],
  },
  {
    id: 'fixture-square-west',
    coordinates: [
      [0.001, 0.0],
      [0.0, 0.0],
    ],
  },
  {
    id: 'fixture-terminal-branch',
    coordinates: [
      [0.0, 0.0],
      [-0.0007, -0.0007],
    ],
  },
] as const
