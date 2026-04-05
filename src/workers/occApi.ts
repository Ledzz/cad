import * as Comlink from 'comlink'
import type { OccWorkerApi } from './occWorker'

let workerApi: Comlink.Remote<OccWorkerApi> | null = null
let initPromise: Promise<void> | null = null

/**
 * Get the Comlink-wrapped OCCT worker API.
 * Initializes the worker and WASM on first call.
 */
export async function getOccApi(): Promise<Comlink.Remote<OccWorkerApi>> {
  if (workerApi) {
    await initPromise
    return workerApi
  }

  const worker = new Worker(
    new URL('./occWorker.ts', import.meta.url),
    { type: 'module' }
  )

  workerApi = Comlink.wrap<OccWorkerApi>(worker)

  initPromise = workerApi.init().then(() => {
    console.log('[Main] OCCT worker ready')
  })

  await initPromise
  return workerApi
}
