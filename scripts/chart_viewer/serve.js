const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const config = require('../../src/config');

const PORT = config.CHART_PORT || 3400;
const BRIDGE_URL = process.env.MT5_BRIDGE_URL || 'http://127.0.0.1:8000';
const HTML_FILE_PATH = path.join(__dirname, 'index.html');
const LOGS_DIR = path.resolve(process.cwd(), 'logs');

function getResolvedCsvPath() {
  return config.CSV_DATA_PATH
    ? path.resolve(process.cwd(), config.CSV_DATA_PATH)
    : path.resolve(process.cwd(), 'data/candles.csv');
}

function getResolvedTradeLogPath() {
  return config.TRADE_LOG_PATH
    ? path.resolve(process.cwd(), config.TRADE_LOG_PATH)
    : null;
}

// Helper to fetch JSON from Python bridge with timeout
async function fetchBridgeJson(endpointPath, timeoutMs = 2000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${BRIDGE_URL}${endpointPath}`, {
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Read CSV with auto-detection of UTF-16LE / UTF-8
function readCsvFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  let text;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    text = buf.toString('utf16le');
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    text = buf.swap16().toString('utf16le');
  } else {
    text = buf.toString('utf8');
  }
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }
  return text;
}

// Parse CSV text into candle objects
function parseCsvToCandles(csvText, maxCount = 5000) {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headerLine = lines[0].toLowerCase();
  const sep = headerLine.includes('\t') ? '\t' : (headerLine.includes(';') ? ';' : ',');
  const headers = headerLine.split(sep).map(h => h.replace(/[<>]/g, '').trim());

  let dIdx = -1, tIdx = -1, oIdx = -1, hIdx = -1, lIdx = -1, cIdx = -1, vIdx = -1;
  headers.forEach((h, i) => {
    if (h === 'date' || h === 'datetime' || h === 'time_utc') dIdx = i;
    else if (h === 'time') tIdx = i;
    else if (h === 'open') oIdx = i;
    else if (h === 'high') hIdx = i;
    else if (h === 'low') lIdx = i;
    else if (h === 'close') cIdx = i;
    else if (h === 'tickvol' || h === 'vol' || h === 'volume') vIdx = i;
  });

  if (oIdx === -1 || hIdx === -1 || lIdx === -1 || cIdx === -1) {
    // Default column fallback
    dIdx = 0; tIdx = 1; oIdx = 2; hIdx = 3; lIdx = 4; cIdx = 5; vIdx = 6;
  }

  const candles = [];
  const startIdx = 1;
  for (let i = startIdx; i < lines.length; i++) {
    const row = lines[i].split(sep);
    if (row.length <= Math.max(oIdx, hIdx, lIdx, cIdx)) continue;

    const dateStr = (dIdx !== -1 ? row[dIdx] : '').trim();
    const timeStr = (tIdx !== -1 ? row[tIdx] : '').trim();
    const fullDate = timeStr ? `${dateStr} ${timeStr}` : dateStr;

    const parts = fullDate.split(/[\sT]+/);
    const dPart = parts[0] || '';
    const tPart = parts[1] || '00:00:00';

    let year = 1970, month = 1, day = 1;
    if (dPart.includes('.')) {
      const dp = dPart.split('.');
      year = parseInt(dp[0], 10);
      month = parseInt(dp[1], 10);
      day = parseInt(dp[2], 10);
    } else if (dPart.includes('-')) {
      const dp = dPart.split('-');
      year = parseInt(dp[0], 10);
      month = parseInt(dp[1], 10);
      day = parseInt(dp[2], 10);
    } else if (dPart.includes('/')) {
      const dp = dPart.split('/');
      year = parseInt(dp[2] && dp[2].length === 4 ? dp[2] : dp[0], 10);
      month = parseInt(dp[1] || dp[0], 10);
      day = parseInt(dp[0] || dp[1], 10);
    }

    const tp = tPart.split(':');
    const hours = parseInt(tp[0] || 0, 10);
    const minutes = parseInt(tp[1] || 0, 10);
    const seconds = parseInt(tp[2] || 0, 10);

    const timeSec = Math.floor(Date.UTC(year, month - 1, day, hours, minutes, seconds) / 1000);
    const open = parseFloat(row[oIdx]);
    const high = parseFloat(row[hIdx]);
    const low = parseFloat(row[lIdx]);
    const close = parseFloat(row[cIdx]);
    const volume = vIdx !== -1 ? parseFloat(row[vIdx]) : 0;

    if (!isNaN(timeSec) && !isNaN(open) && !isNaN(high) && !isNaN(low) && !isNaN(close)) {
      candles.push({ time: timeSec, open, high, low, close, volume: isNaN(volume) ? 0 : volume });
    }
  }

  // Filter beforeTime if specified
  if (beforeTime) {
    const filtered = candles.filter(c => c.time < beforeTime);
    if (filtered.length > maxCount) {
      return filtered.slice(filtered.length - maxCount);
    }
    return filtered;
  }

  // Return tail if maxCount exceeded
  if (candles.length > maxCount) {
    return candles.slice(candles.length - maxCount);
  }
  return candles;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const resolvedCsvPath = getResolvedCsvPath();

  // Helper for JSON response
  const sendJson = (statusCode, data) => {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(data));
  };

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

  // Route: Real-time Candles (Live MT5 Bridge -> CSV Fallback)
  if (url.pathname === '/api/candles') {
    const symbol = url.searchParams.get('symbol') || config.SYMBOL || 'XAU_USD';
    const timeframe = url.searchParams.get('timeframe') || config.TIMEFRAME || 'M5';
    const countParam = url.searchParams.get('count');
    const count = countParam ? parseInt(countParam, 10) : 2000;
    const beforeTime = url.searchParams.get('before_time') ? parseInt(url.searchParams.get('before_time'), 10) : null;
    const forceCsv = url.searchParams.get('force_csv') === '1';
    const requestedFormat = url.searchParams.get('format') || 'json';

    // 1. Try Python Bridge if not forced to CSV
    if (!forceCsv) {
      let bridgeEndpoint = `/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&count=${count}`;
      if (beforeTime) bridgeEndpoint += `&before_time=${beforeTime}`;

      const bridgeData = await fetchBridgeJson(bridgeEndpoint, 3500);
      if (bridgeData && Array.isArray(bridgeData) && bridgeData.length > 0) {
        sendJson(200, {
          source: 'live',
          symbol,
          timeframe,
          count: bridgeData.length,
          candles: bridgeData
        });
        return;
      }
    }

    // 2. Fallback to local CSV
    if (!fs.existsSync(resolvedCsvPath)) {
      sendJson(404, {
        error: `CSV file not found at: ${resolvedCsvPath}. MT5 bridge was also not reachable at ${BRIDGE_URL}.`
      });
      return;
    }

    try {
      const csvText = readCsvFile(resolvedCsvPath);
      if (requestedFormat === 'raw') {
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache'
        });
        res.end(csvText);
        return;
      }

      // If count was explicitly passed, respect it; otherwise load all available candles from CSV (up to 100,000)
      const maxCsvCount = countParam ? count : 100000;
      const parsedCandles = parseCsvToCandles(csvText, maxCsvCount, beforeTime);
      sendJson(200, {
        source: 'csv',
        symbol,
        timeframe,
        count: parsedCandles.length,
        csvPath: resolvedCsvPath,
        candles: parsedCandles
      });
    } catch (readErr) {
      sendJson(500, { error: `Error reading CSV file: ${readErr.message}` });
    }
    return;
  }

  // Route: System & Bot Status
  if (url.pathname === '/api/status') {
    const bridgeHealth = await fetchBridgeJson('/health', 1500);
    const tradeLogPath = getResolvedTradeLogPath();

    let lastLogTime = null;
    let logSummary = null;

    if (tradeLogPath && fs.existsSync(tradeLogPath)) {
      try {
        const rawContent = fs.readFileSync(tradeLogPath, 'utf8');
        if (tradeLogPath.endsWith('.json')) {
          const parsed = JSON.parse(rawContent);
          lastLogTime = parsed.meta?.generated_at || null;
          logSummary = parsed.summary || null;
        } else {
          // JSONL lines
          const lines = rawContent.trim().split('\n').filter(Boolean);
          if (lines.length > 0) {
            const lastEntry = JSON.parse(lines[lines.length - 1]);
            lastLogTime = lastEntry.timestamp || lastEntry.time || null;
          }
        }
      } catch (err) {
        // ignore parse error for status
      }
    }

    sendJson(200, {
      strategy_version: config.STRATEGY_VERSION || 'v2.4.5',
      ai_provider: config.AI_PROVIDER || 'gemini',
      ai_model: config.AI_PROVIDER === 'gemini' ? (config.GEMINI_MODEL || 'gemini-3.5-flash-lite') : (config.DASHSCOPE_MODEL || 'qwen-plus'),
      min_confidence: config.MIN_CONFIDENCE || 0.7,
      risk_per_trade: config.RISK_PER_TRADE || 0.015,
      symbol: config.SYMBOL || 'XAU_USD',
      timeframe: config.TIMEFRAME || 'M5',
      candle_count: config.CANDLE_COUNT || 300,
      indicators: {
        ma_type: config.MA_TYPE || 'EMA',
        ma_fast: config.MA_FAST_PERIOD || 9,
        ma_slow: config.MA_SLOW_PERIOD || 21,
        h1_ma_fast: config.H1_MA_FAST_PERIOD || 50,
        h1_ma_slow: config.H1_MA_SLOW_PERIOD || 200,
        rsi_period: config.RSI_PERIOD || 9,
        rsi_oversold: config.RSI_OVERSOLD || 35,
        rsi_overbought: config.RSI_OVERBOUGHT || 65,
        adx_period: config.ADX_PERIOD || 14,
        adx_threshold: config.ADX_THRESHOLD || 20,
        atr_period: config.ATR_PERIOD || 14
      },
      bridge: {
        url: BRIDGE_URL,
        connected: !!(bridgeHealth && bridgeHealth.connected),
        details: bridgeHealth || null
      },
      log: {
        active_path: config.TRADE_LOG_PATH,
        last_log_time: lastLogTime,
        summary: logSummary
      }
    });
    return;
  }

  // Route: Serve Config info for Chart UI
  if (url.pathname === '/api/config') {
    sendJson(200, {
      symbol: config.SYMBOL,
      timeframe: config.TIMEFRAME,
      csvPath: config.CSV_DATA_PATH,
      maType: config.MA_TYPE,
      maFast: config.MA_FAST_PERIOD,
      maSlow: config.MA_SLOW_PERIOD,
      h1MaFast: config.H1_MA_FAST_PERIOD,
      h1MaSlow: config.H1_MA_SLOW_PERIOD,
      rsiPeriod: config.RSI_PERIOD,
      rsiOversold: config.RSI_OVERSOLD,
      rsiOverbought: config.RSI_OVERBOUGHT,
      adxPeriod: config.ADX_PERIOD,
      adxThreshold: config.ADX_THRESHOLD,
      atrPeriod: config.ATR_PERIOD,
      tradeLogPath: config.TRADE_LOG_PATH,
      strategyVersion: config.STRATEGY_VERSION,
      aiProvider: config.AI_PROVIDER
    });
    return;
  }

  // Route: Serve Trade Log Data
  if (url.pathname === '/api/trades') {
    const fileParam = url.searchParams.get('file');
    let tradeLogPath = getResolvedTradeLogPath();

    if (fileParam) {
      const candidatePath = path.resolve(LOGS_DIR, path.basename(fileParam));
      if (fs.existsSync(candidatePath)) {
        tradeLogPath = candidatePath;
      }
    }

    if (!tradeLogPath || !fs.existsSync(tradeLogPath)) {
      sendJson(404, {
        error: `Trade log file not found at: ${tradeLogPath}.`
      });
      return;
    }

    try {
      const data = fs.readFileSync(tradeLogPath, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(data);
    } catch (readErr) {
      sendJson(500, { error: `Error reading trade log file: ${readErr.message}` });
    }
    return;
  }

  // Route: Serve Backtest Result & List
  if (url.pathname === '/api/backtest') {
    const fileParam = url.searchParams.get('file');
    let targetPath = path.resolve(process.cwd(), 'backtest_result.json');

    if (fileParam) {
      const candidate = path.resolve(LOGS_DIR, path.basename(fileParam));
      if (fs.existsSync(candidate)) targetPath = candidate;
    } else if (!fs.existsSync(targetPath)) {
      // Find latest backtest file in logs/
      if (fs.existsSync(LOGS_DIR)) {
        const files = fs.readdirSync(LOGS_DIR)
          .filter(f => f.startsWith('backtest_') && f.endsWith('.json'))
          .sort((a, b) => fs.statSync(path.join(LOGS_DIR, b)).mtimeMs - fs.statSync(path.join(LOGS_DIR, a)).mtimeMs);
        if (files.length > 0) {
          targetPath = path.join(LOGS_DIR, files[0]);
        }
      }
    }

    if (!fs.existsSync(targetPath)) {
      sendJson(404, { error: 'No backtest result file found.' });
      return;
    }

    try {
      const content = fs.readFileSync(targetPath, 'utf8');
      sendJson(200, JSON.parse(content));
    } catch (err) {
      sendJson(500, { error: `Failed to load backtest result: ${err.message}` });
    }
    return;
  }

  // Route: List Backtest Files
  if (url.pathname === '/api/backtest/list') {
    if (!fs.existsSync(LOGS_DIR)) {
      sendJson(200, []);
      return;
    }

    try {
      const files = fs.readdirSync(LOGS_DIR)
        .filter(f => f.startsWith('backtest_') && f.endsWith('.json'))
        .map(f => {
          const fullPath = path.join(LOGS_DIR, f);
          const stat = fs.statSync(fullPath);
          return {
            filename: f,
            size: stat.size,
            mtime: stat.mtime.toISOString(),
            isCurrent: config.TRADE_LOG_PATH && config.TRADE_LOG_PATH.includes(f)
          };
        })
        .sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());

      sendJson(200, files);
    } catch (err) {
      sendJson(500, { error: `Error listing backtest files: ${err.message}` });
    }
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
  console.log(`  📊 TradeBot Dashboard & Chart is running at: \x1b[36m${url}\x1b[0m`);
  console.log(`  🔗 Python Bridge URL: \x1b[35m${BRIDGE_URL}\x1b[0m`);
  console.log(`  📁 CSV fallback path: \x1b[33m${resolvedCsvPath}\x1b[0m`);
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
