// import { Worker } from 'node:worker_threads';

import { Request, Response, NextFunction } from 'express';

export function init() {
    // console.log(import.meta.url)
    // const mod = require.resolve('./debug.ts', import.meta.url)
    // console.log(mod)
// 
    // const worker = new Worker(mod)
// 
    // worker.on('message', (msg) => {
        // console.log('Worker message', msg)
    // })
}

export function middleware(req: Request, res: Response, next: NextFunction) {
    debugger;
    next();
    debugger;
}