import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';
import { parentPort, workerData } from 'node:worker_threads';
import { connectToServer } from './commandStream.js';
import { BackendService } from './gen/dev/spy/agent/v1/agent_pb.js';
import { launch } from './launcher.js';
import { DebugSession } from './session.js';
import { CommandHandlers, SpyDevConfig, SpyDevMetadata } from './types.js';
import { exponentialBackoff } from './util.js';

if (/*isMainThread || */ workerData?.spyDevConfig != null) {
  const config = workerData.spyDevConfig as SpyDevConfig;
  const metadata = workerData.spyDevMetadata as SpyDevMetadata;
  runAgent(config, metadata);
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
    launch(config, {
      argv: process.argv,
    });
  }
}

async function runAgent(config: SpyDevConfig, metadata: SpyDevMetadata) {
  parentPort?.on('message', () => {}); // stop worker from dying early

  const MAX_RETRY_COUNT = 10;

  try {
    await exponentialBackoff(async () => {
      await runOnce(config, metadata);
    }, MAX_RETRY_COUNT);
  } catch (err) {
    console.error('Agent initialization failed all retries:', err);
    await runAgent(config, metadata);
  }
}

async function runOnce(
  { accessToken, appName, baseUrl }: SpyDevConfig,
  { argv }: SpyDevMetadata,
) {
  console.log('Running spy.dev agent');

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
  const { sessionId } = await client.initSession(
    {
      appName,
      agentVersion: '0.0.1', // TODO: get version from package.json
      argv,
    },
    { headers },
  );

  headers.set('X-SpyDev-Session-Id', sessionId);

  const session = new DebugSession();
  await session.initialize();

  const handlers: CommandHandlers = {
    getSources: async (_req) => {
      const scripts = session.getScripts();
      return {
        $typeName: 'dev.spy.agent.v1.GetSourcesResponse',
        files: Object.entries(scripts).map(([id, script]) => ({
          $typeName: 'dev.spy.shared.v1.SourceFile',
          scriptId: id,
          url: script.url,
        })),
      };
    },
    getScriptSource: async (req) => {
      const source = await session.getScriptSource(req.scriptId);
      return {
        $typeName: 'dev.spy.agent.v1.GetScriptSourceResponse',
        source,
      };
    },
    addLogpoint: async ({ scriptId, line }) => {
      const { actualLocation, breakpointId } = await session.addLogpoint(scriptId, line);
      return {
        $typeName: 'dev.spy.agent.v1.AddLogpointResponse',
        breakpointId,
        actualLocation: {
          $typeName: 'dev.spy.shared.v1.Location',
          scriptId,
          lineNumber: actualLocation.lineNumber,
          columnNumber: actualLocation.columnNumber ?? 0,
        },
      };
    },
  };

  await connectToServer(client, headers, handlers);
}
