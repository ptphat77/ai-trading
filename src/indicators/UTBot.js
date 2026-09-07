const { ATR } = require('technicalindicators');

/**
 * Calculate UT Bot Alerts (ATR Trailing Stop).
 * 
 * @param {number[]} highs - Array of high prices.
 * @param {number[]} lows - Array of low prices.
 * @param {number[]} closes - Array of close prices.
 * @param {number} key - Multiplier (e.g., 2)
 * @param {number} period - ATR period (e.g., 1 or 300)
 * @returns {{stopLine: (number|null)[], positions: (number|null)[], signals: (string|null)[]}}
 */
function calculate(highs, lows, closes, key, period) {
  if (closes.length <= period) return { stopLine: [], positions: [], signals: [] };
  
  const atr = ATR.calculate({ high: highs, low: lows, close: closes, period });
  
  // Align atr array
  const diff = closes.length - atr.length;
  const atrArr = Array(diff).fill(null).concat(atr);
  
  let prev_xATRTrailingStop = 0;
  const xATRTrailingStop = [];
  const positions = [];
  const signals = [];
  let prev_position = 0;
  
  for (let i = 0; i < closes.length; i++) {
    if (atrArr[i] === null) {
      xATRTrailingStop.push(null);
      positions.push(null);
      signals.push(null);
      continue;
    }
    
    const close = closes[i];
    const prev_close = i > 0 ? closes[i-1] : close;
    const currentAtr = atrArr[i];
    
    const loss = key * currentAtr;
    let trailingStop = prev_xATRTrailingStop;
    
    if (close > prev_xATRTrailingStop && prev_close > prev_xATRTrailingStop) {
      trailingStop = Math.max(prev_xATRTrailingStop, close - loss);
    } else if (close < prev_xATRTrailingStop && prev_close < prev_xATRTrailingStop) {
      trailingStop = Math.min(prev_xATRTrailingStop, close + loss);
    } else if (close > prev_xATRTrailingStop) {
      trailingStop = close - loss;
    } else {
      trailingStop = close + loss;
    }
    
    xATRTrailingStop.push(trailingStop);
    prev_xATRTrailingStop = trailingStop;
    
    let position = prev_position;
    if (close > trailingStop) position = 1; // Buy
    else if (close < trailingStop) position = -1; // Sell
    
    positions.push(position);
    
    // Determine Signal
    let signal = null;
    if (position === 1 && prev_position === -1) {
      signal = 'buy';
    } else if (position === -1 && prev_position === 1) {
      signal = 'sell';
    }
    signals.push(signal);
    
    prev_position = position;
  }
  
  return {
    stopLine: xATRTrailingStop,
    positions: positions,
    signals: signals
  };
}

module.exports = {
  calculate
};
