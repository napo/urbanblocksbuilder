import type { AnalysisArea, AnalysisConfig } from '../domain/types'
import type { District, DistrictAssignmentStrategy } from '../domain/district'
import type {
  CompletedResultPayload,
  OutgoingWorkerMessage,
  ProgressMessage,
} from './workerMessages'

export interface StartAnalysisInput {
  area: AnalysisArea
  config: AnalysisConfig
  fixtureMode: boolean
  districts: District[]
  districtStrategy: DistrictAssignmentStrategy
}

export interface GeometryWorkerClientHandlers {
  onProgress?: (progress: ProgressMessage['payload']) => void
  onWarning?: (message: string) => void
  onCompleted?: (result: CompletedResultPayload) => void
  onError?: (message: string) => void
  onCancelled?: () => void
}

/**
 * Typed wrapper around the geometry Web Worker. This is the single seam
 * between the UI and heavy geometric processing: swapping the worker for a
 * remote API client in a future backend migration only means reimplementing
 * this class, not touching any React component.
 */
export class GeometryWorkerClient {
  private worker: Worker | null = null
  private handlers: GeometryWorkerClientHandlers = {}

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' })
      this.worker.addEventListener('message', (event: MessageEvent<OutgoingWorkerMessage>) => {
        this.dispatch(event.data)
      })
    }
    return this.worker
  }

  private dispatch(message: OutgoingWorkerMessage): void {
    switch (message.type) {
      case 'progress':
        this.handlers.onProgress?.(message.payload)
        break
      case 'warning':
        this.handlers.onWarning?.(message.payload.message)
        break
      case 'completed-result':
        this.handlers.onCompleted?.(message.payload)
        break
      case 'processing-error':
        this.handlers.onError?.(message.payload.message)
        break
      case 'cancellation-confirmed':
        this.handlers.onCancelled?.()
        break
    }
  }

  on(handlers: GeometryWorkerClientHandlers): void {
    this.handlers = { ...this.handlers, ...handlers }
  }

  start(input: StartAnalysisInput): void {
    const worker = this.ensureWorker()
    worker.postMessage({
      type: 'start',
      payload: input,
    })
  }

  cancel(): void {
    this.worker?.postMessage({ type: 'cancellation-request' })
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
  }
}
