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

  // --- AI Provider & Engine ---
  AI_PROVIDER: (process.env.AI_PROVIDER || 'qwen').toLowerCase(), // 'qwen' | 'gemini'
  AI_RATE_LIMIT_DELAY_MS: parseInt(process.env.AI_RATE_LIMIT_DELAY_MS, 10) || 300,

  // Alibaba Cloud DashScope (Qwen)
  DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY,
  DASHSCOPE_MODEL: process.env.DASHSCOPE_MODEL || 'qwen-plus',
  DASHSCOPE_BASE_URL: process.env.DASHSCOPE_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',

  // Google Gemini (Alternative)
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',

  // --- Strategy ---
  STRATEGY_VERSION: process.env.STRATEGY_VERSION || 'v2.2',
  SYMBOL: process.env.SYMBOL || 'XAU_USD',
  TIMEFRAME: process.env.TIMEFRAME || 'M5',
  CANDLE_COUNT: parseInt(process.env.CANDLE_COUNT, 10) || 300,
  RISK_PER_TRADE: parseFloat(process.env.RISK_PER_TRADE) || 0.015,
  MIN_CONFIDENCE: parseFloat(process.env.MIN_CONFIDENCE) || 0.7,

  // --- Strategy Parameters (chien-luoc-ema-rsi-m5-bot.md) ---
  MA_TYPE: process.env.MA_TYPE || 'EMA',
  MA_FAST_PERIOD: parseInt(process.env.MA_FAST_PERIOD, 10) || 9,
  MA_SLOW_PERIOD: parseInt(process.env.MA_SLOW_PERIOD, 10) || 21,
  H1_MA_FAST_PERIOD: parseInt(process.env.H1_MA_FAST_PERIOD, 10) || 50,
  H1_MA_SLOW_PERIOD: parseInt(process.env.H1_MA_SLOW_PERIOD, 10) || 200,
  RSI_PERIOD: parseInt(process.env.RSI_PERIOD, 10) || 9,
  RSI_BUY_MIN: parseFloat(process.env.RSI_BUY_MIN) || 40,
  RSI_BUY_MAX: parseFloat(process.env.RSI_BUY_MAX) || 65,
  RSI_SELL_MIN: parseFloat(process.env.RSI_SELL_MIN) || 35,
  RSI_SELL_MAX: parseFloat(process.env.RSI_SELL_MAX) || 60,
  RSI_OVERSOLD: parseInt(process.env.RSI_OVERSOLD, 10) || 35,
  RSI_OVERBOUGHT: parseInt(process.env.RSI_OVERBOUGHT, 10) || 65,
  ADX_PERIOD: parseInt(process.env.ADX_PERIOD, 10) || 14,
  ADX_THRESHOLD: parseFloat(process.env.ADX_THRESHOLD) || 20,
  ATR_PERIOD: parseInt(process.env.ATR_PERIOD, 10) || 14,
  DEFAULT_SL_ATR_MULTIPLIER: parseFloat(process.env.DEFAULT_SL_ATR_MULTIPLIER) || 1.2,
  DEFAULT_TP_ATR_MULTIPLIER: parseFloat(process.env.DEFAULT_TP_ATR_MULTIPLIER) || 1.8,
  EARLY_EXIT_ENABLED: process.env.EARLY_EXIT_ENABLED === 'false' ? false : true,
  MAX_TRADES_PER_DAY: parseInt(process.env.MAX_TRADES_PER_DAY, 10) || 5,
  CONSECUTIVE_LOSS_COOLDOWN_HOURS: parseInt(process.env.CONSECUTIVE_LOSS_COOLDOWN_HOURS, 10) || 2,
  
  // --- Bot ---
  LOOP_INTERVAL_MS: parseInt(process.env.LOOP_INTERVAL_MS, 10) || 300000,

  // --- Chart Viewer ---
  CHART_PORT: parseInt(process.env.CHART_PORT, 10) || 3400,
  TRADE_LOG_PATH: process.env.TRADE_LOG_PATH
};

module.exports = Object.freeze(config);
