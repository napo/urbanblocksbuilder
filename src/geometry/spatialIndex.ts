export type Bbox = [number, number, number, number]

/**
 * A uniform-grid spatial index used to prune candidate pairs before running
 * exact intersection tests. This keeps noding and crossing-detection close to
 * O(n log n) instead of the naive O(n^2) full pairwise comparison.
 */
export class SpatialIndex<T> {
  private readonly cellSize: number
  private readonly buckets = new Map<string, Array<{ item: T; bbox: Bbox }>>()

  constructor(cellSizeMeters: number) {
    this.cellSize = cellSizeMeters > 0 ? cellSizeMeters : 100
  }

  private cellKey(cx: number, cy: number): string {
    return `${cx}:${cy}`
  }

  private cellsForBbox(bbox: Bbox): Array<[number, number]> {
    const minCx = Math.floor(bbox[0] / this.cellSize)
    const minCy = Math.floor(bbox[1] / this.cellSize)
    const maxCx = Math.floor(bbox[2] / this.cellSize)
    const maxCy = Math.floor(bbox[3] / this.cellSize)
    const cells: Array<[number, number]> = []
    for (let cx = minCx; cx <= maxCx; cx += 1) {
      for (let cy = minCy; cy <= maxCy; cy += 1) {
        cells.push([cx, cy])
      }
    }
    return cells
  }

  insert(item: T, bbox: Bbox): void {
    for (const [cx, cy] of this.cellsForBbox(bbox)) {
      const key = this.cellKey(cx, cy)
      const bucket = this.buckets.get(key)
      const entry = { item, bbox }
      if (bucket) {
        bucket.push(entry)
      } else {
        this.buckets.set(key, [entry])
      }
    }
  }

  /** Returns items whose bbox may intersect the query bbox, without duplicates. */
  queryCandidates(bbox: Bbox): T[] {
    const seen = new Set<T>()
    const result: T[] = []
    for (const [cx, cy] of this.cellsForBbox(bbox)) {
      const bucket = this.buckets.get(this.cellKey(cx, cy))
      if (!bucket) {
        continue
      }
      for (const entry of bucket) {
        if (seen.has(entry.item)) {
          continue
        }
        if (bboxesIntersect(bbox, entry.bbox)) {
          seen.add(entry.item)
          result.push(entry.item)
        }
      }
    }
    return result
  }
}

export function bboxesIntersect(a: Bbox, b: Bbox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

export function bboxOfCoordinates(coordinates: readonly (readonly [number, number])[]): Bbox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of coordinates) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return [minX, minY, maxX, maxY]
}
