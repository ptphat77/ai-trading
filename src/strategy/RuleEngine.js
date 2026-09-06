/**
 * RuleEngine — Tier 1 rule-based signal evaluation.
 * Shared by TradingBot (live) and BacktestEngine (backtest).
 * 
 * Input: context object (from SignalBuilder.buildContext or BacktestEngine inline context)
 * Output: { action, confidence, sl_atr_multiplier, tp_atr_multiplier, reason }
 */

const { calculateDynamicSlTp } = require('./SlTpCalculator');

/**
 * Evaluate Tier 1 rule-based decision.
 * @param {Object} context - Market context 
 * @param {Object} config - Strategy config
 * @returns {{ action: 'buy'|'sell'|'skip', confidence: number, sl_atr_multiplier: number, tp_atr_multiplier: number, reason: string }}
 */
function evaluateRule(context, config) {
  const { indicators } = context;
  const rsi = indicators.rsi;
  const adx = indicators.adx ?? 0;
  const maCross = indicators.ma_cross;
  const h1Trend = indicators.h1_trend || 'neutral';

  const defaultSl = config.DEFAULT_SL_ATR_MULTIPLIER || 1.2;
  const defaultTp = config.DEFAULT_TP_ATR_MULTIPLIER || 1.8;
  const adxThreshold = config.ADX_THRESHOLD || 20;
  const rsiBuyMin = config.RSI_BUY_MIN || 40;
  const rsiBuyMax = config.RSI_BUY_MAX || 65;
  const rsiSellMin = config.RSI_SELL_MIN || 35;
  const rsiSellMax = config.RSI_SELL_MAX || 60;

  // Precondition: ADX > threshold
  if (adx <= adxThreshold) {
    return skip(`ADX (${adx}) <= threshold (${adxThreshold}) - market is sideway`, defaultSl, defaultTp);
  }

  const candleBody = indicators.candle_body;
  const wickRejection = indicators.candle_wick_rejection;
  const distanceToMa21Atr = indicators.distance_to_ma21_atr || 0;
  const bodyToAtrRatio = indicators.body_to_atr_ratio || 0;
  
  const isBullishCandle = candleBody === 'bullish' || wickRejection === 'bottom_wick';
  const isBearishCandle = candleBody === 'bearish' || wickRejection === 'top_wick';
  
  const notOverextended = distanceToMa21Atr <= (config.MAX_DISTANCE_TO_MA_ATR || 1.2);

  const isH1Uptrend = h1Trend === 'uptrend' || h1Trend === 'neutral_permissive'; // accommodate trading bot permissiveness
  const isH1Downtrend = h1Trend === 'downtrend' || h1Trend === 'neutral_permissive';

  // BUY Rule
  if (
    isH1Uptrend &&
    maCross === 'bullish_cross' &&
    rsi >= rsiBuyMin && rsi <= rsiBuyMax &&
    isBullishCandle &&
    notOverextended
  ) {
    const dynamic = calculateDynamicSlTp('buy', context, config, defaultSl, defaultTp);
    return {
      action: 'buy',
      confidence: 1.0,
      sl_atr_multiplier: dynamic.slMultiplier,
      tp_atr_multiplier: dynamic.tpMultiplier,
      reason: `Rule-based BUY: H1 Uptrend, EMA Cross, RSI (${rsi}) in [${rsiBuyMin}, ${rsiBuyMax}], ADX (${adx}) > ${adxThreshold} (RR: 1:${dynamic.rrRatio})`
    };
  }

  // SELL Rule
  if (
    isH1Downtrend &&
    maCross === 'bearish_cross' &&
    rsi >= rsiSellMin && rsi <= rsiSellMax &&
    isBearishCandle &&
    notOverextended
  ) {
    const dynamic = calculateDynamicSlTp('sell', context, config, defaultSl, defaultTp);
    return {
      action: 'sell',
      confidence: 1.0,
      sl_atr_multiplier: dynamic.slMultiplier,
      tp_atr_multiplier: dynamic.tpMultiplier,
      reason: `Rule-based SELL: H1 Downtrend, EMA Cross, RSI (${rsi}) in [${rsiSellMin}, ${rsiSellMax}], ADX (${adx}) > ${adxThreshold} (RR: 1:${dynamic.rrRatio})`
    };
  }

  // Fallback: Oversold/Overbought extreme cross
  const rsiOversold = config.RSI_OVERSOLD || 30;
  const rsiOverbought = config.RSI_OVERBOUGHT || 70;
  
  if (rsi < rsiOversold && maCross === 'bullish_cross') {
    return { 
      action: 'buy', 
      confidence: 1.0, 
      sl_atr_multiplier: defaultSl, 
      tp_atr_multiplier: defaultTp,
      reason: `Rule-based BUY: Oversold rebound RSI (${rsi}) and bullish EMA cross` 
    };
  }
  
  if (rsi > rsiOverbought && maCross === 'bearish_cross') {
    return { 
      action: 'sell', 
      confidence: 1.0, 
      sl_atr_multiplier: defaultSl, 
      tp_atr_multiplier: defaultTp,
      reason: `Rule-based SELL: Overbought reversal RSI (${rsi}) and bearish EMA cross` 
    };
  }

  return skip(`Rule-based: Setup condition not met`, defaultSl, defaultTp);
}

function skip(reason, defaultSl, defaultTp) {
  return { 
    action: 'skip', 
    confidence: 0.0, 
    sl_atr_multiplier: defaultSl, 
    tp_atr_multiplier: defaultTp, 
    reason 
  };
}

module.exports = { evaluateRule };
