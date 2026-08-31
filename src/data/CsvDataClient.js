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

  _parseDateTime(dateStr, timeStr) {
    try {
      let combined = (dateStr || '').trim();
      if (timeStr) combined += ' ' + (timeStr || '').trim();
      const parts = combined.split(/[\sT]+/);
      const dPart = parts[0];
      const tPart = parts[1] || '00:00:00';

      let year, month, day;
      const dTokens = dPart.split(/[\.\/\-]/).map(Number);
      if (dTokens.length < 3 || isNaN(dTokens[0]) || isNaN(dTokens[1]) || isNaN(dTokens[2])) {
        return null;
      }

      if (dTokens[0] > 1000) {
        [year, month, day] = dTokens;
      } else if (dTokens[2] > 1000) {
        [day, month, year] = dTokens;
      } else {
        [year, month, day] = dTokens;
      }

      const tTokens = tPart.split(':').map(Number);
      const hour = isNaN(tTokens[0]) ? 0 : tTokens[0];
      const min = isNaN(tTokens[1]) ? 0 : tTokens[1];
      const sec = isNaN(tTokens[2]) ? 0 : tTokens[2];

      const dt = new Date(Date.UTC(year, month - 1, day, hour, min, sec));
      if (isNaN(dt.getTime())) return null;
      return dt.toISOString();
    } catch {
      return null;
    }
  }

  /**
   * Loads and parses the CSV file into memory.
   * Handles UTF-8, UTF-16LE, tabs, commas, and varied column formats.
   */
  async _loadData() {
    if (this.loaded) return;

    if (!fs.existsSync(this.csvPath)) {
      throw new Error(`CSV data file not found at: ${this.csvPath}`);
    }

    const buf = fs.readFileSync(this.csvPath);
    let text;
    if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) {
      text = buf.toString('utf16le');
    } else {
      text = buf.toString('utf8');
    }

    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1);
    }

    const lines = text.trim().split(/\r?\n/);
    this.candles = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      let delim = ',';
      if (line.includes('\t')) delim = '\t';
      else if (line.includes(';')) delim = ';';

      const parts = line.split(delim).map(s => s.trim().replace(/^["']|["']$/g, ''));
      if (parts.length < 5) continue;

      let isoTime, open, high, low, close, vol;

      if (parts[0].includes(' ') || parts[0].includes('T')) {
        isoTime = this._parseDateTime(parts[0]);
        open = parseFloat(parts[1]);
        high = parseFloat(parts[2]);
        low = parseFloat(parts[3]);
        close = parseFloat(parts[4]);
        vol = parseInt(parts[5] || 0, 10);
      } else if (parts.length >= 6 && parts[1].includes(':')) {
        isoTime = this._parseDateTime(parts[0], parts[1]);
        open = parseFloat(parts[2]);
        high = parseFloat(parts[3]);
        low = parseFloat(parts[4]);
        close = parseFloat(parts[5]);
        vol = parseInt(parts[6] || 0, 10);
      } else {
        continue;
      }

      if (!isoTime || isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) {
        continue; // skip header or unparsable row
      }

      this.candles.push({
        time: isoTime,
        open,
        high,
        low,
        close,
        volume: isNaN(vol) ? 0 : vol
      });
    }

    this.candles.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
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
