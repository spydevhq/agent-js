// import { init } from './index'
// init()
import '../debug'

setTimeout(() => {
    const x = 42
    console.log('a')
    console.log('running...')
    // debugger;
    console.log('resuming...')
    console.log('b')
}, 2000)