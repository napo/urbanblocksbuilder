import type { UrbanBlock } from '../../domain/types'

export type BlockStyleAttribute = 'area' | 'compactness' | 'district' | 'flags'
export type ClassificationMethod = 'quantile' | 'equal-interval' | 'manual'

/**
 * Classic 5-class sequential choropleth palettes (ColorBrewer-style), used
 * to colour the 'area'/'compactness' gradient. 'Blues' is the default.
 */
export const CHOROPLETH_PALETTES = {
  Blues: ['#eff3ff', '#bdd7e7', '#6baed6', '#3182bd', '#08519c'],
  Greens: ['#edf8e9', '#bae4b3', '#74c476', '#31a354', '#006d2c'],
  Oranges: ['#feedde', '#fdbe85', '#fd8d3c', '#e6550d', '#a63603'],
  Reds: ['#fee5d9', '#fcae91', '#fb6a4a', '#de2d26', '#a50f15'],
  Purples: ['#f2f0f7', '#cbc9e2', '#9e9ac8', '#756bb1', '#54278f'],
  YlOrRd: ['#ffffb2', '#fecc5c', '#fd8d3c', '#f03b20', '#bd0026'],
} as const

export type ChoroplethPalette = keyof typeof CHOROPLETH_PALETTES

export const DEFAULT_CHOROPLETH_PALETTE: ChoroplethPalette = 'Blues'

const CATEGORICAL_COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#be185d', '#65a30d']

export function computeQuantileBreaks(values: number[], classCount: number): number[] {
  if (values.length === 0) return []
  const sorted = [...values].sort((a, b) => a - b)
  const breaks: number[] = []
  for (let i = 1; i < classCount; i += 1) {
    const index = Math.floor((sorted.length - 1) * (i / classCount))
    breaks.push(sorted[index])
  }
  return Array.from(new Set(breaks))
}

export function computeEqualIntervalBreaks(values: number[], classCount: number): number[] {
  if (values.length === 0) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const step = (max - min) / classCount
  const breaks: number[] = []
  for (let i = 1; i < classCount; i += 1) {
    breaks.push(min + step * i)
  }
  return breaks
}

/**
 * Builds a MapLibre data-driven fill-color expression for the blocks layer.
 * 'flags' and 'district' use categorical colouring; 'area' and 'compactness'
 * use a numeric classification (quantile, equal-interval, or a manually
 * supplied set of break values) coloured from the chosen choropleth
 * palette, each colour also getting a distinct label so the legend never
 * relies on colour alone.
 */
export function buildBlockFillExpression(
  attribute: BlockStyleAttribute,
  method: ClassificationMethod,
  blocks: UrbanBlock[],
  manualBreaks: number[],
  palette: ChoroplethPalette = DEFAULT_CHOROPLETH_PALETTE,
  classCount = 5,
): unknown[] {
  if (attribute === 'flags') {
    return [
      'case',
      ['any', ['get', 'flaggedInvalidGeometry'], ['get', 'flaggedLargeArea'], ['get', 'flaggedSmallArtifact']],
      '#dc2626',
      '#16a34a',
    ]
  }

  if (attribute === 'district') {
    const districtIds = Array.from(new Set(blocks.map((block) => block.properties.districtId).filter((id): id is string => Boolean(id))))
    const expression: unknown[] = ['match', ['get', 'districtId']]
    districtIds.forEach((districtId, index) => {
      expression.push(districtId, CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length])
    })
    expression.push('#94a3b8')
    return expression
  }

  const colors = CHOROPLETH_PALETTES[palette]
  const property = attribute === 'area' ? 'areaM2' : 'compactness'
  const values = blocks.map((block) => block.properties[property])
  const breaks = method === 'manual'
    ? manualBreaks
    : method === 'quantile'
      ? computeQuantileBreaks(values, classCount)
      : computeEqualIntervalBreaks(values, classCount)

  // A MapLibre 'step' expression needs at least one stop; with no blocks (or
  // too few distinct values to produce any break) fall back to a flat
  // colour instead of emitting an invalid 2-argument 'step' expression.
  if (breaks.length === 0) {
    return ['literal', colors[0]]
  }

  const expression: unknown[] = ['step', ['get', property], colors[0]]
  breaks.forEach((breakValue, index) => {
    expression.push(breakValue, colors[Math.min(index + 1, colors.length - 1)])
  })
  return expression
}

export function buildLegendEntries(
  attribute: BlockStyleAttribute,
  method: ClassificationMethod,
  blocks: UrbanBlock[],
  manualBreaks: number[],
  palette: ChoroplethPalette = DEFAULT_CHOROPLETH_PALETTE,
  classCount = 5,
): Array<{ color: string; label: string }> {
  if (attribute === 'flags') {
    return [
      { color: '#dc2626', label: 'Flagged (small, large, or invalid)' },
      { color: '#16a34a', label: 'No flags' },
    ]
  }

  if (attribute === 'district') {
    const districtIds = Array.from(new Set(blocks.map((block) => block.properties.districtId).filter((id): id is string => Boolean(id))))
    return [
      ...districtIds.map((districtId, index) => ({ color: CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length], label: districtId })),
      { color: '#94a3b8', label: 'Unassigned' },
    ]
  }

  const colors = CHOROPLETH_PALETTES[palette]
  const property = attribute === 'area' ? 'areaM2' : 'compactness'
  const unit = attribute === 'area' ? 'm²' : ''
  const values = blocks.map((block) => block.properties[property])
  const breaks = method === 'manual'
    ? manualBreaks
    : method === 'quantile'
      ? computeQuantileBreaks(values, classCount)
      : computeEqualIntervalBreaks(values, classCount)

  const boundaries = [Math.min(...values, 0), ...breaks, Math.max(...values, 0)]
  return colors.slice(0, boundaries.length - 1).map((color, index) => ({
    color,
    label: `${Math.round(boundaries[index]).toLocaleString()} - ${Math.round(boundaries[index + 1]).toLocaleString()} ${unit}`.trim(),
  }))
}
