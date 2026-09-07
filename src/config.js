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
  BRIDGE_URL: process.env.BRIDGE_URL || 'http://127.0.0.1:8000',

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
  STRATEGY_VERSION: process.env.STRATEGY_VERSION || 'v3.1.0',
  SYMBOL: process.env.SYMBOL || 'XAU_USD',
  TIMEFRAME: process.env.TIMEFRAME || 'M5',
  CANDLE_COUNT: parseInt(process.env.CANDLE_COUNT, 10) || 300,
  RISK_PER_TRADE: parseFloat(process.env.RISK_PER_TRADE) || 0.015,
  MIN_CONFIDENCE: parseFloat(process.env.MIN_CONFIDENCE) || 0.7,

  // --- Strategy Parameters (UT Bot + STC) ---
  UTBOT1_KEY: parseFloat(process.env.UTBOT1_KEY) || 2,
  UTBOT1_ATR_PERIOD: parseInt(process.env.UTBOT1_ATR_PERIOD, 10) || 1,
  UTBOT2_KEY: parseFloat(process.env.UTBOT2_KEY) || 2,
  UTBOT2_ATR_PERIOD: parseInt(process.env.UTBOT2_ATR_PERIOD, 10) || 300,
  
  STC_LENGTH: parseInt(process.env.STC_LENGTH, 10) || 60,
  STC_FAST_LENGTH: parseInt(process.env.STC_FAST_LENGTH, 10) || 35,
  STC_SLOW_LENGTH: parseInt(process.env.STC_SLOW_LENGTH, 10) || 50,
  STC_FACTOR: parseFloat(process.env.STC_FACTOR) || 0.7,
  STC_GREEN_LINE: parseFloat(process.env.STC_GREEN_LINE) || 20,
  STC_RED_LINE: parseFloat(process.env.STC_RED_LINE) || 80,
  // Tier 2 entry zone (relaxed, requires RSI confirmation)
  STC_TIER2_GREEN_LINE: parseFloat(process.env.STC_TIER2_GREEN_LINE) || 25,
  STC_TIER2_RED_LINE: parseFloat(process.env.STC_TIER2_RED_LINE) || 75,

  // RSI (used as Tier 2 confirmation indicator)
  RSI_PERIOD: parseInt(process.env.RSI_PERIOD, 10) || 14,
  RSI_OVERSOLD: parseFloat(process.env.RSI_OVERSOLD) || 40,
  RSI_OVERBOUGHT: parseFloat(process.env.RSI_OVERBOUGHT) || 60,
  
  // EMA (used as Tier 2 macro trend filter)
  EMA_PERIOD: parseInt(process.env.EMA_PERIOD, 10) || 200,
  
  ATR_PERIOD: parseInt(process.env.ATR_PERIOD, 10) || 14,
  EARLY_EXIT_ENABLED: process.env.EARLY_EXIT_ENABLED === 'false' ? false : true,
  MAX_TRADES_PER_DAY: parseInt(process.env.MAX_TRADES_PER_DAY, 10) || 5,
  CONSECUTIVE_LOSS_COOLDOWN_HOURS: parseInt(process.env.CONSECUTIVE_LOSS_COOLDOWN_HOURS, 10) || 2,
  
  // --- Bot ---
  LOOP_INTERVAL_MS: parseInt(process.env.LOOP_INTERVAL_MS, 10) || 300000,
  BOT_MODE: process.env.BOT_MODE || 'auto_trade', // 'auto_trade' | 'signal_only'

  // --- Chart Viewer ---
  CHART_PORT: parseInt(process.env.CHART_PORT, 10) || 3400,
  TRADE_LOG_PATH: process.env.TRADE_LOG_PATH,

  // --- Telegram Alerts ---
  TELEGRAM_ALERTS_ENABLED: process.env.TELEGRAM_ALERTS_ENABLED === 'true',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID
};

module.exports = Object.freeze(config);
