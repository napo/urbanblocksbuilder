import type { Graph, GraphEdge } from './graph'

export interface TwoCoreResult {
  core: Graph
  removedEdges: GraphEdge[]
}

/**
 * Recursively removes nodes with degree < 2 (terminal branches) using a
 * queue-based reduction, producing the graph's 2-core. Adjacency is tracked
 * with Maps of node id -> incident edge ids so each removal only touches the
 * edges incident to the node being processed, instead of rescanning the
 * whole edge list.
 */
export function extractTwoCore(graph: Graph): TwoCoreResult {
  const degree = new Map<string, number>()
  const adjacency = new Map<string, Set<string>>()
  const edgesById = new Map<string, GraphEdge>()

  for (const nodeId of graph.nodes.keys()) {
    degree.set(nodeId, 0)
    adjacency.set(nodeId, new Set())
  }

  for (const edge of graph.edges) {
    edgesById.set(edge.id, edge)
    degree.set(edge.startNodeId, (degree.get(edge.startNodeId) ?? 0) + 1)
    degree.set(edge.endNodeId, (degree.get(edge.endNodeId) ?? 0) + 1)
    adjacency.get(edge.startNodeId)?.add(edge.id)
    adjacency.get(edge.endNodeId)?.add(edge.id)
  }

  const removedNodeIds = new Set<string>()
  const removedEdgeIds = new Set<string>()
  const queue: string[] = []
  const queued = new Set<string>()

  for (const [nodeId, nodeDegree] of degree.entries()) {
    if (nodeDegree < 2) {
      queue.push(nodeId)
      queued.add(nodeId)
    }
  }

  while (queue.length > 0) {
    const nodeId = queue.shift() as string
    queued.delete(nodeId)
    if (removedNodeIds.has(nodeId)) {
      continue
    }
    const currentDegree = degree.get(nodeId) ?? 0
    if (currentDegree >= 2) {
      continue
    }

    removedNodeIds.add(nodeId)
    const incidentEdges = adjacency.get(nodeId)
    if (!incidentEdges) {
      continue
    }

    for (const edgeId of incidentEdges) {
      if (removedEdgeIds.has(edgeId)) {
        continue
      }
      removedEdgeIds.add(edgeId)
      const edge = edgesById.get(edgeId)
      if (!edge) {
        continue
      }
      const otherNodeId = edge.startNodeId === nodeId ? edge.endNodeId : edge.startNodeId
      if (removedNodeIds.has(otherNodeId)) {
        continue
      }
      const otherDegree = (degree.get(otherNodeId) ?? 0) - 1
      degree.set(otherNodeId, otherDegree)
      if (otherDegree < 2 && !queued.has(otherNodeId)) {
        queue.push(otherNodeId)
        queued.add(otherNodeId)
      }
    }
  }

  const coreNodes = new Map(
    Array.from(graph.nodes.entries()).filter(([nodeId]) => !removedNodeIds.has(nodeId)),
  )
  const coreEdges = graph.edges.filter((edge) => !removedEdgeIds.has(edge.id))
  const removedEdges = graph.edges.filter((edge) => removedEdgeIds.has(edge.id))

  for (const node of coreNodes.values()) {
    node.degree = degree.get(node.id) ?? node.degree
  }

  return {
    core: { nodes: coreNodes, edges: coreEdges },
    removedEdges,
  }
}
