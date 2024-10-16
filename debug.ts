import { Session, Debugger, url } from 'node:inspector';
import { isMainThread } from 'node:worker_threads';

console.log(isMainThread ? 'Main thread' : 'Worker thread')

console.log(url())

const session = new Session();
session.connect();
console.log(url())

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const scripts: { [key: string]: Debugger.ScriptParsedEventDataType } = {}

session.on('Debugger.scriptParsed', async (msg) => {
    const script = msg.params
    scripts[script.scriptId] = script
    if (script.url !== ''
        && !script.url.startsWith('node:')
        && !script.url.includes('/node_modules/')) {
        // console.log(script)

        session.post('Debugger.getScriptSource', { scriptId: script.scriptId }, (err, res) => {
            if (err) {
                console.error('Error getting script source', err)
                return
            }

            console.log(script.scriptId, scripts[script.scriptId], res)
            if (scripts[script.scriptId].url.endsWith('test.js')) {
                session.post('Debugger.setBreakpoint', {
                    location: {
                        scriptId: script.scriptId,
                        lineNumber: 7,
                        columnNumber: 0
                    }
                }, (err, bp) => {
                    if (err) {
                        console.error('Error setting breakpoint', err)
                        return
                    }
                    console.log('Breakpoint set', bp)
                })
            }
        })
    } else {
        // console.log(`${script.scriptId} — ${script.url}`)
    }
})

session.on('Debugger.paused', (msg) => {
    console.log('Paused in function')
    console.log(msg.params.callFrames[0].functionName)
    console.log(msg)
    console.log('\n')

    for (const frame of msg.params.callFrames) {
        console.log(frame)
        const localScope = frame.scopeChain.find((scope) => scope.type === "local");
        if (localScope?.object?.objectId) {
            // this is synchronous, somehow?
            session.post("Runtime.getProperties", {
                objectId: localScope.object.objectId,
                ownProperties: true,
            }, (err, result) => {
                for (let i = 0; i < 10_000_000; ++i)
                    process.env.A = 'a';
                console.log("Runtime.getProperties", err, result);
            });
        }
    }
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
        console.log('[notification]', msg)
})

// don't step into or break in node_modules
// session.post('Debugger.setBlackboxPatterns', { patterns: ["/node_modules/|/bower_components/"] }, (err) => {
// await session.post('Debugger.setBlackboxPatterns', { patterns: [] })

// await session.post('Runtime.enable')

session.post('Debugger.enable', (err, res) => console.log('Debugger enabled', err, res))
console.log('debugger enabled')
// const params = await session.post('Debugger.enable')
// console.log('Enabled debugger', params)
console.log(url())
await session.post('Debugger.setBreakpointsActive', { active: true })
await session.post('Runtime.evaluate', { expression: 'console.log("hello from inspector")' });