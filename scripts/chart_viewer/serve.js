const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const config = require('../../src/config');
const BacktestEngine = require('../../src/backtest/BacktestEngine');
const { buildContext } = require('../../src/bot/SignalBuilder');
const AIAgentFactory = require('../../src/ai/AIAgentFactory');

const PORT = process.env.CHART_PORT || config.CHART_PORT || 3400;
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
function parseCsvToCandles(csvText, maxCount = 5000, beforeTime = null) {
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

// Unified helper to load candles from MT5 Bridge or CSV fallback
async function loadCandlesHelper(symbol = 'XAU_USD', timeframe = 'M5', count = 5000, beforeTime = null) {
  // 1. Try bridge
  const bridgeCount = Math.min(count, 5000);
  let bridgeEndpoint = `/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&count=${bridgeCount}`;
  if (beforeTime) bridgeEndpoint += `&before_time=${beforeTime}`;

  const bridgeData = await fetchBridgeJson(bridgeEndpoint, 3500);
  if (bridgeData && Array.isArray(bridgeData) && bridgeData.length > 0) {
    return bridgeData;
  }

  // 2. Try CSV fallback
  const resolvedCsvPath = getResolvedCsvPath();
  if (fs.existsSync(resolvedCsvPath)) {
    const csvText = readCsvFile(resolvedCsvPath);
    return parseCsvToCandles(csvText, count, beforeTime);
  }

  return [];
}

// Helper to load combined full history: Live MT5 candles (up to 5000) + older CSV candles
async function loadAllHistoryAndLiveCandles(symbol = 'XAU_USD', timeframe = 'M5') {
  // 1. Try bridge for latest live candles (up to 5000)
  const bridgeEndpoint = `/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&count=5000`;
  const bridgeData = await fetchBridgeJson(bridgeEndpoint, 3500);

  const resolvedCsvPath = getResolvedCsvPath();
  let csvCandles = [];
  if (fs.existsSync(resolvedCsvPath)) {
    const csvText = readCsvFile(resolvedCsvPath);
    csvCandles = parseCsvToCandles(csvText, 100000);
  }

  if (bridgeData && Array.isArray(bridgeData) && bridgeData.length > 0) {
    const oldestBridgeTime = bridgeData[0].time;
    // Filter CSV candles that are older than oldest bridge candle
    const olderCsv = csvCandles.filter(c => c.time < oldestBridgeTime);
    const combined = [...olderCsv, ...bridgeData].sort((a, b) => a.time - b.time);
    return combined;
  }

  return csvCandles;
}

// Security: Sanitizers for public dashboard data
function sanitizePositions(posArray) {
  if (!posArray || !Array.isArray(posArray)) return [];
  return posArray.map(p => ({
    symbol: p.symbol,
    type: p.type,
    price_open: p.price_open,
    sl: p.sl,
    tp: p.tp,
    price_current: p.price_current,
    time: p.time
  }));
}

function sanitizeHealth(health) {
  if (!health) return null;
  const safeHealth = JSON.parse(JSON.stringify(health));
  if (safeHealth.account) {
    delete safeHealth.account.login;
    delete safeHealth.account.server;
    delete safeHealth.account.balance;
    delete safeHealth.account.equity;
    delete safeHealth.account.leverage;
  }
  return safeHealth;
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

  // Route: Real-time Live Market Data (Tick + Forming Candle + Positions)
  if (url.pathname === '/api/live') {
    const symbol = url.searchParams.get('symbol') || config.SYMBOL || 'XAU_USD';
    const timeframe = url.searchParams.get('timeframe') || config.TIMEFRAME || 'M5';

    try {
      const [tickData, candleData, posData] = await Promise.all([
        fetchBridgeJson(`/price?symbol=${encodeURIComponent(symbol)}`, 1500),
        fetchBridgeJson(`/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&count=3`, 1500),
        fetchBridgeJson(`/positions?symbol=${encodeURIComponent(symbol)}`, 1500)
      ]);

      if (candleData && Array.isArray(candleData) && candleData.length > 0) {
        sendJson(200, {
          ok: true,
          source: 'live',
          symbol,
          timeframe,
          time: Math.floor(Date.now() / 1000),
          tick: tickData || null,
          candles: candleData,
          latestCandle: candleData[candleData.length - 1],
          positions: sanitizePositions(posData)
        });
        return;
      }
    } catch (err) {
      // fallback below
    }

    // Fallback response if bridge unreachable
    sendJson(200, {
      ok: false,
      source: 'csv_fallback',
      symbol,
      timeframe,
      time: Math.floor(Date.now() / 1000),
      tick: null,
      candles: [],
      latestCandle: null,
      positions: []
    });
    return;
  }

  // Route: Server-Sent Events (SSE) Real-time Stream
  if (url.pathname === '/api/stream') {
    const symbol = url.searchParams.get('symbol') || config.SYMBOL || 'XAU_USD';
    const timeframe = url.searchParams.get('timeframe') || config.TIMEFRAME || 'M5';

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    res.write(`data: ${JSON.stringify({ type: 'connected', time: Math.floor(Date.now() / 1000) })}\n\n`);

    let isClosed = false;
    const streamInterval = setInterval(async () => {
      if (isClosed) return;
      try {
        const [tickData, candleData, posData] = await Promise.all([
          fetchBridgeJson(`/price?symbol=${encodeURIComponent(symbol)}`, 1200),
          fetchBridgeJson(`/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&count=2`, 1200),
          fetchBridgeJson(`/positions?symbol=${encodeURIComponent(symbol)}`, 1200)
        ]);

        if (candleData && Array.isArray(candleData) && candleData.length > 0) {
          const payload = {
            type: 'live',
            source: 'live',
            symbol,
            timeframe,
            time: Math.floor(Date.now() / 1000),
            tick: tickData || null,
            candles: candleData,
            latestCandle: candleData[candleData.length - 1],
            positions: sanitizePositions(posData)
          };
          if (!isClosed) {
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
          }
        }
      } catch (e) {
        // stream tick error, ignore and continue next interval
      }
    }, 1000);

    req.on('close', () => {
      isClosed = true;
      clearInterval(streamInterval);
    });
    return;
  }

  // Route: Proxy Price
  if (url.pathname === '/api/price') {
    const symbol = url.searchParams.get('symbol') || config.SYMBOL || 'XAU_USD';
    const priceData = await fetchBridgeJson(`/price?symbol=${encodeURIComponent(symbol)}`, 2000);
    if (priceData) {
      sendJson(200, priceData);
    } else {
      sendJson(503, { error: 'Price data currently unavailable from MT5 bridge.' });
    }
    return;
  }

  // Route: Proxy Positions
  if (url.pathname === '/api/positions') {
    const symbol = url.searchParams.get('symbol');
    const endpoint = symbol ? `/positions?symbol=${encodeURIComponent(symbol)}` : '/positions';
    const posData = await fetchBridgeJson(endpoint, 2000);
    sendJson(200, sanitizePositions(posData));
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
        details: sanitizeHealth(bridgeHealth)
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

  // Cache for full history signals
  let cachedSignals = null;
  let cachedSignalsTime = 0;

  // Route: Calculate Rule-Based Signals across history
  if (url.pathname === '/api/signals') {
    const symbol = url.searchParams.get('symbol') || config.SYMBOL || 'XAU_USD';
    const timeframe = url.searchParams.get('timeframe') || config.TIMEFRAME || 'M5';
    const forceRefresh = url.searchParams.get('refresh') === '1';

    const now = Date.now();
    if (!forceRefresh && cachedSignals && (now - cachedSignalsTime < 60000)) {
      sendJson(200, {
        ok: true,
        count: cachedSignals.length,
        signals: cachedSignals
      });
      return;
    }

    try {
      // Load all available history + live MT5 candles so H1 EMA200 warmup is fully satisfied
      const rawCandles = await loadAllHistoryAndLiveCandles(symbol, timeframe);
      if (!rawCandles || rawCandles.length < 50) {
        sendJson(200, { ok: true, count: 0, signals: [] });
        return;
      }

      // Format candle timestamps to ISO format for BacktestEngine
      const formattedCandles = rawCandles.map(c => ({
        ...c,
        time: typeof c.time === 'number' ? new Date(c.time * 1000).toISOString() : c.time
      }));

      const engine = new BacktestEngine({ candles: formattedCandles });
      const result = await engine.runRuleBased();

      // Transform result trades into signals array
      const signals = (result.trades || []).map((t, idx) => {
        const timeSec = typeof t.entryTime === 'number'
          ? (t.entryTime > 1e11 ? Math.floor(t.entryTime / 1000) : t.entryTime)
          : Math.floor(new Date(t.entryTime).getTime() / 1000);

        return {
          id: idx + 1,
          time: isNaN(timeSec) ? t.entryTime : timeSec,
          time_str: typeof t.entryTime === 'string' ? t.entryTime : new Date(timeSec * 1000).toISOString(),
          side: (t.side || 'BUY').toUpperCase(),
          entry_price: t.entryPrice,
          rule_based: {
            action: t.side,
            reason: t.exitReason ? `Rule exit: ${t.exitReason}` : 'Rule-based setup',
            sl: t.sl,
            tp: t.tp,
            outcome: t.outcome,
            exit_price: t.exitPrice,
            exit_time: t.exitTime
          },
          ai: null
        };
      });

      cachedSignals = signals;
      cachedSignalsTime = now;

      sendJson(200, {
        ok: true,
        count: signals.length,
        signals
      });
    } catch (err) {
      sendJson(500, { ok: false, error: `Failed to calculate rule signals: ${err.message}` });
    }
    return;
  }

  // Route: On-demand AI Advice Consultation for a specific signal/candle
  if (url.pathname === '/api/ai-advice') {
    const symbol = url.searchParams.get('symbol') || config.SYMBOL || 'XAU_USD';
    const timeframe = url.searchParams.get('timeframe') || config.TIMEFRAME || 'M5';
    const targetTimeParam = url.searchParams.get('time');

    if (!targetTimeParam) {
      sendJson(400, { ok: false, error: 'Query parameter "time" is required.' });
      return;
    }

    try {
      // Parse target timestamp
      let targetSec = null;
      if (!isNaN(Number(targetTimeParam))) {
        const num = Number(targetTimeParam);
        targetSec = num > 1e11 ? Math.floor(num / 1000) : num;
      } else {
        targetSec = Math.floor(new Date(targetTimeParam).getTime() / 1000);
      }

      const rawCandles = await loadCandlesHelper(symbol, timeframe, 10000);
      if (!rawCandles || rawCandles.length < 50) {
        sendJson(400, { ok: false, error: 'Insufficient candle data to analyze.' });
        return;
      }

      // Convert all raw candle times to seconds for comparison
      const candlesWithSec = rawCandles.map(c => {
        const s = typeof c.time === 'number'
          ? (c.time > 1e11 ? Math.floor(c.time / 1000) : c.time)
          : Math.floor(new Date(c.time).getTime() / 1000);
        return {
          ...c,
          _sec: s,
          time: new Date(s * 1000).toISOString()
        };
      });

      // Find index of target candle
      let targetIdx = candlesWithSec.findIndex(c => c._sec === targetSec);
      if (targetIdx === -1) {
        // Find closest candle before or equal to targetSec
        for (let i = candlesWithSec.length - 1; i >= 0; i--) {
          if (candlesWithSec[i]._sec <= targetSec) {
            targetIdx = i;
            break;
          }
        }
      }

      if (targetIdx < 25) {
        sendJson(400, { ok: false, error: 'Not enough historical candles preceding the selected signal time.' });
        return;
      }

      // Slice window of candles leading up to this candle (150 candles)
      const windowCandles = candlesWithSec.slice(Math.max(0, targetIdx - 150 + 1), targetIdx + 1);

      // Build context for AI
      const context = buildContext(windowCandles, config);
      if (!context) {
        sendJson(500, { ok: false, error: 'Failed to build strategy context for AI.' });
        return;
      }

      // Query AI Agent
      const aiAgent = AIAgentFactory.createAgent();
      const decision = await aiAgent.getDecision(context);

      sendJson(200, {
        ok: true,
        symbol,
        timeframe,
        targetTime: targetTimeParam,
        targetCandle: candlesWithSec[targetIdx],
        context: {
          currentPrice: context.currentPrice,
          indicators: context.indicators
        },
        decision: {
          action: decision.action,
          confidence: decision.confidence,
          accepted: (decision.action === 'buy' || decision.action === 'sell') && decision.confidence >= (config.MIN_CONFIDENCE || 0.7),
          reason: decision.reason || 'AI analysis completed.',
          sl_atr_multiplier: decision.sl_atr_multiplier,
          tp_atr_multiplier: decision.tp_atr_multiplier
        }
      });
    } catch (err) {
      sendJson(500, { ok: false, error: `AI analysis error: ${err.message}` });
    }
    return;
  }

  // 404 for other routes
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Error: Port ${PORT} is already in use by another process.`);
    console.error(`💡 Tip: Run 'taskkill /F /PID <PID>' or kill previous node instance.\n`);
    process.exit(1);
  } else {
    console.error('Server error:', err);
  }
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
