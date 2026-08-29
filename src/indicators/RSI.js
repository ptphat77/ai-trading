const { RSI } = require('technicalindicators');

/**
 * Calculate Relative Strength Index (RSI).
 * @param {number[]} closePrices - Array of close prices.
 * @param {number} period - RSI period.
 * @returns {number[]} Array of calculated RSI values.
 */
function calculate(closePrices, period) {
  if (!closePrices || closePrices.length <= period) return [];
  return RSI.calculate({ period, values: closePrices });
}

/**
 * Get the RSI zone based on the value and thresholds.
 * @param {number} rsiValue - The calculated RSI value.
 * @param {number} oversoldThreshold - The oversold threshold (e.g. 30).
 * @param {number} overboughtThreshold - The overbought threshold (e.g. 70).
 * @returns {string} 'oversold', 'overbought', or 'neutral'.
 */
function getZone(rsiValue, oversoldThreshold = 30, overboughtThreshold = 70) {
  if (rsiValue < oversoldThreshold) return 'oversold';
  if (rsiValue > overboughtThreshold) return 'overbought';
  return 'neutral';
}

module.exports = {
  calculate,
  getZone
};
