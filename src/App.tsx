import { useEffect, useMemo, useState } from 'react'
import { AreaSelector } from './components/AreaSelector/AreaSelector'
import { MapView } from './components/MapView/MapView'
import { ResultsPanel } from './components/ResultsPanel/ResultsPanel'
import { AnalysisControls } from './components/AnalysisControls/AnalysisControls'
import { ProgressOverlay } from './components/AnalysisProgress/ProgressOverlay'
import { LayerControl } from './components/LayerControl/LayerControl'
import { DistrictPanel } from './components/DistrictPanel/DistrictPanel'
import { ExportPanel } from './components/ExportPanel/ExportPanel'
import { ErrorPanel } from './components/ErrorPanel/ErrorPanel'
import { Stepper, type WizardStep } from './components/Wizard/Stepper'
import { Tabs } from './components/Wizard/Tabs'
import { AboutModal } from './components/About/AboutModal'
import { useAnalysisStore } from './state/analysisStore'
import type { AnalysisArea } from './domain/types'
import { appName, appVersion } from './config/defaults'
import { GeometryWorkerClient } from './workers/workerClient'
import './App.css'

function App() {
  const [wizardStep, setWizardStep] = useState<WizardStep>('area')
  const [isAboutOpen, setIsAboutOpen] = useState(false)

  const setSelectedArea = useAnalysisStore((state) => state.setSelectedArea)
  const setPreviewArea = useAnalysisStore((state) => state.setPreviewArea)
  const setProcessing = useAnalysisStore((state) => state.setProcessing)
  const setProgress = useAnalysisStore((state) => state.setProgress)
  const setBlocks = useAnalysisStore((state) => state.setBlocks)
  const setRoadLayers = useAnalysisStore((state) => state.setRoadLayers)
  const setGrid = useAnalysisStore((state) => state.setGrid)
  const setDistrictStatistics = useAnalysisStore((state) => state.setDistrictStatistics)
  const setReport = useAnalysisStore((state) => state.setReport)
  const addWarning = useAnalysisStore((state) => state.addWarning)
  const addError = useAnalysisStore((state) => state.addError)
  const clearMessages = useAnalysisStore((state) => state.clearMessages)
  const resetResults = useAnalysisStore((state) => state.resetResults)
  const setCacheStatus = useAnalysisStore((state) => state.setCacheStatus)
  const showOnlyBlocksLayer = useAnalysisStore((state) => state.showOnlyBlocksLayer)
  const setDistricts = useAnalysisStore((state) => state.setDistricts)
  const setDistrictStrategy = useAnalysisStore((state) => state.setDistrictStrategy)
  const startNewDrawingSession = useAnalysisStore((state) => state.startNewDrawingSession)

  const selectedArea = useAnalysisStore((state) => state.selectedArea)
  const config = useAnalysisStore((state) => state.config)
  const districts = useAnalysisStore((state) => state.districts)
  const districtStrategy = useAnalysisStore((state) => state.districtStrategy)
  const fixtureMode = useAnalysisStore((state) => state.fixtureMode)
  const isProcessing = useAnalysisStore((state) => state.isProcessing)
  const blocks = useAnalysisStore((state) => state.blocks)

  const client = useMemo(() => new GeometryWorkerClient(), [])

  useEffect(() => {
    client.on({
      onProgress: (progress) => {
        setProgress(progress)
        if (progress.cacheStatus) {
          setCacheStatus(progress.cacheStatus)
        }
      },
      onWarning: (message) => addWarning(message),
      onCompleted: (result) => {
        setBlocks(result.blocks.features.map((feature) => ({
          id: feature.properties.blockId,
          geometry: feature.geometry,
          properties: feature.properties,
        })))
        setRoadLayers({
          originalRoads: result.originalRoads,
          nodedRoads: result.nodedRoads,
          removedBranches: result.removedBranches,
          twoCoreRoads: result.twoCoreRoads,
        })
        setGrid(result.grid)
        setDistrictStatistics(result.districtStatistics)
        setReport(result.report)
        setProcessing(false)
        // Once a result exists, only the urban blocks should stand out over
        // the basemap - the selection boundary, grid, roads and districts
        // were all useful while setting up the analysis, not for reading it.
        showOnlyBlocksLayer()
        setWizardStep('results')
      },
      onError: (message) => {
        addError(message)
        setProcessing(false)
      },
      onCancelled: () => {
        addWarning('The analysis was cancelled.')
        setProcessing(false)
      },
    })

    return () => client.dispose()
  }, [client, setProgress, setCacheStatus, addWarning, setBlocks, setRoadLayers, setGrid, setDistrictStatistics, setReport, setProcessing, addError, showOnlyBlocksLayer])

  const handleAreaConfirmed = (area: AnalysisArea) => {
    setPreviewArea(area)
    setWizardStep('configure')
  }

  const runAnalysis = () => {
    if (!selectedArea) {
      return
    }
    clearMessages()
    resetResults()
    setProgress(null)
    setProcessing(true)
    client.start({
      area: selectedArea,
      config,
      fixtureMode,
      districts,
      districtStrategy,
    })
  }

  const cancelAnalysis = () => {
    client.cancel()
  }

  const startOver = () => {
    client.cancel()
    setSelectedArea(null)
    setPreviewArea(null)
    resetResults()
    setProgress(null)
    setProcessing(false)
    // "New analysis" is a full reset, unlike "Adjust configuration" which
    // keeps everything: also drop any uploaded districts and district
    // strategy choice, and force the map to clear any drawn rectangle or
    // polygon (and its own Terra Draw layer) regardless of which area
    // selection method was used last time.
    setDistricts([])
    setDistrictStrategy('largest-overlap')
    startNewDrawingSession()
    setWizardStep('area')
  }

  const canNavigate = (step: WizardStep): boolean => {
    if (isProcessing) {
      return step === 'configure'
    }
    if (step === 'area') return true
    if (step === 'configure') return Boolean(selectedArea)
    return blocks.length > 0
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          padding: '0.85rem 1.5rem',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img
            src={`${import.meta.env.BASE_URL}favicon.svg`}
            alt=""
            width={40}
            height={40}
            style={{ borderRadius: '10px', flexShrink: 0 }}
          />
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0 }}>{appName}</h1>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>v{appVersion}</span>
              <button type="button" className="ghost" style={{ padding: '0.1rem 0.5rem', fontSize: '0.75rem' }} onClick={() => setIsAboutOpen(true)}>
                About
              </button>
            </div>
            <p style={{ margin: 0, fontSize: '0.8rem' }}>
              Turns OpenStreetMap streets into urban block polygons: it removes dead-end roads and traces the closed
              loops between intersections, then measures each block's area, perimeter and shape.
            </p>
          </div>
        </div>
        <Stepper current={wizardStep} canNavigate={canNavigate} onNavigate={setWizardStep} />
      </header>

      <div
        style={{
          padding: '0.35rem 1.5rem',
          fontSize: '0.72rem',
          color: 'var(--color-text-subtle)',
          background: 'var(--color-surface-muted)',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        Inspired by Marcos Dione's{' '}
        <a href="https://www.grulic.org.ar/~mdione/glob/posts/block-sizes-from-osm-data/" target="_blank" rel="noreferrer">
          "Block sizes from OSM data"
        </a>.
      </div>

      <div style={{ padding: '0 1.5rem', flexShrink: 0 }}>
        <ErrorPanel />
      </div>

      <main style={{ display: 'flex', flex: 1, minHeight: 0, gap: '1rem', padding: '1rem 1.5rem 1.5rem' }}>
        <aside className="scroll-area" style={{ width: '400px', flexShrink: 0, display: 'grid', gap: '1rem', alignContent: 'start' }}>
          {wizardStep === 'area' ? (
            <>
              <div className="panel">
                <AreaSelector onAreaSelected={handleAreaConfirmed} />
              </div>
              <div className="panel">
                <section aria-label="Privacy">
                  <h2>Privacy &amp; data licence</h2>
                  <p style={{ fontSize: '0.82rem' }}>
                    Uploaded files never leave your browser. Overpass queries only cover the requested analysis area,
                    all caching happens locally in IndexedDB, and you can clear it at any time. Generated blocks,
                    roads and districts are derived from OpenStreetMap and are distributed under the{' '}
                    <a href="https://opendatacommons.org/licenses/odbl/" target="_blank" rel="noreferrer">ODbL 1.0</a> licence.
                  </p>
                </section>
              </div>
            </>
          ) : null}

          {wizardStep === 'configure' ? (
            <>
              <button type="button" className="ghost" style={{ justifySelf: 'start' }} onClick={() => setWizardStep('area')} disabled={isProcessing}>
                ← Change area
              </button>
              {selectedArea ? (
                <div className="panel">
                  <p role="status" style={{ margin: 0, fontSize: '0.85rem' }}>
                    <strong>{selectedArea.name ?? 'Selected area'}</strong> · {selectedArea.areaKm2.toFixed(2)} km²
                  </p>
                </div>
              ) : null}
              <div className="panel">
                <Tabs
                  ariaLabel="Configuration sections"
                  tabs={[
                    { id: 'settings', label: 'Analysis settings', content: <AnalysisControls onRun={runAnalysis} canRun={Boolean(selectedArea)} /> },
                    { id: 'districts', label: 'Districts', content: <DistrictPanel /> },
                  ]}
                />
              </div>
            </>
          ) : null}

          {wizardStep === 'results' ? (
            <>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="ghost" onClick={() => setWizardStep('configure')}>← Adjust configuration</button>
                <button type="button" className="secondary" onClick={startOver}>New analysis</button>
              </div>
              <div className="panel">
                <Tabs
                  ariaLabel="Result sections"
                  tabs={[
                    { id: 'summary', label: 'Summary', content: <ResultsPanel /> },
                    { id: 'layers', label: 'Layers', content: <LayerControl /> },
                    { id: 'districts', label: 'Districts', content: <DistrictPanel /> },
                    { id: 'export', label: 'Export', content: <ExportPanel /> },
                  ]}
                />
              </div>
            </>
          ) : null}
        </aside>

        <div style={{ flex: 1, minWidth: 0 }}>
          <MapView wizardStep={wizardStep} />
        </div>
      </main>

      {isProcessing ? <ProgressOverlay onCancel={cancelAnalysis} /> : null}
      {isAboutOpen ? <AboutModal onClose={() => setIsAboutOpen(false)} /> : null}
    </div>
  )
}

export default App
