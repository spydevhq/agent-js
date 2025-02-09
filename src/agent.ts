import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { startCommandStream } from './commandStream.js';
import { BackendService } from './gen/dev/spy/agent/v1/agent_pb.js';
import { launch } from './launcher.js';
import { DebugSession } from './session.js';
import { CommandHandlers, SpyDevConfig } from './types.js';

if (/*isMainThread || */ workerData?.spyDevConfig != null) {
  const config = workerData.spyDevConfig as SpyDevConfig;
  runAgent(config);
}

/**
 * Initialize the spy.dev agent.
 *
 * If `NODE_ENV` is 'production', this function will start a new worker thread
 * if it is not already running. Otherwise, it does nothing.
 */
export function init(config: SpyDevConfig) {
  if (process.env.NODE_ENV !== 'production' && !config.baseUrl) {
    console.log('spy.dev agent is disabled in non-production environments');
    return;
  }

  if (/*isMainThread || */ workerData?.isSpyDevAgent == null) {
    launch(config);
  }
}

async function runAgent({ accessToken, appName, baseUrl }: SpyDevConfig) {
  console.log('Running spy.dev agent');

  parentPort?.on('message', () => {}); // stop worker from dying early

  const client = createClient(
    BackendService,
    createConnectTransport({
      baseUrl: baseUrl ?? 'https://api.spy.dev',
      httpVersion: '2',
    }),
  );

  const headers = new Headers();
  headers.set('Authorization', `Bearer ${accessToken}`);

  // TODO: can we parse the user's package.json?
  const { sessionId } = await client.initSession({
    appName,
    agentVersion: '0.0.1', // TODO: get version from package.json
    argv: process.argv,
  }, { headers });

  headers.set('X-SpyDev-Session-Id', sessionId);

  const session = new DebugSession();
  await session.initialize();

  const handlers: CommandHandlers = {
    getSourceTree: async (req) => {
      const scripts = session.getScripts();
      return {
        $typeName: 'dev.spy.agent.v1.GetSourceTreeResponse',
      };
    },
    getScriptSource: async (req) => {
      return {
        $typeName: 'dev.spy.agent.v1.GetScriptSourceResponse',
        source: 'you got sourced',
      };
    },
  };

  await startCommandStream(client, headers, handlers);
}
