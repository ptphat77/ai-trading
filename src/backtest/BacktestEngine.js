const CsvDataClient = require('../data/CsvDataClient');

/**
 * BacktestEngine — simulates trading on historical candle data.
 *
 * Data source: CsvDataClient.getCandles() — no broker API needed.
 * Two modes:
 *   - rule-based:    fast, uses MA cross + RSI hard rules, no Gemini quota consumed.
 *   - ai-simulated: actual Gemini calls, used to validate prompt quality.
 *
 * See ARCHITECTURE.md §Layer 5 and STRATEGY.md for parameters.
 */
class BacktestEngine {
  constructor() {
    // Uses CsvDataClient (Phase 1 & 2 — local CSV, no broker API needed)
    this.dataClient = new CsvDataClient();
  }

  async runRuleBased() {
    // Run fast rule-based simulation
  }

  async runAISimulated() {
    // Run simulation with actual Gemini calls
  }
}

module.exports = BacktestEngine;
