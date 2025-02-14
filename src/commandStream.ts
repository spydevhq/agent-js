import { Client } from '@connectrpc/connect';
import { EventEmitter } from 'events';
import { eventToAsyncIterable } from './asyncIterable.js';
import {
  BackendService,
  CommandStreamResponse,
} from './gen/dev/spy/agent/v1/agent_pb.js';
import { CommandHandlers } from './types.js';
import { exponentialBackoff } from './util.js';

async function run(
  client: Client<typeof BackendService>,
  headers: Headers,
  handlers: CommandHandlers,
) {
  const events = new EventEmitter<{ response: [CommandStreamResponse] }>();

  // upload responses
  const stream = client.commandStream(
    (async function* uploadCommands() {
      const resp = eventToAsyncIterable(events, 'response');
      for await (const x of resp) {
        console.log('>', x);
        yield x;
      }
    })(),
    { headers },
  );

  console.log('Successfully connected to server');

  // download commands
  for await (const req of stream) {
    console.log('<', req);

    if (!req.request.case) {
      console.log('unknown request', req);
      events.emit('response', {
        $typeName: 'dev.spy.agent.v1.CommandStreamResponse',
        requestId: req.requestId,
        error: {
          $typeName: 'dev.spy.agent.v1.CommandStreamResponse.Error',
          message: 'unknown request',
        },
        response: {
          case: undefined,
          value: undefined,
        },
      });
      continue;
    }

    const handler = handlers[req.request.case];

    handler(req.request.value as any)
      .then((res: any) => {
        events.emit('response', {
          $typeName: 'dev.spy.agent.v1.CommandStreamResponse',
          requestId: req.requestId,
          response: {
            case: req.request.case,
            value: res,
          },
        });
      })
      .catch((err) => {
        console.error('Error handling request', req, err);
        // TODO: report error
      });
  }
}

export async function handleCommandStream(
  client: Client<typeof BackendService>,
  headers: Headers,
  handlers: CommandHandlers,
): Promise<void> {
  await exponentialBackoff(async () => {
    await run(client, headers, handlers);
  });
}
