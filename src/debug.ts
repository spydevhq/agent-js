import assert from 'node:assert';
import { Debugger, Runtime, Session } from 'node:inspector/promises';
import { inspect } from 'node:util';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

import EventEmitter from 'node:events';
import WebSocket from 'ws';

console.log(
  `🍱 Running in ${isMainThread ? 'Main thread' : 'Worker thread'} process[${process.title}]\n
  agent[${workerData?.isDebugSdkWorker}] id[${workerData?.id}]`,
);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface Process {
      _rawDebug: (message?: any, ...optionalParams: any[]) => void;
    }
  }
}

type HttpTrace = {
  time: string;
  method: string;
  path: string;
  // duration: number;
  // size: number;
  status: number;
};

if (isMainThread || workerData?.isDebugSdkWorker == null) {
  const random = Math.floor(Math.random() * 1000);
  const worker = new Worker(__filename, { workerData: { isDebugSdkWorker: true, id: random } });
  worker.on('error', (err) => console.error('Worker error', err));
  worker.on('exit', (code) => console.log('Worker exited', code));
} else {
  const ws = new WebSocket('ws://host.docker.internal:3000/api/agent');
  ws.on('error', (err: unknown) => console.error('🔥 websocket error', err));
  ws.on('open', () => {
    console.log('🔥 connected');
    ws.send(JSON.stringify({ type: 'initSession' }));
  });

  parentPort?.on('message', () => {}); // stop worker from dying early

  const session = new Session();

  const scripts: { [key: string]: Debugger.ScriptParsedEventDataType } = {};
  const events = new EventEmitter();
  const logpoints = new Map<string, Debugger.SetBreakpointReturnType>();

  let httpTracingOn = false;

  ws.on('message', (data: unknown) => {
    assert(data instanceof Buffer);
    console.log('🔥 message', data.toString('utf8'));

    const msg = JSON.parse(data.toString('utf8'));

    // eslint-disable-next-line unicorn/prefer-switch
    if (msg.type === 'getSourceTree') {
      const response = JSON.stringify({
        type: 'sourceTree',
        tree: scripts,
      });
      ws.send(response);
    } else if (msg.type === 'getScriptSource') {
      const scriptId: string = msg.scriptId;
      const script = scripts[scriptId];
      if (script) {
        session
          .post('Debugger.getScriptSource', { scriptId })
          .then((res) => {
            ws.send(
              JSON.stringify({
                type: 'scriptSource',
                scriptId,
                source: res.scriptSource,
              }),
            );
          })
          .catch(console.error);
      }
    } else if (msg.type === 'streamHttpTraces') {
      if (!httpTracingOn) {
        traceHttp(ws).catch((error) => {
          console.error(error);
          httpTracingOn = false;
        });
      }
    } else if (msg.type === 'setLogpoint') {
      setLogpoint(msg.id, msg.scriptId, msg.line, msg.active).catch(console.error);
    }
  });

  async function setLogpoint(requestId: string, scriptId: string, line: number, active: boolean) {
    console.log('Setting logpoint', scriptId, line, active);

    if (active) {
      const lp = await session.post('Debugger.setBreakpoint', {
        location: {
          scriptId,
          lineNumber: line,
        },
      });
      logpoints.set(`${scriptId}:${line}`, lp);
      ws.send(
        JSON.stringify({
          type: 'logpoint',
          requestId,
          actualLocation: lp.actualLocation,
          breakpointId: lp.breakpointId,
        }),
      );
    } else {
      const bp = logpoints.get(`${scriptId}:${line}`);
      if (bp) {
        await session.post('Debugger.removeBreakpoint', {
          breakpointId: bp.breakpointId,
        });
        logpoints.delete(`${scriptId}:${line}`);
      }
    }
  }

  async function traceHttp(ws: WebSocket) {
    httpTracingOn = true;

    // 1. find trace points
    const agentScript = Object.values(scripts).find((script) => script.url.endsWith('debug.interceptor.js'));
    if (!agentScript) {
      console.error('Agent script not found');
      return;
    }

    const sourceCode = await session.post('Debugger.getScriptSource', { scriptId: agentScript.scriptId });
    const preReqLine = sourceCode.scriptSource.split('\n').findIndex((line) => line.includes('function preRequest'));
    const postReqLine = sourceCode.scriptSource.split('\n').findIndex((line) => line.includes('function postRequest'));

    if (preReqLine === -1 || postReqLine === -1) {
      console.error('preRequest or postRequest not found', sourceCode.scriptSource);
      return;
    }

    // 3. on Debugger.paused, fetch all the details, and emit the event
    events.on('httpTrace', (trace: HttpTrace) => {
      ws.send(JSON.stringify({ type: 'httpTrace', trace }));
    });

    // 2. set up breakpoints
    const preReqBp = await session.post('Debugger.setBreakpoint', {
      location: {
        scriptId: agentScript.scriptId,
        lineNumber: preReqLine,
      },
    });

    const postReqBp = await session.post('Debugger.setBreakpoint', {
      location: {
        scriptId: agentScript.scriptId,
        lineNumber: postReqLine,
      },
    });

    console.log('Breakpoints set', preReqBp, postReqBp);
  }

  session.on('Debugger.scriptParsed', (msg) => {
    // process._rawDebug('parsed', msg.params.url);
    const script = msg.params;
    scripts[script.scriptId] = script;
    if (script.url !== '' && !script.url.startsWith('node:') && !script.url.includes('/node_modules/')) {
      // console.log(script)
      // const res = await session.post('Debugger.getScriptSource', { scriptId: script.scriptId });
      // console.log(script.scriptId, scripts[script.scriptId], res)
      // process._rawDebug(script.scriptId, script.url);
    } else {
      // console.log(`${script.scriptId} — ${script.url}`)
    }
  });

  async function access(obj: Runtime.GetPropertiesReturnType, field: string) {
    const prop = obj.result.find((prop) => prop.name === field);
    if (prop && prop.value?.objectId) {
      return await session.post('Runtime.getProperties', { objectId: prop.value.objectId, ownProperties: true });
    }
    return null;
  }

  function getField<T>(obj: Runtime.GetPropertiesReturnType, field: string): T | null {
    const prop = obj.result.find((prop) => prop.name === field);
    if (prop && prop.value?.value) {
      return prop.value.value;
    }
    return null;
  }

  async function fetchEntireObject(obj: Runtime.RemoteObjectId): Promise<object> {
    const props = await session.post('Runtime.getProperties', {
      objectId: obj,
      ownProperties: true,
    });

    const res: Record<string, unknown> = {};

    for (const prop of props.result) {
      // eslint-disable-next-line unicorn/prefer-ternary
      if (prop.value?.objectId) {
        res[prop.name] = await fetchEntireObject(prop.value.objectId);
      } else {
        res[prop.name] = prop.value?.value;
      }
    }

    return res;
  }

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  session.on('Debugger.paused', async (msg) => {
    const fnName = msg.params.callFrames[0].functionName;
    const fileName = scripts[msg.params.callFrames[0].location.scriptId].url;
    const lineNumber = msg.params.callFrames[0].location.lineNumber;

    try {
      process._rawDebug(
        `⏸️ Paused in function[${fnName}] file[${fileName}] line[${lineNumber}] reason[${msg.params.reason}]`,
      );

      // if (!fileName.includes('node_modules') && !fileName.startsWith('node:')) {
      //   process._rawDebug(msg.params.callFrames[0]);
      //   process._rawDebug(msg);
      //   process._rawDebug(msg.params.callFrames[0].scopeChain);
      // }

      const lpBreakIds = [...logpoints.values()].map((lp) => lp.breakpointId);

      if (fnName === 'postRequest' && fileName.endsWith('debug.interceptor.js')) {
        const top = msg.params.callFrames[0];
        const localScope = top.scopeChain[0]; // TODO: this might be 'block', not 'local'
        assert(localScope.type === 'local');
        assert(localScope.object?.objectId);

        const localScopeObj = await session.post('Runtime.getProperties', {
          objectId: localScope.object.objectId,
          ownProperties: true,
        });

        const _args = await access(localScopeObj, '_args');
        assert(_args != null);
        const req = await access(_args, '0');
        assert(req != null);
        const res = await access(_args, '1');
        assert(res != null);

        events.emit('httpTrace', {
          time: new Date().toISOString(),
          method: getField(req, 'method')!, // TODO null safety
          path: getField(req, 'url')!,
          status: getField(res, 'statusCode')!,
        } satisfies HttpTrace);

        // console.log('local scope:', inspect([_args, req, res], { depth: null, colors: true }));
      } else if ((msg.params.hitBreakpoints || []).some((bp) => lpBreakIds.includes(bp))) {
        console.log('Logpoint hit');

        const top = msg.params.callFrames[0];
        const localScope = top.scopeChain[0]; // TODO: this might be 'block', not 'local'
        assert(localScope.type === 'local');
        assert(localScope.object?.objectId);

        const obj = await fetchEntireObject(localScope.object.objectId);

        console.log('local scope:', inspect(obj, { depth: null, colors: true }));

        events.emit('logpoint', {
          time: new Date().toISOString(),
          breakpointIds: msg.params.hitBreakpoints,
          data: obj,
        });
      }

      // {
      //   const top = msg.params.callFrames[0];
      //   const localScope = top.scopeChain.find((scope) => scope.type === 'local');
      //   if (localScope?.object?.objectId) {
      //     // this is synchronous, somehow?
      //     const result = await session.post('Runtime.getProperties', {
      //       objectId: localScope.object.objectId,
      //       ownProperties: true,
      //     });
      //     process._rawDebug('variables:', result.result.map((prop) => prop.name).join(', '));

      //     const req = result.result.find((prop) => prop.name === 'req');
      //     if (req && req.value?.objectId) {
      //       const reqObj = await session.post('Runtime.getProperties', {
      //         objectId: req.value.objectId,
      //         ownProperties: true,
      //       });
      //       process._rawDebug('req props:', reqObj.result.map((prop) => prop.name).join(', '));

      //       const params = reqObj.result.find((prop) => prop.name === 'params');
      //       if (params && params.value?.objectId) {
      //         const paramsObj = await session.post('Runtime.getProperties', {
      //           objectId: params.value.objectId,
      //           ownProperties: true,
      //         });
      //         process._rawDebug('req.params:', JSON.stringify(paramsObj.result, null, 2));
      //       } else {
      //         process._rawDebug('req.params not found');
      //       }

      //       const query = reqObj.result.find((prop) => prop.name === 'query');
      //       if (query && query.value?.objectId) {
      //         const queryObj = await session.post('Runtime.getProperties', {
      //           objectId: query.value.objectId,
      //           ownProperties: true,
      //         });
      //         process._rawDebug('req.query:', JSON.stringify(queryObj.result, null, 2));
      //       } else {
      //         process._rawDebug('req.query not found');
      //       }
      //     }
      //   }
      // }

      // for (const frame of msg.params.callFrames) {
      // console.log(frame)
      // const localScope = frame.scopeChain.find((scope) => scope.type === "local");
      // if (localScope?.object?.objectId) {
      // this is synchronous, somehow?
      // const result = await session.post("Runtime.getProperties", {
      // objectId: localScope.object.objectId,
      // ownProperties: true,
      // })
      // const scriptUrl = scripts[frame.location.scriptId].url
      // const names = result.result.map((prop) => prop.name).join(', ')
      // process._rawDebug(frame.functionName, scriptUrl, "local scope", names)
      // }
      // }
      // session.post("Debugger.stepOver", (err) => console.log("Stepped over", err));
      // session.post("Debugger.resume");
      // process._rawDebug(inspect(msg.params, { depth: null, colors: true }));
      for (const frame of msg.params.callFrames) {
        const fnName = frame.functionName || '<anonymous>';
        const url = scripts[frame.location.scriptId].url;
        const line = frame.location.lineNumber;
        const col = frame.location.columnNumber;

        const scopes = frame.scopeChain.map((scope) => scope.type).join(', ');

        process._rawDebug(`${fnName} \t@ ${url}:${line}:${col}. scopes[${scopes}]`);
      }
    } catch (error) {
      process._rawDebug('Error in paused handler', error);
    } finally {
      await session.post('Debugger.resume');
      // if (fnName === 'postRequest' && fileName.endsWith('debug.interceptor.js')) {
      //   await session.post('Debugger.resume');
      // } else if (fileName.startsWith('node:')) {
      //   process._rawDebug('blackbox didnt work');
      //   await session.post('Debugger.stepOut');
      // } else {
      //   await session.post('Debugger.stepInto');
      // }
    }
    process._rawDebug('\n\n');

    // const top = msg.params.callFrames[0]
    // const script = scripts[top.location.scriptId]

    // const scope = await session.post('Runtime.globalLexicalScopeNames', { executionContextId: script.executionContextId })
    // console.log('Scope', scope)
  });

  session.on('Debugger.breakpointResolved', (msg) => {
    process._rawDebug('Breakpoint resolved', msg);
  });

  session.on('inspectorNotification', (msg) => {
    const exclude = ['Debugger.scriptParsed', 'Debugger.paused', 'Debugger.breakpointResolved'];
    if (!exclude.includes(msg.method)) {
      process._rawDebug('[📢 notification]', msg.method, msg.params);
    }
  });

  session.connectToMainThread();

  (async () => {
    try {
      process._rawDebug('initializing');
      // await session.post('Runtime.enable')
      // process._rawDebug('Runtime enabled')
      await session.post('Debugger.setBreakpointsActive', { active: true });
      // await session.post('Debugger.setSkipAllPauses', { skip: true });

      await session.post('Runtime.evaluate', { expression: 'process._rawDebug("hello from inspector")' });

      // auto step out of source files that match these patterns
      await session.post('Debugger.setBlackboxPatterns', {
        patterns: [
          '/node_modules/',
          '/^node:/', // TODO: this one isn't working
        ],
      });

      process._rawDebug('enabling debugger');
      const res = await session.post('Debugger.enable');
      process._rawDebug('Debugger enabled', res.debuggerId);

      process._rawDebug('evaluating');
    } catch (error) {
      process._rawDebug('error', error);
    }
  })().catch(console.error);

  // session.post('Debugger.pause', (err) => console.log('Paused', err))
  // session.post('Debugger.setBreakpointsActive', { active: true }, (err) => console.log('Breakpoints active', err))
  // session.post('NodeWorker.enable', {}, (err) => console.log('NodeWorker enabled', err))
}

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception', err);
});
