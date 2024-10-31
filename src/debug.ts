import { Session, Debugger, url } from 'node:inspector/promises';
import { start } from 'node:repl';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';

console.log('Running in', isMainThread ? 'Main thread' : 'Worker thread')


if (isMainThread) {
    const worker = new Worker(__filename)
    worker.on('error', (err) => console.error('Worker error', err))
} else {
    parentPort?.on('message', () => {})

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
            console.log(script.scriptId, script.url)
            if (scripts[script.scriptId].url.endsWith('test.js')) {
                process._rawDebug('Setting breakpoint', debuggerEnabled)

                // session.post('Runtime.evaluate', { expression: 'console.log("aiwjefoijwe fSetting breakpoint")' });

                try {
                    const bp = await session.post('Debugger.setBreakpointByUrl', {
                        url: script.url,
                        lineNumber: 7,
                    });
                    process._rawDebug('Breakpoint set', bp);
                } catch (err) {
                    process._rawDebug('Error setting breakpoint', err);
                }

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
        process._rawDebug('Paused in function', msg.params.callFrames[0].functionName)
        // console.log(msg)
        await session.post('Debugger.resume')

        // for (const frame of msg.params.callFrames) {
        //     console.log(frame)
        //     const localScope = frame.scopeChain.find((scope) => scope.type === "local");
        //     if (localScope?.object?.objectId) {
        //         // this is synchronous, somehow?
        //         session.post("Runtime.getProperties", {
        //             objectId: localScope.object.objectId,
        //             ownProperties: true,
        //         }, (err, result) => {
        //             // for (let i = 0; i < 10_000_000; ++i)
        //                 // process.env.A = 'a';
        //             console.log("Runtime.getProperties", err, result);
        //         });
        //     }
        // }
        // session.post("Debugger.stepOver", (err) => console.log("Stepped over", err));
        // session.post("Debugger.resume");
        // for (const frame of msg.params.callFrames) {
        //     const fnName = frame.functionName || '<anonymous>'
        //     const url = scripts[frame.location.scriptId].url
        //     const filename = url.split('/').pop()
        //     const line = frame.location.lineNumber
        //     const col = frame.location.columnNumber

        //     console.log(`${fnName} \t@ ${filename}:${line}:${col}`)
        // }

        // const top = msg.params.callFrames[0]
        // const script = scripts[top.location.scriptId]

        // const scope = await session.post('Runtime.globalLexicalScopeNames', { executionContextId: script.executionContextId })
        // console.log('Scope', scope)

    })

    session.on('Debugger.breakpointResolved', (msg) => {
        console.log('Breakpoint resolved', msg)
    })

    session.on('inspectorNotification', (msg) => {
        if (msg.method !== 'Debugger.scriptParsed' && msg.method !== 'Runtime.consoleAPICalled')
            console.log('[notification]', msg.method, msg.params)
    })

    // don't step into or break in node_modules
    // session.post('Debugger.setBlackboxPatterns', { patterns: ["/node_modules/|/bower_components/"] }, (err) => {
    // await session.post('Debugger.setBlackboxPatterns', { patterns: [] })

    // await session.post('Runtime.enable')
    session.connectToMainThread();

    (async () => {
        try {
            process._rawDebug('initializing')
            // await session.post('Runtime.enable')
            // process._rawDebug('Runtime enabled')
            // await session.post('Debugger.setBreakpointsActive', { active: false });
            // await session.post('Debugger.setSkipAllPauses', { skip: true });

            await session.post('Runtime.evaluate', { expression: 'console.log("hello from inspector")' });

            process._rawDebug('enabling debugger')
            const res = await session.post('Debugger.enable')
            process._rawDebug('Debugger enabled', res.debuggerId)
            debuggerEnabled = true
            process._rawDebug('Debugger enabled')

            console.log('evaluating')
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