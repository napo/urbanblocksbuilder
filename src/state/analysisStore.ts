import { create } from 'zustand'
import type { AnalysisArea, AnalysisConfig, AnalysisProgress, AnalysisReport, AnalysisSource, UrbanBlock } from '../domain/types'
import type { District, DistrictAssignmentStrategy, DistrictStatistics } from '../domain/district'
import { defaultAnalysisConfig } from '../config/defaults'
import type { DrawingMode } from '../components/AreaSelector/drawingSelection'
import type { NamedFeatureCollection } from '../workers/workerMessages'
import { DEFAULT_CHOROPLETH_PALETTE, type BlockStyleAttribute, type ChoroplethPalette, type ClassificationMethod } from '../components/MapView/blockStyling'

export interface LayerVisibility {
  analysisArea: boolean
  districts: boolean
  grid: boolean
  originalRoads: boolean
  nodedRoads: boolean
  removedBranches: boolean
  twoCoreRoads: boolean
  blocks: boolean
}

/** Applied once a result exists: only the urban blocks stand out over the basemap. */
const BLOCKS_ONLY_LAYER_VISIBILITY: LayerVisibility = {
  analysisArea: false,
  districts: false,
  grid: false,
  originalRoads: false,
  nodedRoads: false,
  removedBranches: false,
  twoCoreRoads: false,
  blocks: true,
}

const emptyFeatureCollection: NamedFeatureCollection = { type: 'FeatureCollection', features: [] }
const emptyGridFeatureCollection: NamedFeatureCollection<{ id: string; state: string; depth: number }> = {
  type: 'FeatureCollection',
  features: [],
}

interface AnalysisState {
  selectedArea: AnalysisArea | null
  previewArea: AnalysisArea | null
  config: AnalysisConfig
  progress: AnalysisProgress | null
  blocks: UrbanBlock[]
  originalRoads: NamedFeatureCollection
  nodedRoads: NamedFeatureCollection
  removedBranches: NamedFeatureCollection
  twoCoreRoads: NamedFeatureCollection
  grid: NamedFeatureCollection<{ id: string; state: string; depth: number }>
  districts: District[]
  districtStrategy: DistrictAssignmentStrategy
  districtStatistics: DistrictStatistics[]
  report: AnalysisReport | null
  isProcessing: boolean
  areaSelectionMode: Extract<AnalysisSource, 'geocoder' | 'upload' | 'rectangle' | 'polygon'>
  drawingMode: DrawingMode
  /** Bumped every time the user (re-)selects a drawing tool, even if the mode string doesn't change, so the map always starts a fresh drawing session. */
  drawSessionToken: number
  layerVisibility: LayerVisibility
  selectedBlockId: string | null
  selectedDistrictId: string | null
  warnings: string[]
  errors: string[]
  cacheStatus: string
  blockStyleAttribute: BlockStyleAttribute
  classificationMethod: ClassificationMethod
  manualBreaks: number[]
  blockColorPalette: ChoroplethPalette
  fixtureMode: boolean

  setSelectedArea: (area: AnalysisArea | null) => void
  setPreviewArea: (area: AnalysisArea | null) => void
  setConfig: (config: AnalysisConfig) => void
  setProgress: (progress: AnalysisProgress | null) => void
  setBlocks: (blocks: UrbanBlock[]) => void
  setRoadLayers: (layers: {
    originalRoads: NamedFeatureCollection
    nodedRoads: NamedFeatureCollection
    removedBranches: NamedFeatureCollection
    twoCoreRoads: NamedFeatureCollection
  }) => void
  setGrid: (grid: NamedFeatureCollection<{ id: string; state: string; depth: number }>) => void
  setDistricts: (districts: District[]) => void
  setDistrictStrategy: (strategy: DistrictAssignmentStrategy) => void
  setDistrictStatistics: (statistics: DistrictStatistics[]) => void
  setReport: (report: AnalysisReport | null) => void
  setProcessing: (value: boolean) => void
  setAreaSelectionMode: (mode: AnalysisState['areaSelectionMode']) => void
  setDrawingMode: (mode: DrawingMode) => void
  startNewDrawingSession: () => void
  toggleLayer: (layer: keyof LayerVisibility) => void
  showOnlyBlocksLayer: () => void
  setSelectedBlockId: (blockId: string | null) => void
  setSelectedDistrictId: (districtId: string | null) => void
  addWarning: (message: string) => void
  addError: (message: string) => void
  clearMessages: () => void
  setCacheStatus: (status: string) => void
  setBlockStyleAttribute: (attribute: BlockStyleAttribute) => void
  setClassificationMethod: (method: ClassificationMethod) => void
  setBlockColorPalette: (palette: ChoroplethPalette) => void
  setManualBreaks: (breaks: number[]) => void
  setFixtureMode: (value: boolean) => void
  resetResults: () => void
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  selectedArea: null,
  previewArea: null,
  config: defaultAnalysisConfig,
  progress: null,
  blocks: [],
  originalRoads: emptyFeatureCollection,
  nodedRoads: emptyFeatureCollection,
  removedBranches: emptyFeatureCollection,
  twoCoreRoads: emptyFeatureCollection,
  grid: emptyGridFeatureCollection,
  districts: [],
  districtStrategy: 'largest-overlap',
  districtStatistics: [],
  report: null,
  isProcessing: false,
  areaSelectionMode: 'geocoder',
  drawingMode: 'rectangle',
  drawSessionToken: 0,
  layerVisibility: {
    analysisArea: true,
    districts: true,
    grid: false,
    originalRoads: false,
    nodedRoads: false,
    removedBranches: false,
    twoCoreRoads: false,
    blocks: true,
  },
  selectedBlockId: null,
  selectedDistrictId: null,
  warnings: [],
  errors: [],
  cacheStatus: 'No cache activity yet.',
  blockStyleAttribute: 'area',
  classificationMethod: 'quantile',
  manualBreaks: [],
  blockColorPalette: DEFAULT_CHOROPLETH_PALETTE,
  fixtureMode: false,

  setSelectedArea: (area) => set({ selectedArea: area }),
  setPreviewArea: (area) => set({ previewArea: area }),
  setConfig: (config) => set({ config }),
  setProgress: (progress) => set({ progress }),
  setBlocks: (blocks) => set({ blocks }),
  setRoadLayers: (layers) => set(layers),
  setGrid: (grid) => set({ grid }),
  setDistricts: (districts) => set({ districts }),
  setDistrictStrategy: (strategy) => set({ districtStrategy: strategy }),
  setDistrictStatistics: (statistics) => set({ districtStatistics: statistics }),
  setReport: (report) => set({ report }),
  setProcessing: (value) => set({ isProcessing: value }),
  setAreaSelectionMode: (mode) => set({ areaSelectionMode: mode }),
  setDrawingMode: (mode) => set({ drawingMode: mode }),
  startNewDrawingSession: () => set((state) => ({ drawSessionToken: state.drawSessionToken + 1 })),
  toggleLayer: (layer) => set((state) => ({
    layerVisibility: { ...state.layerVisibility, [layer]: !state.layerVisibility[layer] },
  })),
  showOnlyBlocksLayer: () => set({ layerVisibility: { ...BLOCKS_ONLY_LAYER_VISIBILITY } }),
  setSelectedBlockId: (blockId) => set({ selectedBlockId: blockId }),
  setSelectedDistrictId: (districtId) => set({ selectedDistrictId: districtId }),
  addWarning: (message) => set((state) => ({ warnings: [...state.warnings, message] })),
  addError: (message) => set((state) => ({ errors: [...state.errors, message] })),
  clearMessages: () => set({ warnings: [], errors: [] }),
  setCacheStatus: (status) => set({ cacheStatus: status }),
  setBlockStyleAttribute: (attribute) => set({ blockStyleAttribute: attribute }),
  setClassificationMethod: (method) => set({ classificationMethod: method }),
  setBlockColorPalette: (palette) => set({ blockColorPalette: palette }),
  setManualBreaks: (breaks) => set({ manualBreaks: breaks }),
  setFixtureMode: (value) => set({ fixtureMode: value }),
  resetResults: () => set({
    blocks: [],
    originalRoads: emptyFeatureCollection,
    nodedRoads: emptyFeatureCollection,
    removedBranches: emptyFeatureCollection,
    twoCoreRoads: emptyFeatureCollection,
    grid: emptyGridFeatureCollection,
    districtStatistics: [],
    report: null,
    warnings: [],
    errors: [],
    selectedBlockId: null,
    selectedDistrictId: null,
  }),
}))
