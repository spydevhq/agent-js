import { Worker, workerData } from 'node:worker_threads';
import { runAgent } from './agent.js';
import { SpyDevConfig, SpyDevMetadata } from './types.js';

export function launch(config: SpyDevConfig, metadata: SpyDevMetadata) {
  const worker = new Worker(new URL('./launcher.js', import.meta.url), {
    workerData: { spyDevConfig: config, spyDevMetadata: metadata },
  });

  // TODO: report worker errors
  worker.on('error', (err) => console.error('spy.dev worker error', err));
  worker.on('exit', (code) => console.log('spy.dev worker exited', code));
}

// This is the entrypoint for the worker
if (/* !isMainThread || */ workerData?.spyDevConfig != null) {
  const config = workerData.spyDevConfig as SpyDevConfig;
  const metadata = workerData.spyDevMetadata as SpyDevMetadata;
  runAgent(config, metadata);
}