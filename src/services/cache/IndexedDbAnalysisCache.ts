import type { AnalysisCache, AnalysisSnapshot, AnalysisSnapshotSummary, CellAcquisitionData, CellCacheKeyInput } from './AnalysisCache'

const DB_NAME = 'urban-blocks-builder-cache'
// v2 added the cellData store (replaces cellWays: cached ways now come bundled
// with building points from the same Overpass call - see CellAcquisitionData).
// v3 replaces the never-used gridState/finalBlocks/reports stores (nothing
// ever called their save/load methods - see docs/architecture.md) with a
// single analysisSnapshots store backing the "resume a saved analysis"
// feature. Old stores are dropped on upgrade since they never held real data.
const DB_VERSION = 3
const MAX_SAVED_ANALYSES = 10

const STORES = {
  cellData: 'cellData',
  analysisSnapshots: 'analysisSnapshots',
  meta: 'meta',
} as const

const RETIRED_STORES = ['cellWays', 'gridState', 'finalBlocks', 'reports']

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const storeName of RETIRED_STORES) {
        if (db.objectStoreNames.contains(storeName)) {
          db.deleteObjectStore(storeName)
        }
      }
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

  async saveAnalysisSnapshot(snapshot: AnalysisSnapshot): Promise<void> {
    const db = await this.db()
    await runTransaction(db, STORES.analysisSnapshots, 'readwrite', (store) => store.put(snapshot, snapshot.analysisId))
    await this.touchMeta('__cells__')
    await this.pruneOldSnapshots(db)
  }

  async listAnalysisSnapshots(): Promise<AnalysisSnapshotSummary[]> {
    const db = await this.db()
    const snapshots = await runTransaction<AnalysisSnapshot[]>(db, STORES.analysisSnapshots, 'readonly', (store) => store.getAll())
    return snapshots
      .map((snapshot) => ({
        analysisId: snapshot.analysisId,
        savedAt: snapshot.savedAt,
        areaName: snapshot.area.name ?? `${snapshot.area.source} area`,
        areaKm2: snapshot.area.areaKm2,
        blockCount: snapshot.blocks.length,
      }))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  }

  async loadAnalysisSnapshot(analysisId: string): Promise<AnalysisSnapshot | null> {
    const db = await this.db()
    const result = await runTransaction<AnalysisSnapshot | undefined>(db, STORES.analysisSnapshots, 'readonly', (store) => store.get(analysisId))
    return result ?? null
  }

  async deleteAnalysisSnapshot(analysisId: string): Promise<void> {
    const db = await this.db()
    await runTransaction(db, STORES.analysisSnapshots, 'readwrite', (store) => store.delete(analysisId))
  }

  async clearAll(): Promise<void> {
    const db = await this.db()
    for (const storeName of Object.values(STORES)) {
      await runTransaction(db, storeName, 'readwrite', (store) => store.clear())
    }
  }

  /** Keeps the saved-analyses list from growing without bound - oldest snapshots are dropped first. */
  private async pruneOldSnapshots(db: IDBDatabase): Promise<void> {
    const snapshots = await runTransaction<AnalysisSnapshot[]>(db, STORES.analysisSnapshots, 'readonly', (store) => store.getAll())
    if (snapshots.length <= MAX_SAVED_ANALYSES) {
      return
    }
    const oldestFirst = [...snapshots].sort((a, b) => a.savedAt.localeCompare(b.savedAt))
    const toRemove = oldestFirst.slice(0, snapshots.length - MAX_SAVED_ANALYSES)
    for (const snapshot of toRemove) {
      await runTransaction(db, STORES.analysisSnapshots, 'readwrite', (store) => store.delete(snapshot.analysisId))
    }
  }

  private async touchMeta(key: string): Promise<void> {
    const db = await this.db()
    await runTransaction(db, STORES.meta, 'readwrite', (store) => store.put(new Date().toISOString(), key))
  }
}
