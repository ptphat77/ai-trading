const { calculate: calculateUTBot } = require('../indicators/UTBot');
const { calculate: calculateSTC } = require('../indicators/STC');
const { calculate: calculateATR } = require('../indicators/ATR');
const { calculate: calculateRSI } = require('../indicators/RSI');
const { calculateEMA } = require('../indicators/MA');

/**
 * Builds the context object containing technical indicators and recent candles for Gemini.
 * @param {Array} candles - Array of OHLCV candle objects (chronological order, oldest to newest)
 * @param {Object} config - Configuration object with strategy parameters
 * @returns {Object|null} The Gemini Context object or null if insufficient candles
 */
function buildContext(candles, config) {
  // We need enough candles to calculate STC (slowLength + length + length = ~210 candles)
  const requiredCandles = config.STC_SLOW_LENGTH || 50; 
  // Technically we need more for full STC warmup, but we will return nulls for STC if not enough
  
  if (!candles || candles.length < requiredCandles) {
    return null;
  }

  // Extract arrays for technical indicator calculation
  const closePrices = candles.map(c => c.close);
  const highPrices = candles.map(c => c.high);
  const lowPrices = candles.map(c => c.low);

  // Calculate UT Bot 1 (Sell Signals)
  const ut1Key = config.UTBOT1_KEY || 2;
  const ut1AtrPeriod = config.UTBOT1_ATR_PERIOD || 1;
  const utbot1 = calculateUTBot(highPrices, lowPrices, closePrices, ut1Key, ut1AtrPeriod);

  // Calculate UT Bot 2 (Buy Signals)
  const ut2Key = config.UTBOT2_KEY || 2;
  const ut2AtrPeriod = config.UTBOT2_ATR_PERIOD || 300;
  const utbot2 = calculateUTBot(highPrices, lowPrices, closePrices, ut2Key, ut2AtrPeriod);

  // Calculate STC
  const stcLength = config.STC_LENGTH || 80;
  const stcFast = config.STC_FAST_LENGTH || 27;
  const stcSlow = config.STC_SLOW_LENGTH || 50;
  const stcFactor = config.STC_FACTOR || 0.5;
  const stcArray = calculateSTC(closePrices, stcLength, stcFast, stcSlow, stcFactor);

  // Calculate ATR for generic SL buffering or position sizing (used in RiskManager/SlTpCalculator)
  const atrPeriod = config.ATR_PERIOD || 14;
  const atrArray = calculateATR(highPrices, lowPrices, closePrices, atrPeriod);

  // Calculate RSI for Tier 2 confirmation
  const rsiPeriod = config.RSI_PERIOD || 14;
  const rsiArray = calculateRSI(closePrices, rsiPeriod);

  // Calculate EMA for Tier 2 trend filter
  const emaPeriod = config.EMA_PERIOD || 200;
  const emaArray = calculateEMA(closePrices, emaPeriod);

  // Get the latest values
  const latestATR = atrArray.length > 0 ? atrArray[atrArray.length - 1] : 0;
  const latestRSI = rsiArray.length > 0 ? rsiArray[rsiArray.length - 1] : null;
  const latestEMA = emaArray.length > 0 ? emaArray[emaArray.length - 1] : null;
  
  const currentStc = stcArray.length > 0 ? stcArray[stcArray.length - 1] : null;
  const prevStc = stcArray.length > 1 ? stcArray[stcArray.length - 2] : null;

  const currentUt1Signal = utbot1.signals.length > 0 ? utbot1.signals[utbot1.signals.length - 1] : null;
  const currentUt2Signal = utbot2.signals.length > 0 ? utbot2.signals[utbot2.signals.length - 1] : null;

  // Get the latest candle
  const latestCandle = candles[candles.length - 1];

  // Wick rejection logic
  const totalRange = latestCandle.high - latestCandle.low;
  const bodySize = Math.abs(latestCandle.close - latestCandle.open);
  const upperWick = latestCandle.high - Math.max(latestCandle.open, latestCandle.close);
  const lowerWick = Math.min(latestCandle.open, latestCandle.close) - latestCandle.low;
  
  let candleWickRejection = 'none';
  if (totalRange > 0) {
    if (lowerWick > bodySize * 2 && lowerWick > upperWick) {
      candleWickRejection = 'bottom_wick';
    } else if (upperWick > bodySize * 2 && upperWick > lowerWick) {
      candleWickRejection = 'top_wick';
    }
  }

  const candleBodyDirection = latestCandle.close > latestCandle.open
    ? 'bullish'
    : (latestCandle.close < latestCandle.open ? 'bearish' : 'doji');
    
  const bodyToAtrRatio = latestATR > 0 ? Number((bodySize / latestATR).toFixed(2)) : 0;

  // Market Structure (last 50 candles) for Stop Loss
  const lookbackSR = 50;
  const recentSrCandles = candles.slice(-lookbackSR);
  const recentSwingHigh = recentSrCandles.length > 0 ? Math.max(...recentSrCandles.map(c => c.high)) : latestCandle.high;
  const recentSwingLow = recentSrCandles.length > 0 ? Math.min(...recentSrCandles.map(c => c.low)) : latestCandle.low;

  // Get the 5 most recent candles for context
  const recentCandles = candles.slice(-5);

  return {
    symbol: config.SYMBOL || 'XAU_USD',
    timeframe: config.TIMEFRAME || 'M5',
    currentPrice: latestCandle.close,
    indicators: {
      utbot1_signal: currentUt1Signal,
      utbot2_signal: currentUt2Signal,
      stc_current: currentStc !== null ? Number(currentStc.toFixed(2)) : null,
      stc_prev: prevStc !== null ? Number(prevStc.toFixed(2)) : null,
      atr: Number(latestATR.toFixed(2)),
      rsi_current: latestRSI !== null ? Number(latestRSI.toFixed(2)) : null,
      ema_trend: latestEMA !== null ? Number(latestEMA.toFixed(2)) : null,
      
      candle_body: candleBodyDirection,
      candle_wick_rejection: candleWickRejection,
      body_to_atr_ratio: bodyToAtrRatio,
      recent_swing_high: recentSwingHigh,
      recent_swing_low: recentSwingLow
    },
    recentCandles
  };
}

module.exports = {
  buildContext
};
