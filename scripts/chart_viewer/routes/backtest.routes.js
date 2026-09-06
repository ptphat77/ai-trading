/**
 * Backtest Routes — historical analysis and trade log features.
 * Does NOT call MT5 Bridge (uses CSV + local files only).
 * 
 * Routes:
 * - GET /api/trades         → read trade log file (JSONL or JSON)
 * - GET /api/backtest       → read backtest result JSON
 * - GET /api/backtest/list  → list backtest result files in logs/
 * - GET /api/signals        → run BacktestEngine.runRuleBased() → signal markers
 * - GET /api/ai-advice      → on-demand AI consultation for a signal
 */

const fs = require('fs');
const path = require('path');
const config = require('../../../src/config');
const BacktestEngine = require('../../../src/backtest/BacktestEngine');
const { buildContext } = require('../../../src/bot/SignalBuilder');
const AIAgentFactory = require('../../../src/ai/AIAgentFactory');
const { fetchBridgeJson } = require('../helpers/bridgeClient');
const { readCsvFile, parseCsvToCandles } = require('../helpers/csvParser');

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
  // Route: Serve Trade Log Data
  router.add('GET', '/api/trades', async (req, res, url) => {
    const fileParam = url.searchParams.get('file');
    let tradeLogPath = getResolvedTradeLogPath();

    if (fileParam) {
      const candidatePath = path.resolve(LOGS_DIR, path.basename(fileParam));
      if (fs.existsSync(candidatePath)) {
        tradeLogPath = candidatePath;
      }
    }

    if (!tradeLogPath || !fs.existsSync(tradeLogPath)) {
      sendJson(res, 404, {
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
      sendJson(res, 500, { error: `Error reading trade log file: ${readErr.message}` });
    }
  });

  // Route: Serve Backtest Result & List
  router.add('GET', '/api/backtest', async (req, res, url) => {
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
      sendJson(res, 404, { error: 'No backtest result file found.' });
      return;
    }

    try {
      const content = fs.readFileSync(targetPath, 'utf8');
      sendJson(res, 200, JSON.parse(content));
    } catch (err) {
      sendJson(res, 500, { error: `Failed to load backtest result: ${err.message}` });
    }
  });

  // Route: List Backtest Files
  router.add('GET', '/api/backtest/list', async (req, res, url) => {
    if (!fs.existsSync(LOGS_DIR)) {
      sendJson(res, 200, []);
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

      sendJson(res, 200, files);
    } catch (err) {
      sendJson(res, 500, { error: `Error listing backtest files: ${err.message}` });
    }
  });

  // Cache for full history signals
  let cachedSignals = null;
  let cachedSignalsTime = 0;

  // Route: Calculate Rule-Based Signals across history
  router.add('GET', '/api/signals', async (req, res, url) => {
    const symbol = url.searchParams.get('symbol') || config.SYMBOL || 'XAU_USD';
    const timeframe = url.searchParams.get('timeframe') || config.TIMEFRAME || 'M5';
    const forceRefresh = url.searchParams.get('refresh') === '1';

    const now = Date.now();
    if (!forceRefresh && cachedSignals && (now - cachedSignalsTime < 60000)) {
      sendJson(res, 200, {
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
        sendJson(res, 200, { ok: true, count: 0, signals: [] });
        return;
      }

      // Format candle timestamps to ISO format for BacktestEngine
      const formattedCandles = rawCandles.map(c => ({
        ...c,
        time: typeof c.time === 'number' ? new Date(c.time * 1000).toISOString() : c.time
      }));

      const engine = new BacktestEngine({ candles: formattedCandles });
      const result = await engine.runRuleBased();

      const allTrades = [...(result.trades || [])];
      if (result.openPosition) {
        // Enrich with AI data if the origin log exists, so UI shows the AI tooltip
        let aiData = null;
        if (result.openPosition.logIdx !== undefined && result.logs && result.logs[result.openPosition.logIdx]) {
          aiData = result.logs[result.openPosition.logIdx].gemini_raw_response;
        }

        allTrades.push({
          id: `trade_${allTrades.length + 1}`,
          symbol: result.openPosition.symbol,
          side: result.openPosition.side,
          entryTime: result.openPosition.entryTime,
          entryPrice: result.openPosition.entryPrice,
          exitTime: null,
          exitPrice: null,
          exitReason: null,
          sl: result.openPosition.sl,
          tp: result.openPosition.tp,
          units: result.openPosition.units,
          outcome: 'open',
          ai: aiData
        });
      }

      // Transform result trades into signals array
      const signals = allTrades.map((t, idx) => {
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
          ai: t.ai || null
        };
      });

      cachedSignals = signals;
      cachedSignalsTime = now;

      sendJson(res, 200, {
        ok: true,
        count: signals.length,
        signals
      });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: `Failed to calculate rule signals: ${err.message}` });
    }
  });

  // Route: On-demand AI Advice Consultation for a specific signal/candle
  router.add('GET', '/api/ai-advice', async (req, res, url) => {
    const symbol = url.searchParams.get('symbol') || config.SYMBOL || 'XAU_USD';
    const timeframe = url.searchParams.get('timeframe') || config.TIMEFRAME || 'M5';
    const targetTimeParam = url.searchParams.get('time');

    if (!targetTimeParam) {
      sendJson(res, 400, { ok: false, error: 'Query parameter "time" is required.' });
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
        sendJson(res, 400, { ok: false, error: 'Insufficient candle data to analyze.' });
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
        sendJson(res, 400, { ok: false, error: 'Not enough historical candles preceding the selected signal time.' });
        return;
      }

      // Slice window of candles leading up to this candle (150 candles)
      const windowCandles = candlesWithSec.slice(Math.max(0, targetIdx - 150 + 1), targetIdx + 1);

      // Build context for AI
      const context = buildContext(windowCandles, config);
      if (!context) {
        sendJson(res, 500, { ok: false, error: 'Failed to build strategy context for AI.' });
        return;
      }

      // Query AI Agent
      const aiAgent = AIAgentFactory.createAgent();
      const decision = await aiAgent.getDecision(context);

      sendJson(res, 200, {
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
          reasoning: decision.reasoning
        }
      });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: `Failed to consult AI: ${err.message}` });
    }
  });
}

module.exports = { register };
