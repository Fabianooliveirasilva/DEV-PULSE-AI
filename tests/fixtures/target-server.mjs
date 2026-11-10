// Controllable HTTP service used as a monitoring target in E2E tests.
// GET /health → 200 or 503 depending on the current mode; POST /mode/{up|down|slow} switches it.
import { createServer } from 'node:http';

let mode = 'up';
const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url?.startsWith('/mode/')) {
    mode = req.url.slice(6);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ mode }));
    return;
  }
  if (mode === 'down') return void res.writeHead(503).end('service unavailable');
  if (mode === 'slow') return void setTimeout(() => res.writeHead(200).end('ok'), 1200);
  res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
});
server.listen(Number(process.env.PORT ?? 4110), '127.0.0.1');
