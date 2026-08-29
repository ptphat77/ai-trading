require('dotenv').config();

/**
 * Single source of truth for all runtime configuration.
 * Never import .env directly elsewhere.
 */
const config = {
  OANDA_API_KEY: process.env.OANDA_API_KEY,
  OANDA_ACCOUNT_ID: process.env.OANDA_ACCOUNT_ID,
  OANDA_BASE_URL: process.env.OANDA_BASE_URL,
  
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  
  SYMBOL: process.env.SYMBOL || 'XAU_USD',
  GRANULARITY: process.env.GRANULARITY || 'M5',
  CANDLE_COUNT: parseInt(process.env.CANDLE_COUNT, 10) || 100,
  RISK_PER_TRADE: parseFloat(process.env.RISK_PER_TRADE) || 0.01,
  MIN_CONFIDENCE: parseFloat(process.env.MIN_CONFIDENCE) || 0.7,
  
  LOOP_INTERVAL_MS: parseInt(process.env.LOOP_INTERVAL_MS, 10) || 300000
};

module.exports = Object.freeze(config);
