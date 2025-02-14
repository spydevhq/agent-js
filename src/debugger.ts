import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { Debugger, Runtime, Session } from 'node:inspector/promises';
import { inspect } from 'node:util';

type LogpointHit = {
  time: string;
  breakpointIds: string[];
  vars: object;
};

export class DebugSession {
  public events = new EventEmitter<{ logpointHit: [LogpointHit] }>();
  private session: Session;
  private scripts: Record<string, Debugger.ScriptParsedEventDataType> = {};

  constructor() {
    this.session = new Session();
    this.setupEventHandlers();
  }

  async initialize() {
    await this.session.connectToMainThread();

    // TODO: maybe these should only be called if we have logpoints?
    await this.session.post('Debugger.setBreakpointsActive', { active: true });
    await this.session.post('Debugger.setBlackboxPatterns', {
      patterns: ['/node_modules/', '/^node:/'],
    });
    await this.session.post('Debugger.enable');
  }

  private setupEventHandlers() {
    this.session.on(
      'Debugger.scriptParsed',
      this.handleScriptParsed.bind(this),
    );
    this.session.on('Debugger.paused', this.handlePaused.bind(this));
  }

  private async handleScriptParsed(msg: {
    params: Debugger.ScriptParsedEventDataType;
  }) {
    const script = msg.params;
    this.scripts[script.scriptId] = script;
  }

  private async handlePaused({
    params,
  }: {
    params: Debugger.PausedEventDataType;
  }) {
    try {
      const fnName = params.callFrames[0].functionName;
      const fileName = this.scripts[params.callFrames[0].location.scriptId].url;
      const lineNumber = params.callFrames[0].location.lineNumber;
      process._rawDebug(
        `⏸️ Paused in function[${fnName}] file[${fileName}] line[${lineNumber}] reason[${params.reason}]`,
      );
      const hitBreakpoints = params.hitBreakpoints ?? [];
      assert(
        hitBreakpoints.length > 0,
        'Paused with no breakpoints hit: ' + inspect(params),
      );

      const top = params.callFrames[0];
      const localScope = top.scopeChain[0];
      // assert(localScope.type === 'local'); // TODO: this might be 'block', not 'local'
      assert(localScope.object?.objectId);

      const vars = await this.fetchEntireObject(localScope.object);

      this.events.emit('logpointHit', {
        time: new Date().toISOString(),
        breakpointIds: hitBreakpoints,
        vars,
      });
    } catch (error) {
      process._rawDebug('Error handling pause:', error);
    } finally {
      await this.session.post('Debugger.resume');
    }
  }

  private async fetchEntireObject(obj: Runtime.RemoteObject, depth = 0): Promise<object> {
    if (obj.objectId == null) {
      return {};
    }

    const props = await this.session.post('Runtime.getProperties', {
      objectId: obj.objectId,
      ownProperties: true,
      generatePreview: true,
    });

    const result: any = obj.subtype === 'array' ? [] : {};

    for (const prop of props.result) {
      if (prop.value?.type === 'function') {
        result[prop.name] = '<function>'; 
      } else if (prop.value?.objectId) { // TODO: support deeper properties, on demand
        if (depth < 5) {
          result[prop.name] = await this.fetchEntireObject(prop.value, depth + 1);
        } else {
          result[prop.name] = '<object>';
        }
      } else {
        result[prop.name] = prop.value?.value;
      }
    }

    return result;
  }

  getScripts() {
    return this.scripts;
  }

  async getScriptSource(scriptId: string) {
    const result = await this.session.post('Debugger.getScriptSource', {
      scriptId,
    });
    return result.scriptSource;
  }

  async addLogpoint(scriptId: string, line: number) {
    return await this.session.post('Debugger.setBreakpoint', {
      location: {
        scriptId,
        lineNumber: line,
      },
    });
  }

  async removeLogpoint(breakpointId: string) {
    await this.session.post('Debugger.removeBreakpoint', {
      breakpointId,
    });
  }
}