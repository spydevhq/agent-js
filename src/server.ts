import express from 'express'
import { middleware } from '.'
import './debug'

const app = express()

app.use(middleware)

app.use((req, res, next) => {
    console.log('params', req.params)
    next()
})

app.get('/hello/:greet', (req, res) => {
    console.log('hello')
    console.log(req.params)
    res.status(200).send(`hello ${req.params.greet}`)
})

console.log('http://localhost:3000')
app.listen(3000)