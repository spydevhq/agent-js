import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';
import { parentPort, workerData } from 'node:worker_threads';
import { eventToAsyncIterable, mapAsyncIterable } from './asyncIterable.js';
import { handleCommandStream } from './commandStream.js';
import { DebugSession } from './debugger.js';
import { BackendService } from './gen/dev/spy/agent/v1/agent_pb.js';
import { launch } from './launcher.js';
import { CommandHandlers, SpyDevConfig, SpyDevMetadata } from './types.js';
import { exponentialBackoff } from './util.js';

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

  if (!config.accessToken) {
    throw new Error('spy.dev: access token is required');
  }

  if (!config.appName) {
    throw new Error('spy.dev: app name is required');
  }

  if (workerData?.isSpyDevAgent == null) {
    launch(config, {
      argv: process.argv,
    });
  }
}

export async function runAgent(config: SpyDevConfig, metadata: SpyDevMetadata) {
  process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection', err);
  });

  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception', err);
  });

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
      const { actualLocation, breakpointId } = await session.addLogpoint(
        scriptId,
        line,
      );
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
    removeLogpoint: async ({ breakpointId }) => {
      await session.removeLogpoint(breakpointId);
      return {
        $typeName: 'dev.spy.agent.v1.RemoveLogpointResponse',
      };
    },
  };

  const commandStream = handleCommandStream(client, headers, handlers);
  const logpointHits = client.logpointHits(
    mapAsyncIterable(
      eventToAsyncIterable(session.events, 'logpointHit'),
      (hit) => ({
        $typeName: 'dev.spy.agent.v1.LogpointHitsRequest',
        hit: {
          $typeName: 'dev.spy.shared.v1.LogpointHit',
          breakpointId: hit.breakpointIds,
          vars: JSON.stringify(hit.vars),
          time: hit.time,
        },
      }),
    ),
    { headers },
  );

  await Promise.all([commandStream, logpointHits]);
}
