const { calculateSMA, getCrossSignal } = require('../indicators/MA');
const { calculate: calculateRSI, getZone: getRSIZone } = require('../indicators/RSI');
const { calculate: calculateATR } = require('../indicators/ATR');

/**
 * Builds the context object containing technical indicators and recent candles for Gemini.
 * @param {Array} candles - Array of OHLCV candle objects (chronological order, oldest to newest)
 * @param {Object} config - Configuration object with strategy parameters
 * @returns {Object|null} The Gemini Context object or null if insufficient candles
 */
function buildContext(candles, config) {
  // We need enough candles to calculate the slowest MA
  const requiredCandles = Math.max(config.MA_SLOW_PERIOD, config.RSI_PERIOD, config.ATR_PERIOD);
  
  if (!candles || candles.length < requiredCandles) {
    return null;
  }

  // Extract arrays for technical indicator calculation
  const closePrices = candles.map(c => c.close);
  const highPrices = candles.map(c => c.high);
  const lowPrices = candles.map(c => c.low);

  // Calculate Moving Averages
  const maFast = calculateSMA(closePrices, config.MA_FAST_PERIOD);
  const maSlow = calculateSMA(closePrices, config.MA_SLOW_PERIOD);

  // Calculate RSI
  const rsiArray = calculateRSI(closePrices, config.RSI_PERIOD);

  // Calculate ATR
  const atrArray = calculateATR(highPrices, lowPrices, closePrices, config.ATR_PERIOD);

  // Get the latest values for indicators
  const latestMAFast = maFast[maFast.length - 1];
  const prevMAFast = maFast[maFast.length - 2];
  
  const latestMASlow = maSlow[maSlow.length - 1];
  const prevMASlow = maSlow[maSlow.length - 2];

  const latestRSI = rsiArray[rsiArray.length - 1];
  const latestATR = atrArray[atrArray.length - 1];

  // Calculate signals and zones
  const maCross = getCrossSignal(prevMAFast, latestMAFast, prevMASlow, latestMASlow);
  const rsiZone = getRSIZone(latestRSI, config.RSI_OVERSOLD, config.RSI_OVERBOUGHT);

  // Get the latest candle price for currentPrice
  const latestCandle = candles[candles.length - 1];

  // Get the 5 most recent candles for the context
  const recentCandles = candles.slice(-5);

  return {
    symbol: config.SYMBOL,
    timeframe: config.TIMEFRAME,
    currentPrice: latestCandle.close,
    indicators: {
      ma9: Number(latestMAFast.toFixed(2)),
      ma21: Number(latestMASlow.toFixed(2)),
      rsi: Number(latestRSI.toFixed(2)),
      atr: Number(latestATR.toFixed(2)),
      ma_cross: maCross,
      rsi_zone: rsiZone
    },
    recentCandles: recentCandles
  };
}

module.exports = {
  buildContext
};
