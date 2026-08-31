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
  STRATEGY_VERSION: process.env.STRATEGY_VERSION || 'v1.2',
  SYMBOL: process.env.SYMBOL || 'XAU_USD',
  TIMEFRAME: process.env.TIMEFRAME || 'M5',
  CANDLE_COUNT: parseInt(process.env.CANDLE_COUNT, 10) || 100,
  RISK_PER_TRADE: parseFloat(process.env.RISK_PER_TRADE) || 0.01,
  MIN_CONFIDENCE: parseFloat(process.env.MIN_CONFIDENCE) || 0.7,

  // --- Strategy Parameters (from STRATEGY.md) ---
  MA_TYPE: process.env.MA_TYPE || 'EMA',
  MA_FAST_PERIOD: parseInt(process.env.MA_FAST_PERIOD, 10) || 9,
  MA_SLOW_PERIOD: parseInt(process.env.MA_SLOW_PERIOD, 10) || 21,
  RSI_PERIOD: parseInt(process.env.RSI_PERIOD, 10) || 14,
  RSI_OVERSOLD: parseInt(process.env.RSI_OVERSOLD, 10) || 30,
  RSI_OVERBOUGHT: parseInt(process.env.RSI_OVERBOUGHT, 10) || 70,
  RSI_LOOKBACK_CANDLES: parseInt(process.env.RSI_LOOKBACK_CANDLES, 10) || 20,
  EMA_CONFIRMATION_WINDOW: parseInt(process.env.EMA_CONFIRMATION_WINDOW, 10) || 5,
  ATR_PERIOD: parseInt(process.env.ATR_PERIOD, 10) || 14,
  DEFAULT_SL_ATR_MULTIPLIER: parseFloat(process.env.DEFAULT_SL_ATR_MULTIPLIER) || 1.5,
  DEFAULT_TP_ATR_MULTIPLIER: parseFloat(process.env.DEFAULT_TP_ATR_MULTIPLIER) || 2.5,
  
  // --- Bot ---
  LOOP_INTERVAL_MS: parseInt(process.env.LOOP_INTERVAL_MS, 10) || 300000,

  // --- Chart Viewer ---
  CHART_PORT: parseInt(process.env.CHART_PORT, 10) || 3400
};

module.exports = Object.freeze(config);
