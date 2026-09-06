/**
 * Live Routes — MT5 live trading chart features.
 * Only relevant when MT5 Bridge is connected.
 * 
 * Routes:
 * - GET /api/live       → tick + forming candle + positions (polling)
 * - GET /api/stream     → SSE realtime stream (1s interval)
 * - GET /api/price      → proxy price from MT5 Bridge
 * - GET /api/positions  → proxy positions from MT5 Bridge
 */

const config = require('../../../src/config');
const { fetchBridgeJson } = require('../helpers/bridgeClient');
const { sanitizePositions } = require('../helpers/sanitize');

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
  // Route: Real-time Live Market Data (Tick + Forming Candle + Positions)
  router.add('GET', '/api/live', async (req, res, url) => {
    const symbol = url.searchParams.get('symbol') || config.SYMBOL || 'XAU_USD';
    const timeframe = url.searchParams.get('timeframe') || config.TIMEFRAME || 'M5';

    try {
      const [tickData, candleData, posData] = await Promise.all([
        fetchBridgeJson(`/price?symbol=${encodeURIComponent(symbol)}`, 1500),
        fetchBridgeJson(`/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&count=3`, 1500),
        fetchBridgeJson(`/positions?symbol=${encodeURIComponent(symbol)}`, 1500)
      ]);

      if (candleData && Array.isArray(candleData) && candleData.length > 0) {
        sendJson(res, 200, {
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
    sendJson(res, 200, {
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
  });

  // Route: Server-Sent Events (SSE) Real-time Stream
  router.add('GET', '/api/stream', async (req, res, url) => {
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
  });

  // Route: Proxy Price
  router.add('GET', '/api/price', async (req, res, url) => {
    const symbol = url.searchParams.get('symbol') || config.SYMBOL || 'XAU_USD';
    const priceData = await fetchBridgeJson(`/price?symbol=${encodeURIComponent(symbol)}`, 2000);
    if (priceData) {
      sendJson(res, 200, priceData);
    } else {
      sendJson(res, 503, { error: 'Price data currently unavailable from MT5 bridge.' });
    }
  });

  // Route: Proxy Positions
  router.add('GET', '/api/positions', async (req, res, url) => {
    const symbol = url.searchParams.get('symbol');
    const endpoint = symbol ? `/positions?symbol=${encodeURIComponent(symbol)}` : '/positions';
    const posData = await fetchBridgeJson(endpoint, 2000);
    sendJson(res, 200, sanitizePositions(posData));
  });
}

module.exports = { register };
