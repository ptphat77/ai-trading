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
  
  const stcCurrent = indicators.stc_current;
  const stcPrev = indicators.stc_prev;
  const utbot1Signal = indicators.utbot1_signal;
  const utbot2Signal = indicators.utbot2_signal;
  
  const stcGreenLine = config.STC_GREEN_LINE || 20;
  const stcRedLine = config.STC_RED_LINE || 80;
  // Tier 2 zone (relaxed boundary, requires RSI confirmation)
  const stcTier2GreenLine = config.STC_TIER2_GREEN_LINE || 25;
  const stcTier2RedLine = config.STC_TIER2_RED_LINE || 75;
  const rsiOversold = config.RSI_OVERSOLD || 40;
  const rsiOverbought = config.RSI_OVERBOUGHT || 60;

  // We are using a fixed 1:2 R:R as requested by the strategy
  const defaultSl = 1.0; // The actual SL distance is derived from swing structure in SlTpCalculator, this is a fallback multiplier
  const defaultTp = 2.0;

  if (stcCurrent === null || stcPrev === null) {
    return skip('STC is warming up (not enough candles)', defaultSl, defaultTp);
  }

  // BUY Rule: 
  // 1. UT Bot 2 (Buy signals) issues 'buy'
  // 2. STC is below green line
  // 3. STC is moving up
  const isStcBelowGreen = stcCurrent < stcGreenLine;
  const isStcMovingUp = stcCurrent > stcPrev;
  
  if (utbot2Signal === 'buy' && isStcBelowGreen && isStcMovingUp) {
    // calculateDynamicSlTp handles dynamic swing low + R:R calculation
    const dynamic = calculateDynamicSlTp('buy', context, config, defaultSl, defaultTp);
    return {
      action: 'buy',
      confidence: 1.0,
      sl_atr_multiplier: dynamic.slMultiplier,
      tp_atr_multiplier: dynamic.tpMultiplier,
      reason: `Rule-based BUY: UT Bot 2 Buy Signal + STC (${stcCurrent}) < ${stcGreenLine} and moving up. (RR: 1:${dynamic.rrRatio})`
    };
  }

  // SELL Rule:
  // 1. UT Bot 1 (Sell signals) issues 'sell'
  // 2. STC is above red line
  // 3. STC is moving down
  const isStcAboveRed = stcCurrent > stcRedLine;
  const isStcMovingDown = stcCurrent < stcPrev;
  
  if (utbot1Signal === 'sell' && isStcAboveRed && isStcMovingDown) {
    const dynamic = calculateDynamicSlTp('sell', context, config, defaultSl, defaultTp);
    return {
      action: 'sell',
      confidence: 1.0,
      sl_atr_multiplier: dynamic.slMultiplier,
      tp_atr_multiplier: dynamic.tpMultiplier,
      reason: `Rule-based SELL: UT Bot 1 Sell Signal + STC (${stcCurrent}) > ${stcRedLine} and moving down. (RR: 1:${dynamic.rrRatio})`
    };
  }

  // --- TIER 2: Mean Reversion with Macro Trend Filter (EMA 200 + STC + RSI) ---
  // Overcomes UTBot lagging issue by using EMA 200 for trend direction,
  // catching STC exhaustions in the direction of the trend, confirmed by RSI.
  const rsi = indicators.rsi_current ?? null;
  const emaTrend = indicators.ema_trend ?? null;
  const currentPrice = context.currentPrice;

  const isUptrend = emaTrend !== null && currentPrice > emaTrend;
  const isRsiOversold = rsi !== null && rsi < rsiOversold;

  if (isUptrend && isStcBelowGreen && isStcMovingUp && isRsiOversold) {
    const dynamic = calculateDynamicSlTp('buy', context, config, defaultSl, defaultTp);
    return {
      action: 'buy',
      confidence: 0.85,
      sl_atr_multiplier: dynamic.slMultiplier,
      tp_atr_multiplier: dynamic.tpMultiplier,
      reason: `Tier2 BUY: Price > EMA200 + STC (${stcCurrent}) < ${stcGreenLine} rising + RSI (${rsi?.toFixed(1)}) < ${rsiOversold}. (RR: 1:${dynamic.rrRatio})`
    };
  }

  const isDowntrend = emaTrend !== null && currentPrice < emaTrend;
  const isRsiOverbought = rsi !== null && rsi > rsiOverbought;

  if (isDowntrend && isStcAboveRed && isStcMovingDown && isRsiOverbought) {
    const dynamic = calculateDynamicSlTp('sell', context, config, defaultSl, defaultTp);
    return {
      action: 'sell',
      confidence: 0.85,
      sl_atr_multiplier: dynamic.slMultiplier,
      tp_atr_multiplier: dynamic.tpMultiplier,
      reason: `Tier2 SELL: Price < EMA200 + STC (${stcCurrent}) > ${stcRedLine} falling + RSI (${rsi?.toFixed(1)}) > ${rsiOverbought}. (RR: 1:${dynamic.rrRatio})`
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
