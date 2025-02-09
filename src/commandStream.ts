import { Client } from '@connectrpc/connect';
import { EventEmitter } from 'events';
import { eventToAsyncIterable } from './asyncIterable.js';
import {
  BackendService,
  CommandStreamResponse,
} from './gen/dev/spy/agent/v1/agent_pb.js';
import { CommandHandlers } from './types.js';

export async function startCommandStream(
  client: Client<typeof BackendService>,
  headers: Headers,
  handlers: CommandHandlers,
): Promise<void> {
  const events = new EventEmitter<{
    response: [CommandStreamResponse];
    ready: [];
  }>();

  const ready = new Promise<void>((resolve) => {
    events.once('ready', resolve);
  });

  // upload responses
  const stream = client.commandStream(
    (async function* uploadCommands() {
      const resp = eventToAsyncIterable(events, 'response');
      events.emit('ready');
      for await (const x of resp) {
        console.log('>', x);
        yield x;
      }
    })(),
    { headers },
  );

  // download commands
  (async () => {
    for await (const req of stream) {
      console.log('<', req);

      if (!req.request.case) {
        console.log('unknown request', req);
        continue;
      }

      // TODO: handle cancellation

      const handler = handlers[req.request.case];

      handler(req as any)
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
        .catch(console.error);
    }
  })().catch(console.error);

  await ready;
}
