import { Code, ConnectError } from '@connectrpc/connect';

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_DELAY_MS = 32000;
const BASE_DELAY_MS = 1000;

function getBackoffDelay(retryCount: number) {
  const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(2, retryCount));

  // Add some jitter to prevent thundering herd
  const jitter = 0.75 + Math.random() * 0.5;

  return delay * jitter;
}

export async function exponentialBackoff(
  fn: () => Promise<void>,
  maxRetries = 10,
) {
  let retries = 0;
  while (true) {
    try {
      await fn();
      return;
    } catch (err) {
      console.error('spy.dev: error in exponential backoff:', err);

      if (retries >= maxRetries) {
        throw err;
      }

      console.log(
        `spy.dev: retrying in ${getBackoffDelay(retries)}ms (attempt ${retries + 1})`,
      );
      retries++;
      await sleep(getBackoffDelay(retries));
    }
  }
}
