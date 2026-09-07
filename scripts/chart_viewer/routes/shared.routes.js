/**
 * Shared Routes — used by both Live and Backtest chart modes.
 * 
 * Routes:
 * - GET /              → serve index.html
 * - GET /api/candles   → Bridge -> CSV fallback
 * - GET /api/config    → strategy config for UI
 * - GET /api/status    → bot + bridge health
 */

const fs = require('fs');
const path = require('path');
const config = require('../../../src/config');
const { fetchBridgeJson, BRIDGE_URL } = require('../helpers/bridgeClient');
const { readCsvFile, parseCsvToCandles } = require('../helpers/csvParser');
const { sanitizeHealth } = require('../helpers/sanitize');

const HTML_FILE_PATH = path.join(__dirname, '../index.html');
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

// Helper for JSON response
const sendJson = (res, statusCode, data) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
};

function register(router) {
  // Route: Serve index.html
  router.add('GET', '/', async (req, res, url) => {
    if (!fs.existsSync(HTML_FILE_PATH)) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Error: index.html not found.');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(HTML_FILE_PATH).pipe(res);
  });
  
  router.add('GET', '/index.html', async (req, res, url) => {
    if (!fs.existsSync(HTML_FILE_PATH)) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Error: index.html not found.');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(HTML_FILE_PATH).pipe(res);
  });

  // Route: Real-time Candles (Live MT5 Bridge -> CSV Fallback)
  router.add('GET', '/api/candles', async (req, res, url) => {
    const symbol = url.searchParams.get('symbol') || config.SYMBOL || 'XAU_USD';
    const timeframe = url.searchParams.get('timeframe') || config.TIMEFRAME || 'M5';
    const countParam = url.searchParams.get('count');
    const count = countParam ? parseInt(countParam, 10) : 2000;
    const beforeTime = url.searchParams.get('before_time') ? parseInt(url.searchParams.get('before_time'), 10) : null;
    const forceCsv = url.searchParams.get('force_csv') === '1';
    const requestedFormat = url.searchParams.get('format') || 'json';

    const resolvedCsvPath = getResolvedCsvPath();

    // 1. Try Python Bridge if not forced to CSV
    if (!forceCsv) {
      let bridgeEndpoint = `/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&count=${count}`;
      if (beforeTime) bridgeEndpoint += `&before_time=${beforeTime}`;

      const bridgeData = await fetchBridgeJson(bridgeEndpoint, 3500);
      if (bridgeData && Array.isArray(bridgeData) && bridgeData.length > 0) {
        sendJson(res, 200, {
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
      sendJson(res, 404, {
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
      sendJson(res, 200, {
        source: 'csv',
        symbol,
        timeframe,
        count: parsedCandles.length,
        csvPath: resolvedCsvPath,
        candles: parsedCandles
      });
    } catch (readErr) {
      sendJson(res, 500, { error: `Error reading CSV file: ${readErr.message}` });
    }
  });

  // Route: System & Bot Status
  router.add('GET', '/api/status', async (req, res, url) => {
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

    sendJson(res, 200, {
      strategy_version: config.STRATEGY_VERSION || 'v2.4.5',
      ai_provider: config.AI_PROVIDER || 'gemini',
      ai_model: config.AI_PROVIDER === 'gemini' ? (config.GEMINI_MODEL || 'gemini-3.5-flash-lite') : (config.DASHSCOPE_MODEL || 'qwen-plus'),
      min_confidence: config.MIN_CONFIDENCE || 0.7,
      risk_per_trade: config.RISK_PER_TRADE || 0.015,
      symbol: config.SYMBOL || 'XAU_USD',
      timeframe: config.TIMEFRAME || 'M5',
      candle_count: config.CANDLE_COUNT || 300,
      indicators: {
        utbot1_key: config.UTBOT1_KEY || 2,
        utbot1_atr_period: config.UTBOT1_ATR_PERIOD || 1,
        utbot2_key: config.UTBOT2_KEY || 2,
        utbot2_atr_period: config.UTBOT2_ATR_PERIOD || 300,
        stc_length: config.STC_LENGTH || 60,
        stc_fast: config.STC_FAST_LENGTH || 35,
        stc_slow: config.STC_SLOW_LENGTH || 50,
        rsi_period: config.RSI_PERIOD || 14,
        ema_period: config.EMA_PERIOD || 200,
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
  });

  // Route: Serve Config info for Chart UI
  router.add('GET', '/api/config', async (req, res, url) => {
    sendJson(res, 200, {
      symbol: config.SYMBOL,
      timeframe: config.TIMEFRAME,
      csvPath: config.CSV_DATA_PATH,
      utbot1Key: config.UTBOT1_KEY,
      utbot1AtrPeriod: config.UTBOT1_ATR_PERIOD,
      utbot2Key: config.UTBOT2_KEY,
      utbot2AtrPeriod: config.UTBOT2_ATR_PERIOD,
      stcLength: config.STC_LENGTH,
      stcFastLength: config.STC_FAST_LENGTH,
      stcSlowLength: config.STC_SLOW_LENGTH,
      stcFactor: config.STC_FACTOR,
      stcGreenLine: config.STC_GREEN_LINE,
      stcRedLine: config.STC_RED_LINE,
      rsiPeriod: config.RSI_PERIOD,
      rsiOversold: config.RSI_OVERSOLD,
      rsiOverbought: config.RSI_OVERBOUGHT,
      emaPeriod: config.EMA_PERIOD,
      atrPeriod: config.ATR_PERIOD,
      tradeLogPath: config.TRADE_LOG_PATH,
      strategyVersion: config.STRATEGY_VERSION,
      aiProvider: config.AI_PROVIDER
    });
  });
}

module.exports = { register };
