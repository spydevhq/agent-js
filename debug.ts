import { Session, Debugger } from 'node:inspector';

export function init() {
    const session = new Session();
    session.connect();

    const scripts: { [key: string]: Debugger.ScriptParsedEventDataType } = {}

    /*
    "params": {  
        scriptId: '483',
        url: 'file:///Users/ben/dev/debugger/server.js',
        startLine: 0,
        startColumn: 0,
        endLine: 14,
        endColumn: 16,
        executionContextId: 1,
        hash: '0141ce681cff93c15817593ea95b572e6cbd2a1b',
        executionContextAuxData: { isDefault: true },
        isLiveEdit: false,
        sourceMapURL: '',
        hasSourceURL: false,
        isModule: true,
        length: 302,
        stackTrace: { callFrames: [Array] },
        scriptLanguage: 'JavaScript',
        embedderName: 'file:///Users/ben/dev/debugger/server.js'
    }
    */
    session.on('Debugger.scriptParsed', (msg) => {
        const script = msg.params
        scripts[script.scriptId] = script
        if (script.url !== ''
            && !script.url.startsWith('node:')
            && !script.url.includes('/node_modules/')) {
            console.log(script)

            session.post('Debugger.getScriptSource', { scriptId: script.scriptId }, (err, res) => {
                if (err != null)
                    return console.error(script.scriptId, err)

                console.log(script.scriptId, res)
            })
            /*
            How do we break on http requests?
            - break inside expressjs
            - break on all .get() / .post() calls
            - eval js to add middleware
            */
        } else {
            console.log(`${script.scriptId} — ${script.url}`)
        }
    })
    session.on('inspectorNotification', (msg) => {
        if (msg.method !== 'Debugger.scriptParsed')
            console.log(msg)
    })

    session.on('Debugger.paused', (msg) => {
        console.log('Paused', msg)
        for (const frame of msg.params.callFrames) {
            const fnName = frame.functionName || '<anonymous>'
            const url = scripts[frame.location.scriptId].url
            const filename = url.split('/').pop()
            const line = frame.location.lineNumber
            const col = frame.location.columnNumber

            console.log(`${fnName} at ${filename}:${line}:${col}`)
        }
        // session.post('Debugger.resume')
    })

    session.post('Runtime.evaluate', { expression: 'console.log("hello from inspector")' });
    session.post('Debugger.enable', (err, params) => {
        console.log('Enabled debugger', {err, params})
        if (err != null) {
            return
        }

        session.post('Debugger.setBlackboxPatterns', { patterns: ["/node_modules/|/bower_components/"] }, (err) => {
            console.log('set blackbox', { err })

            // session.post('')
        })
    })
}

export function middleware(req, res, next) {
    // start
    debugger;
    next()
    debugger;
    // end
}
