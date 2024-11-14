import { Session, Debugger, url } from 'node:inspector/promises';
import { start } from 'node:repl';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';

console.log('Running in', isMainThread ? 'Main thread' : 'Worker thread')

if (isMainThread) {
    const worker = new Worker(__filename)
    worker.on('error', (err) => console.error('Worker error', err))
    worker.on('exit', (code) => console.log('Worker exited', code))
} else {
    parentPort?.on('message', () => {}) // stop worker from dying early

    const session = new Session();
    let debuggerEnabled = false

    // function sleep(ms: number) {
    //     return new Promise(resolve => setTimeout(resolve, ms));
    // }

    const scripts: { [key: string]: Debugger.ScriptParsedEventDataType } = {}

    session.on('Debugger.scriptParsed', async (msg) => {
        process._rawDebug('parsed', msg.params.url)
        const script = msg.params
        scripts[script.scriptId] = script
        if (script.url !== ''
            && !script.url.startsWith('node:')
            && !script.url.includes('/node_modules/')) {
            // console.log(script)

            const res = await session.post('Debugger.getScriptSource', { scriptId: script.scriptId })
            // console.log(script.scriptId, scripts[script.scriptId], res)
            process._rawDebug(script.scriptId, script.url)
            if (scripts[script.scriptId].url.endsWith('test.js')) {
                process._rawDebug('Setting breakpoint', debuggerEnabled)

                // session.post('Runtime.evaluate', { expression: 'console.log("aiwjefoijwe fSetting breakpoint")' });

                const bp = await session.post('Debugger.setBreakpoint', {
                    location: {
                        scriptId: script.scriptId,
                        lineNumber: 7,
                    }
                })
                process._rawDebug('Breakpoint set', bp);

                // session.post('Debugger.setBreakpoint', {
                //     location: {
                //         scriptId: script.scriptId,
                //         lineNumber: 8,
                //         columnNumber: 0,
                //     }
                // }, (err, bp) => {
                //     if (err) {
                //         console.error('Error setting breakpoint', err)
                //         return
                //     }
                //     console.log('Breakpoint set', bp)
                // session.post('Debugger.resume', (err) => console.log('Resumed', err))
                // })
            }
        } else {
            // console.log(`${script.scriptId} — ${script.url}`)
        }
    })

    session.on('Debugger.paused', async (msg) => {
        const fnName = msg.params.callFrames[0].functionName
        const fileName = scripts[msg.params.callFrames[0].location.scriptId].url
        const lineNumber = msg.params.callFrames[0].location.lineNumber
 
        try {
            process._rawDebug(`⏸️ Paused in function[${fnName}] file[${fileName}] line[${lineNumber}] reason[${msg.params.reason}]`)

            if (!fileName.includes('node_modules') && !fileName.startsWith('node:')) {
                process._rawDebug(msg.params.callFrames[0])
                process._rawDebug(msg)
                process._rawDebug(msg.params.callFrames[0].scopeChain)
            }

            {
                const top = msg.params.callFrames[0]
                const localScope = top.scopeChain.find((scope) => scope.type === "local");
                if (localScope?.object?.objectId) {
                    // this is synchronous, somehow?
                    const result = await session.post("Runtime.getProperties", {
                        objectId: localScope.object.objectId,
                        ownProperties: true,
                    })
                    process._rawDebug('variables:', result.result.map((prop) => prop.name).join(', '))

                    const req = result.result.find((prop) => prop.name === 'req')
                    if (req && req.value?.objectId) {
                        const reqObj = await session.post("Runtime.getProperties", {
                            objectId: req.value.objectId,
                            ownProperties: true,
                        })
                        process._rawDebug('req props:', reqObj.result.map((prop) => prop.name).join(', '))

                        const params = reqObj.result.find((prop) => prop.name === 'params')
                        if (params && params.value?.objectId) {
                            const paramsObj = await session.post("Runtime.getProperties", {
                                objectId: params.value.objectId,
                                ownProperties: true,
                            })
                            process._rawDebug('req.params:', JSON.stringify(paramsObj.result, null, 2))
                        } else {
                            process._rawDebug('req.params not found')
                        }

                        const query = reqObj.result.find((prop) => prop.name === 'query')
                        if (query && query.value?.objectId) {
                            const queryObj = await session.post("Runtime.getProperties", {
                                objectId: query.value.objectId,
                                ownProperties: true,
                            })
                            process._rawDebug('req.query:', JSON.stringify(queryObj.result, null, 2))
                        } else {
                            process._rawDebug('req.query not found')
                        }
                    }
                }
            }

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
            for (const frame of msg.params.callFrames) {
                const fnName = frame.functionName || '<anonymous>'
                const url = scripts[frame.location.scriptId].url
                const line = frame.location.lineNumber
                const col = frame.location.columnNumber

                const scopes = frame.scopeChain.map((scope) => scope.type).join(', ')

                process._rawDebug(`${fnName} \t@ ${url}:${line}:${col}. scopes[${scopes}]`)
            }
        } catch (err) {
            process._rawDebug('Error in paused handler', err)
        } finally {
            if (fnName === 'middleware' && fileName.includes('debugger/dist/index.js') && lineNumber >= 19)
                await session.post('Debugger.resume')
            else if (fileName.startsWith('node:')) {
                process._rawDebug('blackbox didnt work')
                await session.post('Debugger.stepOut')
            } else
                await session.post('Debugger.stepInto')
        }
        process._rawDebug('\n\n')

        // const top = msg.params.callFrames[0]
        // const script = scripts[top.location.scriptId]

        // const scope = await session.post('Runtime.globalLexicalScopeNames', { executionContextId: script.executionContextId })
        // console.log('Scope', scope)

    })

    session.on('Debugger.breakpointResolved', (msg) => {
        process._rawDebug('Breakpoint resolved', msg)
    })

    session.on('inspectorNotification', (msg) => {
        const exclude = [
            'Debugger.scriptParsed',
            'Debugger.paused',
            'Debugger.breakpointResolved',
        ]
        if (!exclude.includes(msg.method))
            process._rawDebug('[📢 notification]', msg.method, msg.params)
    })


    session.connectToMainThread();

    (async () => {
        try {
            process._rawDebug('initializing')
            // await session.post('Runtime.enable')
            // process._rawDebug('Runtime enabled')
            // await session.post('Debugger.setBreakpointsActive', { active: false });
            // await session.post('Debugger.setSkipAllPauses', { skip: true });

            await session.post('Runtime.evaluate', { expression: 'process._rawDebug("hello from inspector")' });

            // auto step out of source files that match these patterns
            await session.post('Debugger.setBlackboxPatterns', { patterns: [
                "/node_modules/",
                "^node:", // TODO: this one isn't working
            ] })

            process._rawDebug('enabling debugger')
            const res = await session.post('Debugger.enable')
            process._rawDebug('Debugger enabled', res.debuggerId)
            debuggerEnabled = true
            process._rawDebug('Debugger enabled')

            process._rawDebug('evaluating')
        } catch (err) {
            process._rawDebug('error', err)
        }
    })();


    // session.post('Debugger.pause', (err) => console.log('Paused', err))
    // session.post('Debugger.setBreakpointsActive', { active: true }, (err) => console.log('Breakpoints active', err))
    // session.post('NodeWorker.enable', {}, (err) => console.log('NodeWorker enabled', err))

}

process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection', err)
})

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception', err)
})