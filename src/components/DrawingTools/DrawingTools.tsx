import * as turf from '@turf/turf'
import { estimateAreaComplexity } from '../../grid/gridComplexity'
import type { AnalysisArea } from '../../domain/types'

export interface DrawingToolsProps {
  previewArea: AnalysisArea | null
  onConfirm: (area: AnalysisArea) => void
}

function complexityLabel(level: ReturnType<typeof estimateAreaComplexity>['level']): string {
  if (level === 'simple') return 'Simple analysis'
  if (level === 'demanding') return 'Demanding analysis'
  return 'Area requires subdivision'
}

function complexityBadgeClass(level: ReturnType<typeof estimateAreaComplexity>['level']): string {
  if (level === 'simple') return 'badge badge-success'
  if (level === 'demanding') return 'badge badge-warning'
  return 'badge badge-danger'
}

export function DrawingTools({ previewArea, onConfirm }: DrawingToolsProps) {
  const isDrawnArea = previewArea && (previewArea.source === 'rectangle' || previewArea.source === 'polygon')
  const complexity = isDrawnArea ? estimateAreaComplexity(previewArea.areaKm2) : null

  const widthMeters = isDrawnArea
    ? turf.distance([previewArea.bbox[0], previewArea.bbox[1]], [previewArea.bbox[2], previewArea.bbox[1]], { units: 'meters' })
    : 0
  const heightMeters = isDrawnArea
    ? turf.distance([previewArea.bbox[0], previewArea.bbox[1]], [previewArea.bbox[0], previewArea.bbox[3]], { units: 'meters' })
    : 0

  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
      <p style={{ fontSize: '0.85rem' }}>
        Click the map to start drawing, click again to add vertices (rectangles only need two clicks), and
        double-click to finish. After finishing you can drag vertices to adjust the shape, or use the 🗑 control
        in the top-left corner of the map to clear it and start again.
      </p>

      {isDrawnArea && complexity ? (
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.15rem 0.5rem', fontSize: '0.85rem', margin: 0 }}>
            <dt>Area</dt>
            <dd>{previewArea.areaKm2.toFixed(3)} km²</dd>
            <dt>Bounding box</dt>
            <dd>{previewArea.bbox.map((value) => value.toFixed(4)).join(', ')}</dd>
            <dt>Approx. width</dt>
            <dd>{(widthMeters / 1000).toFixed(2)} km</dd>
            <dt>Approx. height</dt>
            <dd>{(heightMeters / 1000).toFixed(2)} km</dd>
          </dl>
          <span className={complexityBadgeClass(complexity.level)} style={{ justifySelf: 'start' }}>
            {complexityLabel(complexity.level)}
          </span>
        </div>
      ) : null}

      {isDrawnArea ? (
        <button type="button" style={{ justifySelf: 'start' }} onClick={() => onConfirm(previewArea)}>Confirm this area</button>
      ) : null}
    </div>
  )
}
