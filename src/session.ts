import { Debugger, Session } from 'node:inspector/promises';
import { EventEmitter } from 'node:events';

export class DebugSession {
  private session: Session;
  private scripts: Record<string, Debugger.ScriptParsedEventDataType> = {};
  private events = new EventEmitter();
  private logpoints = new Map<string, Debugger.SetBreakpointReturnType>();

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
    this.session.on('Debugger.scriptParsed', this.handleScriptParsed.bind(this));
    this.session.on('Debugger.paused', this.handlePaused.bind(this));
  }

  private async handleScriptParsed(msg: { params: Debugger.ScriptParsedEventDataType }) {
    const script = msg.params;
    this.scripts[script.scriptId] = script;
  }

  private async handlePaused(msg: Debugger.PausedEventDataType) {
    try {
      // ... handle pause event
      await this.session.post('Debugger.resume');
    } catch (error) {
      console.error('Error handling pause:', error);
      await this.session.post('Debugger.resume');
    }
  }

  getScripts() {
    return this.scripts;
  }

  async getScriptSource(scriptId: string) {
    const result = await this.session.post('Debugger.getScriptSource', { scriptId });
    return result.scriptSource;
  }
} 