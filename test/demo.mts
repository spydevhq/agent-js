import http from 'node:http';
import spyDev from '../src/index.mjs';

spyDev.init({
  appName: 'demo-app',
  accessToken:
    '2c31bcc1635112b69fbf524530893d44f24a2010dc8f797fc9102678b936eff7',
  baseUrl: 'https://localhost:4000',
});

function go() {
  let obj: any = {};
  obj.recurseMe = obj;
  return 1;
}

const server = http.createServer((req, res) => {
  go();
  res.end('Hello, world!');
});

server.listen(9845);
console.log('Server is listening on http://localhost:9845');
