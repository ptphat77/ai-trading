require('dotenv').config();

/**
 * Single source of truth for all runtime configuration.
 * Never import .env directly elsewhere.
 */
const config = {
  // --- Data Layer ---
  // Phase 1 & 2: CSV source (CsvDataClient) — can be exported from MT5, TradingView, Dukascopy, etc.
  CSV_DATA_PATH: process.env.CSV_DATA_PATH || './data/candles.csv',

  // Phase 3 & 4: Broker REST API (BrokerClient)
  BROKER_API_KEY: process.env.BROKER_API_KEY,
  BROKER_ACCOUNT_ID: process.env.BROKER_ACCOUNT_ID,
  BROKER_BASE_URL: process.env.BROKER_BASE_URL,

  // --- Gemini ---
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,

  // --- Strategy ---
  SYMBOL: process.env.SYMBOL || 'XAU_USD',
  TIMEFRAME: process.env.TIMEFRAME || 'M5',
  CANDLE_COUNT: parseInt(process.env.CANDLE_COUNT, 10) || 100,
  RISK_PER_TRADE: parseFloat(process.env.RISK_PER_TRADE) || 0.01,
  MIN_CONFIDENCE: parseFloat(process.env.MIN_CONFIDENCE) || 0.7,

  // --- Bot ---
  LOOP_INTERVAL_MS: parseInt(process.env.LOOP_INTERVAL_MS, 10) || 300000
};

module.exports = Object.freeze(config);
