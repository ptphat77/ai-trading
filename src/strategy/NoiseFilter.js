/**
 * NoiseFilter — Trade frequency filters.
 * Prevents overtrading and gives cooldown after consecutive losses.
 * 
 * Applied in BacktestEngine during simulation. 
 * Can optionally be applied in TradingBot (currently not implemented).
 */

/**
 * @param {Object} state - { dailyTradesCount, consecutiveLosses, lastLossTime }
 * @param {string} candleDateStr - 'YYYY-MM-DD'
 * @param {number} currentCandleMs - timestamp in ms
 * @param {Object} config - { MAX_TRADES_PER_DAY, CONSECUTIVE_LOSS_COOLDOWN_HOURS }
 * @returns {{ blocked: boolean, reason: string }}
 */
function checkNoiseFilters(state, candleDateStr, currentCandleMs, config) {
  const maxTradesPerDay = config.MAX_TRADES_PER_DAY || 5;
  const cooldownHours = config.CONSECUTIVE_LOSS_COOLDOWN_HOURS || 2;

  const todayTrades = state.dailyTradesCount.get(candleDateStr) || 0;
  
  if (todayTrades >= maxTradesPerDay) {
    return {
      blocked: true,
      reason: `Max daily trades reached (${todayTrades}/${maxTradesPerDay})`
    };
  }

  if (
    state.consecutiveLosses >= 2 &&
    state.lastLossTime &&
    currentCandleMs - state.lastLossTime < cooldownHours * 60 * 60 * 1000
  ) {
    return {
      blocked: true,
      reason: `Cooldown active after ${state.consecutiveLosses} consecutive losses (${cooldownHours}h)`
    };
  } else if (
    state.lastLossTime &&
    currentCandleMs - state.lastLossTime >= cooldownHours * 60 * 60 * 1000
  ) {
    // Cooldown expired
    state.consecutiveLosses = 0;
    state.lastLossTime = null;
  }

  return { blocked: false, reason: '' };
}

/**
 * Update filter state after a trade closes.
 * @param {Object} state - mutable state object
 * @param {number} profit
 * @param {number} closeTimeMs
 * @param {string} closeDateStr - 'YYYY-MM-DD'
 * @param {Object} config
 */
function updateAfterClose(state, profit, closeTimeMs, closeDateStr, config) {
  if (profit < 0) {
    state.consecutiveLosses++;
    state.lastLossTime = closeTimeMs;
  } else {
    state.consecutiveLosses = 0;
    state.lastLossTime = null;
  }
}

/**
 * Create initial filter state.
 */
function createFilterState() {
  return {
    dailyTradesCount: new Map(), // 'YYYY-MM-DD' -> count
    consecutiveLosses: 0,
    lastLossTime: null
  };
}

module.exports = { checkNoiseFilters, updateAfterClose, createFilterState };
