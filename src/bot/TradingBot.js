const CsvDataClient = require('../data/CsvDataClient');

class TradingBot {
  constructor() {
    // Phase 1 & 2: use CsvDataClient (local CSV, no broker API needed)
    // Phase 3 & 4: swap to BrokerClient (require('../data/BrokerClient'))
    this.dataClient = new CsvDataClient();
  }

  async run() {
    // Main loop logic
    // Must call RiskManager.calculateUnits()
  }
}

module.exports = TradingBot;
