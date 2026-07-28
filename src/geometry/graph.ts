import type { NodedEdge } from './noding'

export interface GraphNode {
  id: string
  coordinates: [number, number]
  degree: number
}

export interface GraphEdge {
  id: string
  startNodeId: string
  endNodeId: string
  geometry: [number, number][]
  logicalLevel: number
  osmWayReferences: string[]
  length: number
}

export interface Graph {
  nodes: Map<string, GraphNode>
  edges: GraphEdge[]
}

function nodeKey(coordinate: [number, number], toleranceMeters: number): string {
  const decimals = toleranceMeters > 0 ? Math.max(0, Math.round(-Math.log10(toleranceMeters))) : 2
  return `${coordinate[0].toFixed(decimals)}:${coordinate[1].toFixed(decimals)}`
}

function edgeLength(coordinates: [number, number][]): number {
  let length = 0
  for (let i = 0; i < coordinates.length - 1; i += 1) {
    length += Math.hypot(coordinates[i + 1][0] - coordinates[i][0], coordinates[i + 1][1] - coordinates[i][1])
  }
  return length
}

/**
 * Builds the undirected road graph from an already-noded edge set. Because
 * noding has already split roads at every same-level intersection, each
 * noded edge maps to exactly one graph edge between its two endpoints.
 */
export function buildGraphFromNodedEdges(edges: NodedEdge[], toleranceMeters: number): Graph {
  const nodes = new Map<string, GraphNode>()
  const graphEdges: GraphEdge[] = []

  // An endpoint with a known real OSM node ID is keyed by that ID, exactly -
  // two endpoints only become the same graph node if they really are the
  // same OSM node, regardless of how far apart their (possibly imprecise)
  // coordinates are, and two endpoints with *different* known IDs are never
  // merged just because they happen to land within the coordinate-rounding
  // tolerance of each other. Only endpoints with no known ID (synthetic
  // boundary-ring points, fixture/demo data) fall back to the coordinate
  // proximity heuristic below, exactly as before this ID-aware path existed.
  const getOrCreateNode = (coordinate: [number, number], osmNodeId: string | undefined): GraphNode => {
    const key = osmNodeId ? `osm:${osmNodeId}` : nodeKey(coordinate, toleranceMeters)
    let node = nodes.get(key)
    if (!node) {
      node = { id: key, coordinates: coordinate, degree: 0 }
      nodes.set(key, node)
    }
    return node
  }

  for (const edge of edges) {
    if (edge.coordinates.length < 2) {
      continue
    }
    const start = getOrCreateNode(edge.coordinates[0], edge.startNodeId)
    const end = getOrCreateNode(edge.coordinates[edge.coordinates.length - 1], edge.endNodeId)

    if (start.id === end.id && edge.coordinates.length < 3) {
      continue
    }

    start.degree += 1
    end.degree += 1

    graphEdges.push({
      id: edge.id,
      startNodeId: start.id,
      endNodeId: end.id,
      geometry: edge.coordinates,
      logicalLevel: edge.logicalLevel,
      osmWayReferences: edge.wayReferences,
      length: edgeLength(edge.coordinates),
    })
  }

  return { nodes, edges: graphEdges }
}
