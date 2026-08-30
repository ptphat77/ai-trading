const fs = require('fs');
const path = require('path');
const config = require('../config');

/**
 * Reads a local candle CSV file and simulates the Data Layer interface.
 *
 * Used in Phase 1 (unit test) & Phase 2 (backtest).
 * The CSV can be exported from any source: MT5, TradingView, Dukascopy, etc.
 * No network calls, no API key required.
 *
 * Interface is identical to BrokerClient — swap by injecting the appropriate client.
 */
class CsvDataClient {
  constructor() {
    this.csvPath = config.CSV_DATA_PATH
      ? path.resolve(process.cwd(), config.CSV_DATA_PATH)
      : path.resolve(process.cwd(), 'data/candles.csv');
    this.candles = [];
    this.loaded = false;
  }

  /**
   * Loads and parses the CSV file into memory.
   * Expected format: <DATE> <TIME> <OPEN> <HIGH> <LOW> <CLOSE> <TICKVOL> <VOL> <SPREAD>
   * Delimiter: Tab (\t)
   */
  async _loadData() {
    if (this.loaded) return;

    if (!fs.existsSync(this.csvPath)) {
      throw new Error(`CSV data file not found at: ${this.csvPath}`);
    }

    const fileContent = fs.readFileSync(this.csvPath, 'utf8');
    const lines = fileContent.trim().split('\n');

    // Skip header (line 0)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split('\t');
      if (parts.length < 7) continue;

      const datePart = parts[0]; // e.g. 2025.09.01
      const timePart = parts[1]; // e.g. 01:05:00

      // Convert 2025.09.01 → 2025-09-01T01:05:00Z
      const isoDateStr = `${datePart.replace(/\./g, '-')}T${timePart}Z`;

      this.candles.push({
        time: new Date(isoDateStr).toISOString(),
        open: parseFloat(parts[2]),
        high: parseFloat(parts[3]),
        low: parseFloat(parts[4]),
        close: parseFloat(parts[5]),
        volume: parseInt(parts[6], 10)
      });
    }

    this.loaded = true;
  }

  /**
   * Fetch the last N candles up to a specific time (for backtesting simulation).
   * If endTime is not provided, returns the very last N candles in the dataset.
   *
   * @param {number} count - Number of candles to return.
   * @param {string|null} endTime - ISO timestamp upper bound (exclusive).
   * @returns {Promise<Object[]>} Array of Candle objects.
   */
  async getCandles(count = 100, endTime = null) {
    await this._loadData();

    let endIndex = this.candles.length;

    if (endTime) {
      const endMs = new Date(endTime).getTime();
      // Find the index of the first candle strictly after endTime
      const nextCandleIdx = this.candles.findIndex(c => new Date(c.time).getTime() > endMs);
      if (nextCandleIdx !== -1) {
        endIndex = nextCandleIdx;
      }
    }

    const startIndex = Math.max(0, endIndex - count);
    return this.candles.slice(startIndex, endIndex);
  }

  // --- Mocks for live trading methods (to satisfy the shared Data Layer interface) ---

  async getAccountBalance() {
    return { balance: 100000, marginAvailable: 100000 };
  }

  async createOrder(orderParams) {
    console.log(`[CsvDataClient Mock] Simulated order placed:`, orderParams);
    return { id: `mock_order_${Date.now()}` };
  }

  async getOpenPositions() {
    return [];
  }

  async closePosition(symbol) {
    console.log(`[CsvDataClient Mock] Position closed for ${symbol}`);
    return { id: `mock_close_${Date.now()}` };
  }
}

module.exports = CsvDataClient;
