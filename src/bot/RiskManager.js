/**
 * Calculates the number of units to trade based on risk parameters.
 * Assumes the risk amount is proportional to the SL distance multiplied by units.
 * For standard micro-lots, we round down to the nearest integer.
 * 
 * @param {number} balance - Current account balance
 * @param {number} riskPercent - Risk percentage (e.g., 0.01 for 1%)
 * @param {number} slDistance - Absolute distance between entry price and stop loss price
 * @returns {number} The calculated number of units
 */
function calculateUnits(balance, riskPercent, slDistance) {
  if (balance <= 0 || riskPercent <= 0 || slDistance <= 0) {
    return 0;
  }

  const riskAmount = balance * riskPercent;
  const units = riskAmount / slDistance;

  // Round down to the nearest integer to ensure we do not exceed the max risk
  return Math.floor(units);
}

module.exports = {
  calculateUnits
};
