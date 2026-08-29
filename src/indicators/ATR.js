const { ATR } = require('technicalindicators');

/**
 * Calculate Average True Range (ATR).
 * @param {number[]} highs - Array of high prices.
 * @param {number[]} lows - Array of low prices.
 * @param {number[]} closes - Array of close prices.
 * @param {number} period - ATR period.
 * @returns {number[]} Array of calculated ATR values.
 */
function calculate(highs, lows, closes, period) {
  if (!highs || !lows || !closes || highs.length <= period) return [];
  return ATR.calculate({ high: highs, low: lows, close: closes, period });
}

module.exports = {
  calculate
};
