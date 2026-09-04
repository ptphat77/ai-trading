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
   * Fetch last N candles from the MT5 Python Bridge.
   * GET http://127.0.0.1:8000/candles
   *
   * @param {number} count
   * @param {string} granularity - e.g. 'M5'
   * @returns {Promise<Object[]>} Array of Candle objects
   */
  async getCandles(count, granularity = 'M5') {
    const axios = require('axios');
    try {
      // Connect to the MT5 Python Bridge running locally
      const bridgeUrl = config.BRIDGE_URL || 'http://127.0.0.1:8000';
      const symbol = config.SYMBOL || 'XAU_USD';
      
      const response = await axios.get(`${bridgeUrl}/candles`, {
        params: {
          symbol: symbol,
          timeframe: granularity,
          count: count + 1 // Fetch 1 extra to account for the currently forming candle
        }
      });
      
      if (!response.data || !Array.isArray(response.data)) {
        throw new Error('Invalid response from MT5 Bridge');
      }
      
      // MT5 returns the current forming (unclosed) candle as the very last item.
      // We must drop it so that the bot's indicators and signals are only evaluated on fully closed candles.
      const closedCandles = response.data.slice(0, -1);
      
      // Map to DATA-SCHEMA.md format
      return closedCandles.map(c => ({
        time: new Date(c.time * 1000).toISOString(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
      }));
    } catch (error) {
      console.error('[BrokerClient] Lỗi khi lấy nến từ MT5 Bridge:', error.message);
      throw error;
    }
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
