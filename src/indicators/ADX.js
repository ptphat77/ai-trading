const { ADX } = require('technicalindicators');

/**
 * Calculate Average Directional Index (ADX).
 * @param {number[]} highs - Array of high prices.
 * @param {number[]} lows - Array of low prices.
 * @param {number[]} closes - Array of close prices.
 * @param {number} period - ADX period (default 14).
 * @returns {Array<{adx: number, pdi: number, mdi: number}>} Array of calculated ADX objects.
 */
function calculate(highs, lows, closes, period = 14) {
  if (!highs || !lows || !closes || highs.length <= period * 2) {
    return [];
  }
  return ADX.calculate({
    high: highs,
    low: lows,
    close: closes,
    period
  });
}

/**
 * Helper to get only the numeric ADX values.
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number[]} closes
 * @param {number} period
 * @returns {number[]} Array of ADX value numbers.
 */
function calculateValues(highs, lows, closes, period = 14) {
  const result = calculate(highs, lows, closes, period);
  return result.map(item => item.adx);
}

module.exports = {
  calculate,
  calculateValues
};
