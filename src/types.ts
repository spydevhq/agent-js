import { Message } from '@bufbuild/protobuf';
import {
  CommandStreamRequest,
  CommandStreamResponse,
} from './gen/dev/spy/agent/v1/agent_pb.js';

// TODO: remove this?
declare global {
  namespace NodeJS {
    interface Process {
      _rawDebug: (message?: any, ...optionalParams: any[]) => void;
    }
  }
}

// connect rpc types
type Command = NonNullable<CommandStreamResponse['response']['case']>;

type CommandRequest<C extends Command> = Extract<
  CommandStreamRequest['request'],
  { case: C }
>['value'];

type CommandResponse<C extends Command> = Extract<
  CommandStreamResponse['response'],
  { case: C }
>['value'];

export type CommandHandlers = {
  [cmd in Command]: (
    req: CommandRequest<cmd>,
  ) => Promise<Partial<CommandResponse<cmd>> & Message>;
};

export type SpyDevConfig = {
  /**
   * The access token to use for the agent. You can generate one at https://spy.dev/settings
   */
  accessToken: string;

  /**
   * The name used to refer to this service.
   */
  appName: string;

  /**
   * You can use this to override the base URL. Useful for development of the agent.
   */
  baseUrl?: string;
};
