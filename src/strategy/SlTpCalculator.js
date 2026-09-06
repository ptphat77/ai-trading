/**
 * SlTpCalculator — Dynamic SL/TP based on market structure + ADX momentum.
 * Shared by RuleEngine (via evaluateRule) and directly by TradingBot/BacktestEngine.
 */

/**
 * Calculates dynamic SL and TP based on market structure (Swing High/Low) and ADX momentum.
 * Logic (from STRATEGY.md §2 Exit Rules):
 * - SL: behind local swing pivot + ATR buffer, bounded [MIN_SL_ATR, MAX_SL_ATR]
 * - TP: scaled by ADX momentum (ADX>=35 → 2.0, ADX>=25 → 1.75, default → 1.50)
 * 
 * @param {string} side - 'buy' or 'sell'
 * @param {Object} context - Market context
 * @param {Object} config - Strategy config
 * @param {number} defaultSl - Default SL multiplier
 * @param {number} defaultTp - Default TP multiplier
 * @returns {Object} { slDistance, tpDistance, slMultiplier, tpMultiplier, rrRatio }
 */
function calculateDynamicSlTp(side, context, config, defaultSl, defaultTp) {
  const currentPrice = context.currentPrice;
  const atr = context.indicators.atr || 1.0;
  const adx = context.indicators.adx || 20;
  const swingHigh = context.indicators.local_swing_high || context.indicators.recent_swing_high || currentPrice;
  const swingLow = context.indicators.local_swing_low || context.indicators.recent_swing_low || currentPrice;
  const bufferAtr = config.SL_ATR_BUFFER ?? 0.15;
  const minSlAtr = config.MIN_SL_ATR ?? 0.85;
  const maxSlAtr = config.MAX_SL_ATR ?? 1.15;

  let slDistance;
  if (side === 'buy') {
    const swingDist = currentPrice - swingLow;
    const rawSl = swingDist > 0 ? (swingDist + bufferAtr * atr) : (defaultSl * atr);
    slDistance = Math.min(Math.max(rawSl, minSlAtr * atr), maxSlAtr * atr);
  } else {
    const swingDist = swingHigh - currentPrice;
    const rawSl = swingDist > 0 ? (swingDist + bufferAtr * atr) : (defaultSl * atr);
    slDistance = Math.min(Math.max(rawSl, minSlAtr * atr), maxSlAtr * atr);
  }

  // Dynamic R:R ratio targeting high win-rate with positive expectancy
  let rrRatio = 1.50;
  if (adx >= 35) {
    rrRatio = 2.00;
  } else if (adx >= 25) {
    rrRatio = 1.75;
  }

  let tpDistance = slDistance * rrRatio;
  
  // Ensure strict minimum R:R of 1:1
  if (tpDistance < slDistance) {
    tpDistance = slDistance;
  }

  const slMultiplier = Number((slDistance / atr).toFixed(2));
  const tpMultiplier = Number((tpDistance / atr).toFixed(2));

  return {
    slDistance: Number(slDistance.toFixed(2)),
    tpDistance: Number(tpDistance.toFixed(2)),
    slMultiplier,
    tpMultiplier,
    rrRatio
  };
}

/**
 * Simple fixed SL/TP based on ATR multipliers (used as fallback when no swing data).
 */
function calculateFixedSlTp(side, entryPrice, atr, slMultiplier, tpMultiplier) {
  const slDistance = Number((slMultiplier * atr).toFixed(2));
  const tpDistance = Number((tpMultiplier * atr).toFixed(2));
  
  let sl, tp;
  if (side === 'buy') {
    sl = Number((entryPrice - slDistance).toFixed(2));
    tp = Number((entryPrice + tpDistance).toFixed(2));
  } else {
    sl = Number((entryPrice + slDistance).toFixed(2));
    tp = Number((entryPrice - tpDistance).toFixed(2));
  }
  
  return { sl, tp, slDistance, tpDistance };
}

module.exports = { calculateDynamicSlTp, calculateFixedSlTp };
