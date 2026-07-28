import type { AnalysisCache, CachedAnalysisSummary, CellAcquisitionData, CellCacheKeyInput } from './AnalysisCache'
import type { AnalysisReport, GridCell, UrbanBlock } from '../../domain/types'

const DB_NAME = 'urban-blocks-builder-cache'
// v2 adds the cellData store (replaces cellWays: cached ways now come bundled
// with building points from the same Overpass call - see CellAcquisitionData).
// The old cellWays store is left in place, unused, rather than migrated.
const DB_VERSION = 2

const STORES = {
  cellData: 'cellData',
  gridState: 'gridState',
  finalBlocks: 'finalBlocks',
  reports: 'reports',
  meta: 'meta',
} as const

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const storeName of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName)
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open the local cache database.'))
  })
}

function runTransaction<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    const request = action(store)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error(`IndexedDB operation failed on store "${storeName}".`))
  })
}

async function digestKey(input: unknown): Promise<string> {
  const serialized = JSON.stringify(input)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(serialized)
    const digest = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  // Fallback hash for environments without SubtleCrypto (kept deterministic, not cryptographic).
  let hash = 0
  for (let i = 0; i < serialized.length; i += 1) {
    hash = (hash * 31 + serialized.charCodeAt(i)) | 0
  }
  return `fallback-${hash}`
}

/**
 * IndexedDB-backed implementation of AnalysisCache. Every value stored is
 * plain JSON-serializable data (GeoJSON-like structures, arrays, primitives)
 * so this store can later be swapped for a remote cache without changing
 * the AnalysisCache contract.
 */
export class IndexedDbAnalysisCache implements AnalysisCache {
  private dbPromise: Promise<IDBDatabase> | null = null

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDatabase()
    }
    return this.dbPromise
  }

  async buildCellCacheKey(input: CellCacheKeyInput): Promise<string> {
    const roundedBbox = input.cellBbox.map((value) => Math.round(value * 1e5) / 1e5)
    return digestKey({ ...input, cellBbox: roundedBbox })
  }

  async getCellData(key: string): Promise<CellAcquisitionData | null> {
    const db = await this.db()
    const result = await runTransaction<CellAcquisitionData | undefined>(db, STORES.cellData, 'readonly', (store) => store.get(key))
    return result ?? null
  }

  async putCellData(key: string, data: CellAcquisitionData): Promise<void> {
    const db = await this.db()
    await runTransaction(db, STORES.cellData, 'readwrite', (store) => store.put(data, key))
    await this.touchMeta('__cells__')
  }

  async saveGridState(analysisId: string, cells: GridCell[]): Promise<void> {
    const db = await this.db()
    await runTransaction(db, STORES.gridState, 'readwrite', (store) => store.put(cells, analysisId))
    await this.touchMeta(analysisId)
  }

  async loadGridState(analysisId: string): Promise<GridCell[] | null> {
    const db = await this.db()
    const result = await runTransaction<GridCell[] | undefined>(db, STORES.gridState, 'readonly', (store) => store.get(analysisId))
    return result ?? null
  }

  async saveFinalBlocks(analysisId: string, blocks: UrbanBlock[]): Promise<void> {
    const db = await this.db()
    await runTransaction(db, STORES.finalBlocks, 'readwrite', (store) => store.put(blocks, analysisId))
    await this.touchMeta(analysisId)
  }

  async loadFinalBlocks(analysisId: string): Promise<UrbanBlock[] | null> {
    const db = await this.db()
    const result = await runTransaction<UrbanBlock[] | undefined>(db, STORES.finalBlocks, 'readonly', (store) => store.get(analysisId))
    return result ?? null
  }

  async saveReport(analysisId: string, report: AnalysisReport): Promise<void> {
    const db = await this.db()
    await runTransaction(db, STORES.reports, 'readwrite', (store) => store.put(report, analysisId))
    await this.touchMeta(analysisId)
  }

  async loadReport(analysisId: string): Promise<AnalysisReport | null> {
    const db = await this.db()
    const result = await runTransaction<AnalysisReport | undefined>(db, STORES.reports, 'readonly', (store) => store.get(analysisId))
    return result ?? null
  }

  async clearAnalysis(analysisId: string): Promise<void> {
    const db = await this.db()
    await runTransaction(db, STORES.gridState, 'readwrite', (store) => store.delete(analysisId))
    await runTransaction(db, STORES.finalBlocks, 'readwrite', (store) => store.delete(analysisId))
    await runTransaction(db, STORES.reports, 'readwrite', (store) => store.delete(analysisId))
    await runTransaction(db, STORES.meta, 'readwrite', (store) => store.delete(analysisId))
  }

  async clearAll(): Promise<void> {
    const db = await this.db()
    for (const storeName of Object.values(STORES)) {
      await runTransaction(db, storeName, 'readwrite', (store) => store.clear())
    }
  }

  async listCachedAnalyses(): Promise<CachedAnalysisSummary[]> {
    const db = await this.db()
    const keys = await runTransaction<IDBValidKey[]>(db, STORES.meta, 'readonly', (store) => store.getAllKeys())
    const summaries: CachedAnalysisSummary[] = []
    for (const key of keys) {
      if (typeof key !== 'string' || key === '__cells__') {
        continue
      }
      const updatedAt = await runTransaction<string | undefined>(db, STORES.meta, 'readonly', (store) => store.get(key))
      summaries.push({ analysisId: key, updatedAt: updatedAt ?? '' })
    }
    return summaries
  }

  private async touchMeta(analysisId: string): Promise<void> {
    const db = await this.db()
    await runTransaction(db, STORES.meta, 'readwrite', (store) => store.put(new Date().toISOString(), analysisId))
  }
}
