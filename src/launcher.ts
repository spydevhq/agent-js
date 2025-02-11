import { Worker } from 'node:worker_threads';
import { SpyDevConfig, SpyDevMetadata } from './types.js';

export function launch(config: SpyDevConfig, metadata: SpyDevMetadata) {
  const worker = new Worker(new URL('./agent.js', import.meta.url), {
    workerData: { spyDevConfig: config, spyDevMetadata: metadata },
  });

  // TODO: report worker errors
  worker.on('error', (err) => console.error('spy.dev worker error', err));
  worker.on('exit', (code) => console.log('spy.dev worker exited', code));
}
