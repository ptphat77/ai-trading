const config = require('../config');

/**
 * BrokerClient — wrapper to call the Broker REST API.
 *
 * Used in Phase 3 (Paper Trading) & Phase 4 (Live Trading).
 * The actual broker is determined solely by BROKER_BASE_URL and BROKER_API_KEY in .env —
 * no code changes needed to switch brokers.
 *
 * Interface is identical to CsvDataClient — swap by injecting the appropriate client.
 *
 * ⚠️  SKELETON — methods are not yet implemented.
 *     Implement when ready to move to Phase 3 (Paper Trading).
 *     See API-CONTRACTS.md section 1 for endpoint details.
 *
 * Hard constraints (PROJECT-RULES.md):
 * - Never write business logic here. Only call the API and return raw data.
 * - Never log BROKER_API_KEY.
 * - HTTP 4xx → log error body, skip cycle.
 * - HTTP 5xx / timeout → skip cycle.
 */
class BrokerClient {
  constructor() {
    this.baseUrl = config.BROKER_BASE_URL;
    this.accountId = config.BROKER_ACCOUNT_ID;
    this.headers = {
      Authorization: `Bearer ${config.BROKER_API_KEY}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Fetch last N candles from the broker.
   * GET /v3/accounts/{accountId}/instruments/{symbol}/candles
   *
   * @param {number} count
   * @param {string} granularity - e.g. 'M5'
   * @returns {Promise<Object[]>} Array of Candle objects (mapped to DATA-SCHEMA.md format)
   */
  async getCandles(count, granularity) {
    throw new Error('BrokerClient.getCandles() not implemented — Phase 3/4 only');
  }

  /**
   * Get real account balance.
   * GET /v3/accounts/{accountId}/summary
   *
   * @returns {Promise<{ balance: number, marginAvailable: number }>}
   */
  async getAccountBalance() {
    throw new Error('BrokerClient.getAccountBalance() not implemented — Phase 3/4 only');
  }

  /**
   * Place a market order with SL/TP.
   * POST /v3/accounts/{accountId}/orders
   *
   * @param {'buy'|'sell'} side
   * @param {number} units - positive = buy, negative = sell
   * @param {number} sl - stop loss price
   * @param {number} tp - take profit price
   * @returns {Promise<{ id: string }>}
   */
  async createOrder(side, units, sl, tp) {
    throw new Error('BrokerClient.createOrder() not implemented — Phase 3/4 only');
  }

  /**
   * Check open positions.
   * GET /v3/accounts/{accountId}/openPositions
   *
   * @returns {Promise<Object[]>} Array of Position objects (DATA-SCHEMA.md §8)
   */
  async getOpenPositions() {
    throw new Error('BrokerClient.getOpenPositions() not implemented — Phase 3/4 only');
  }

  /**
   * Close an open position.
   * PUT /v3/accounts/{accountId}/positions/{symbol}/close
   *
   * @param {string} symbol - e.g. 'XAU_USD'
   * @returns {Promise<void>}
   */
  async closePosition(symbol) {
    throw new Error('BrokerClient.closePosition() not implemented — Phase 3/4 only');
  }
}

module.exports = BrokerClient;
