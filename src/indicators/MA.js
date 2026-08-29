const { SMA, EMA } = require('technicalindicators');

/**
 * Calculate Simple Moving Average (SMA).
 * @param {number[]} closePrices - Array of close prices.
 * @param {number} period - MA period.
 * @returns {number[]} Array of calculated SMA values.
 */
function calculateSMA(closePrices, period) {
  if (!closePrices || closePrices.length < period) return [];
  return SMA.calculate({ period, values: closePrices });
}

/**
 * Calculate Exponential Moving Average (EMA).
 * @param {number[]} closePrices - Array of close prices.
 * @param {number} period - MA period.
 * @returns {number[]} Array of calculated EMA values.
 */
function calculateEMA(closePrices, period) {
  if (!closePrices || closePrices.length < period) return [];
  return EMA.calculate({ period, values: closePrices });
}

/**
 * Get the crossover signal based on the latest two points of short and long MAs.
 * @param {number} shortMAPrev - Previous value of the short MA.
 * @param {number} shortMACurr - Current value of the short MA.
 * @param {number} longMAPrev - Previous value of the long MA.
 * @param {number} longMACurr - Current value of the long MA.
 * @returns {string} 'bullish_cross', 'bearish_cross', or 'neutral'.
 */
function getCrossSignal(shortMAPrev, shortMACurr, longMAPrev, longMACurr) {
  if (shortMAPrev <= longMAPrev && shortMACurr > longMACurr) {
    return 'bullish_cross';
  }
  if (shortMAPrev >= longMAPrev && shortMACurr < longMACurr) {
    return 'bearish_cross';
  }
  return 'neutral';
}

module.exports = {
  calculateSMA,
  calculateEMA,
  getCrossSignal
};
