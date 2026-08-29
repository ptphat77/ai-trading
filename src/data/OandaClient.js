/**
 * Only calls OANDA REST API and returns raw data. No business logic.
 */
class OandaClient {
  constructor() {
    // API client setup logic here
  }

  async getCandles() {
    // Fetch last N candles
  }

  async getAccountBalance() {
    // Get account balance
  }

  async createOrder() {
    // Place Market order with SL/TP
  }

  async getOpenPositions() {
    // Check open positions
  }

  async closePosition() {
    // Close position
  }
}

module.exports = OandaClient;
