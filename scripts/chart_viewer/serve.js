const http = require('http');
const config = require('../../src/config');
const sharedRoutes = require('./routes/shared.routes');
const liveRoutes = require('./routes/live.routes');
const backtestRoutes = require('./routes/backtest.routes');

const PORT = process.env.CHART_PORT || config.CHART_PORT || 3400;

// Simple router (not Express — giữ dependency minimal)
class SimpleRouter {
  constructor() { this.routes = []; }
  
  add(method, pattern, handler) { 
    this.routes.push({ method, pattern, handler }); 
  }
  
  async handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    for (const route of this.routes) {
      if (req.method === route.method && url.pathname === route.pattern) {
        return await route.handler(req, res, url);
      }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); 
    res.end('404 Not Found');
  }
}

const router = new SimpleRouter();
sharedRoutes.register(router);
liveRoutes.register(router);
backtestRoutes.register(router);

const server = http.createServer(async (req, res) => {
  await router.handle(req, res);
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`[CHART] Live Chart & Dashboard server started`);
  console.log(`[CHART] Local: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
