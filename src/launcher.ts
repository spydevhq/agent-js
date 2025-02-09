import { Worker } from 'node:worker_threads';
import { SpyDevConfig } from './types.js';

export function launch(config: SpyDevConfig) {
  const worker = new Worker(new URL('./agent.js', import.meta.url), {
    workerData: { spyDevConfig: config },
  });

  // TODO: report worker errors
  worker.on('error', (err) => console.error('spy.dev worker error', err));
  worker.on('exit', (code) => console.log('spy.dev worker exited', code));
}
