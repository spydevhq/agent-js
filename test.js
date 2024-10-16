// import { init } from './index.ts'
// init()
import * as _ from './debug.js'

setTimeout(() => {
    const x = 42
    console.log('a')
    console.log('running...')
    // debugger
    console.log('resuming...')
    console.log('b')
}, 1000)