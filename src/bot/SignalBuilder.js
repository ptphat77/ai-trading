const { calculateSMA, calculateEMA, getCrossSignal } = require('../indicators/MA');
const { calculate: calculateRSI, getZone: getRSIZone } = require('../indicators/RSI');
const { calculate: calculateATR } = require('../indicators/ATR');
const { calculate: calculateADX } = require('../indicators/ADX');
const { resampleToH1, evaluateH1Trend } = require('../utils/resample');

/**
 * Builds the context object containing technical indicators and recent candles for Gemini.
 * @param {Array} candles - Array of OHLCV candle objects (chronological order, oldest to newest)
 * @param {Object} config - Configuration object with strategy parameters
 * @param {Array} [h1Candles=null] - Optional precomputed H1 candles
 * @returns {Object|null} The Gemini Context object or null if insufficient candles
 */
function buildContext(candles, config, h1Candles = null) {
  // We need enough candles to calculate indicators
  const requiredCandles = Math.max(
    config.MA_SLOW_PERIOD || 21,
    config.RSI_PERIOD || 9,
    config.ATR_PERIOD || 14
  );
  
  if (!candles || candles.length < requiredCandles) {
    return null;
  }

  // Extract arrays for technical indicator calculation
  const closePrices = candles.map(c => c.close);
  const highPrices = candles.map(c => c.high);
  const lowPrices = candles.map(c => c.low);

  // Calculate Moving Averages (EMA or SMA based on config)
  const isEMA = (config.MA_TYPE || 'EMA').toUpperCase() === 'EMA';
  const maFastPeriod = config.MA_FAST_PERIOD || 9;
  const maSlowPeriod = config.MA_SLOW_PERIOD || 21;

  const maFast = isEMA
    ? calculateEMA(closePrices, maFastPeriod)
    : calculateSMA(closePrices, maFastPeriod);
  const maSlow = isEMA
    ? calculateEMA(closePrices, maSlowPeriod)
    : calculateSMA(closePrices, maSlowPeriod);

  // Calculate RSI
  const rsiPeriod = config.RSI_PERIOD || 9;
  const rsiArray = calculateRSI(closePrices, rsiPeriod);

  // Calculate ATR
  const atrPeriod = config.ATR_PERIOD || 14;
  const atrArray = calculateATR(highPrices, lowPrices, closePrices, atrPeriod);

  // Calculate ADX
  const adxPeriod = config.ADX_PERIOD || 14;
  const adxArray = calculateADX(highPrices, lowPrices, closePrices, adxPeriod);

  // Get the latest values for indicators
  const latestMAFast = maFast.length > 0 ? maFast[maFast.length - 1] : 0;
  const prevMAFast = maFast.length > 1 ? maFast[maFast.length - 2] : latestMAFast;
  
  const latestMASlow = maSlow.length > 0 ? maSlow[maSlow.length - 1] : 0;
  const prevMASlow = maSlow.length > 1 ? maSlow[maSlow.length - 2] : latestMASlow;

  const latestRSI = rsiArray.length > 0 ? rsiArray[rsiArray.length - 1] : 50;
  const latestATR = atrArray.length > 0 ? atrArray[atrArray.length - 1] : 0;
  const latestADXObj = adxArray.length > 0 ? adxArray[adxArray.length - 1] : null;
  const latestADX = latestADXObj ? Number(latestADXObj.adx.toFixed(2)) : 0;

  // Calculate signals and zones
  const maCross = getCrossSignal(prevMAFast, latestMAFast, prevMASlow, latestMASlow);
  const rsiZone = getRSIZone(latestRSI, config.RSI_OVERSOLD || 35, config.RSI_OVERBOUGHT || 65);

  // Lookback for RSI extreme touches in recent candles
  const lookbackWindow = config.RSI_LOOKBACK_CANDLES || 18;
  const recentRsiArray = rsiArray.slice(-lookbackWindow);
  const rsiTouchedOversold = recentRsiArray.some(rsi => rsi <= (config.RSI_OVERSOLD || 35));
  const rsiTouchedOverbought = recentRsiArray.some(rsi => rsi >= (config.RSI_OVERBOUGHT || 65));

  // Get the latest candle price for currentPrice
  const latestCandle = candles[candles.length - 1];
  const candleCloseVsMaSlow = latestCandle.close > latestMASlow
    ? 'above'
    : (latestCandle.close < latestMASlow ? 'below' : 'equal');

  const candleBodyDirection = latestCandle.close > latestCandle.open
    ? 'bullish'
    : (latestCandle.close < latestCandle.open ? 'bearish' : 'doji');

  const totalRange = latestCandle.high - latestCandle.low;
  const bodySize = Math.abs(latestCandle.close - latestCandle.open);
  const upperWick = latestCandle.high - Math.max(latestCandle.open, latestCandle.close);
  const lowerWick = Math.min(latestCandle.open, latestCandle.close) - latestCandle.low;
  
  // Wick rejection logic (only if wick is > 2x body)
  let candleWickRejection = 'none';
  if (totalRange > 0) {
    if (lowerWick > bodySize * 2 && lowerWick > upperWick) {
      candleWickRejection = 'bottom_wick';
    } else if (upperWick > bodySize * 2 && upperWick > lowerWick) {
      candleWickRejection = 'top_wick';
    }
  }

  // Momentum metrics
  const bodyToAtrRatio = latestATR > 0 ? Number((bodySize / latestATR).toFixed(2)) : 0;
  const distanceToMa21 = Math.abs(latestCandle.close - latestMASlow);
  const distanceToMa21Atr = latestATR > 0 ? Number((distanceToMa21 / latestATR).toFixed(2)) : 0;

  // Market Structure (last 50 candles)
  const lookbackSR = 50;
  const recentSrCandles = candles.slice(-lookbackSR);
  const recentSwingHigh = recentSrCandles.length > 0 ? Math.max(...recentSrCandles.map(c => c.high)) : latestCandle.high;
  const recentSwingLow = recentSrCandles.length > 0 ? Math.min(...recentSrCandles.map(c => c.low)) : latestCandle.low;

  // Evaluate H1 trend
  const h1Data = h1Candles || resampleToH1(candles);
  const h1TrendInfo = evaluateH1Trend(
    h1Data,
    latestCandle.close,
    config.H1_MA_FAST_PERIOD || 50,
    config.H1_MA_SLOW_PERIOD || 200
  );

  // Get the 5 most recent candles for context
  const recentCandles = candles.slice(-5);

  return {
    symbol: config.SYMBOL || 'XAU_USD',
    timeframe: config.TIMEFRAME || 'M5',
    currentPrice: latestCandle.close,
    indicators: {
      ma_fast: Number(latestMAFast.toFixed(2)),
      ma_slow: Number(latestMASlow.toFixed(2)),
      ma9: Number(latestMAFast.toFixed(2)),
      ma21: Number(latestMASlow.toFixed(2)),
      rsi: Number(latestRSI.toFixed(2)),
      adx: latestADX,
      adx_trending: latestADX > (config.ADX_THRESHOLD || 20),
      atr: Number(latestATR.toFixed(2)),
      ma_cross: maCross,
      rsi_zone: rsiZone,
      rsi_touched_oversold: rsiTouchedOversold,
      rsi_touched_overbought: rsiTouchedOverbought,
      candle_close_vs_ma21: candleCloseVsMaSlow,
      candle_close_vs_ma_slow: candleCloseVsMaSlow,
      candle_body: candleBodyDirection,
      candle_wick_rejection: candleWickRejection,
      body_to_atr_ratio: bodyToAtrRatio,
      distance_to_ma21_atr: distanceToMa21Atr,
      recent_swing_high: recentSwingHigh,
      recent_swing_low: recentSwingLow,
      h1_trend: h1TrendInfo.trend,
      h1_ema50: h1TrendInfo.emaFast,
      h1_ema200: h1TrendInfo.emaSlow
    },
    recentCandles
  };
}

module.exports = {
  buildContext
};
