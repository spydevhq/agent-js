import express from 'express'
// import * as debug from './debug'

// debug.init()

const app = express()

// app.use(debug.middleware)

app.get('/hello/:greet', (req, res) => {
    console.log('hello')
    console.log(req.params)
    res.status(200).send(`hello ${req.params.greet}`)
})

console.log('http://localhost:3000')
app.listen(3000)