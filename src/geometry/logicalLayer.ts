export interface LogicalLevelContext {
  layer?: string | number
  bridge?: string
  tunnel?: string
  covered?: string
}

export function calculateLogicalLevel(tags: Record<string, string | undefined>): number {
  const layerValue = tags.layer
  const bridgeValue = tags.bridge
  const tunnelValue = tags.tunnel
  const coveredValue = tags.covered

  if (tunnelValue === 'yes') {
    return -1
  }

  if (bridgeValue === 'yes') {
    return 1
  }

  if (coveredValue === 'yes') {
    return 0
  }

  if (layerValue) {
    const parsed = Number(layerValue)
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }

  return 0
}
