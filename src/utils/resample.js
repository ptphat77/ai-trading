const { calculateEMA } = require('../indicators/MA');

/**
 * Resamples an array of M5 (or any sub-hour) candles into H1 candles.
 * @param {Array<{time: string, open: number, high: number, low: number, close: number, volume: number}>} candles
 * @returns {Array<{time: string, open: number, high: number, low: number, close: number, volume: number}>}
 */
function resampleToH1(candles) {
  if (!candles || candles.length === 0) return [];

  const h1Map = new Map();

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const dt = new Date(c.time);
    if (isNaN(dt.getTime())) continue;

    // Truncate to hour bucket (UTC)
    const hourKey = new Date(Date.UTC(
      dt.getUTCFullYear(),
      dt.getUTCMonth(),
      dt.getUTCDate(),
      dt.getUTCHours(),
      0,
      0,
      0
    )).toISOString();

    if (!h1Map.has(hourKey)) {
      h1Map.set(hourKey, {
        time: hourKey,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume || 0,
        m5Count: 1
      });
    } else {
      const bucket = h1Map.get(hourKey);
      bucket.high = Math.max(bucket.high, c.high);
      bucket.low = Math.min(bucket.low, c.low);
      bucket.close = c.close; // latest close
      bucket.volume += (c.volume || 0);
      bucket.m5Count += 1;
    }
  }

  const result = Array.from(h1Map.values());
  result.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  return result;
}

/**
 * Evaluates H1 trend based on EMA50 and EMA200.
 *
 * Trend Rules (chien-luoc-ema-rsi-m5-bot.md §2):
 * - Uptrend:   currentPrice > EMA200 AND EMA50 > EMA200
 * - Downtrend: currentPrice < EMA200 AND EMA50 < EMA200
 * - Neutral:   otherwise
 *
 * @param {Array<Object>} h1Candles - Array of H1 candles
 * @param {number} currentPrice - Current market price (from M5 candle)
 * @param {number} [fastPeriod=50] - Fast EMA period on H1
 * @param {number} [slowPeriod=200] - Slow EMA period on H1
 * @returns {{trend: 'uptrend'|'downtrend'|'neutral', emaFast: number|null, emaSlow: number|null}}
 */
function evaluateH1Trend(h1Candles, currentPrice, fastPeriod = 50, slowPeriod = 200) {
  if (!h1Candles || h1Candles.length < slowPeriod) {
    return {
      trend: 'neutral',
      emaFast: null,
      emaSlow: null
    };
  }

  const closes = h1Candles.map(c => c.close);
  const emaFastArray = calculateEMA(closes, fastPeriod);
  const emaSlowArray = calculateEMA(closes, slowPeriod);

  if (emaFastArray.length === 0 || emaSlowArray.length === 0) {
    return {
      trend: 'neutral',
      emaFast: null,
      emaSlow: null
    };
  }

  const latestEmaFast = emaFastArray[emaFastArray.length - 1];
  const latestEmaSlow = emaSlowArray[emaSlowArray.length - 1];

  let trend = 'neutral';
  if (currentPrice > latestEmaSlow && latestEmaFast > latestEmaSlow) {
    trend = 'uptrend';
  } else if (currentPrice < latestEmaSlow && latestEmaFast < latestEmaSlow) {
    trend = 'downtrend';
  }

  return {
    trend,
    emaFast: Number(latestEmaFast.toFixed(2)),
    emaSlow: Number(latestEmaSlow.toFixed(2))
  };
}

module.exports = {
  resampleToH1,
  evaluateH1Trend
};
