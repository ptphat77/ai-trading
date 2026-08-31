const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const config = require('../../src/config');

const PORT = config.CHART_PORT || 3400;
const HTML_FILE_PATH = path.join(__dirname, 'index.html');

function getResolvedCsvPath() {
  return config.CSV_DATA_PATH
    ? path.resolve(process.cwd(), config.CSV_DATA_PATH)
    : path.resolve(process.cwd(), 'data/candles.csv');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const resolvedCsvPath = getResolvedCsvPath();

  // Route: Serve index.html
  if (url.pathname === '/' || url.pathname === '/index.html') {
    if (!fs.existsSync(HTML_FILE_PATH)) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Error: index.html not found.');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(HTML_FILE_PATH).pipe(res);
    return;
  }

  // Route: Serve CSV Candle Data
  if (url.pathname === '/api/candles') {
    if (!fs.existsSync(resolvedCsvPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        error: `CSV file not found at: ${resolvedCsvPath}. Please check CSV_DATA_PATH in your .env file.`
      }));
      return;
    }

    try {
      const buf = fs.readFileSync(resolvedCsvPath);
      let text;

      // Handle UTF-16LE encoding (common in MetaTrader 4/5 exports)
      if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
        text = buf.toString('utf16le');
      } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
        text = buf.swap16().toString('utf16le');
      } else {
        text = buf.toString('utf8');
      }

      // Remove BOM character if present
      if (text.charCodeAt(0) === 0xFEFF) {
        text = text.slice(1);
      }

      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache'
      });
      res.end(text);
    } catch (readErr) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: `Error reading CSV file: ${readErr.message}` }));
    }
    return;
  }

  // Route: Serve Config info for Chart UI
  if (url.pathname === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      symbol: config.SYMBOL,
      timeframe: config.TIMEFRAME,
      csvPath: config.CSV_DATA_PATH,
      maType: config.MA_TYPE,
      maFast: config.MA_FAST_PERIOD,
      maSlow: config.MA_SLOW_PERIOD,
      rsiPeriod: config.RSI_PERIOD,
      rsiOversold: config.RSI_OVERSOLD,
      rsiOverbought: config.RSI_OVERBOUGHT,
      atrPeriod: config.ATR_PERIOD
    }));
    return;
  }

  // 404 for other routes
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  const resolvedCsvPath = getResolvedCsvPath();
  console.log(`\n======================================================`);
  console.log(`  📊 Chart Viewer is running at: \x1b[36m${url}\x1b[0m`);
  console.log(`  📁 CSV source path: \x1b[33m${resolvedCsvPath}\x1b[0m`);
  console.log(`======================================================\n`);

  // Auto-open in default browser
  const startCommand =
    process.platform === 'win32'
      ? `start ${url}`
      : process.platform === 'darwin'
      ? `open ${url}`
      : `xdg-open ${url}`;

  exec(startCommand, (err) => {
    if (err) {
      console.log(`[ChartViewer] Please open ${url} in your browser.`);
    }
  });
});
