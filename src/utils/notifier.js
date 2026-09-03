const axios = require('axios');
const config = require('../config');
const logger = require('./logger');

/**
 * Sends a message to the configured Telegram chat if alerts are enabled.
 * Runs asynchronously and catches its own errors to avoid blocking the main thread.
 * 
 * @param {string} message The text message to send. Supports basic HTML formatting if needed.
 */
async function sendAlert(message) {
  if (!config.TELEGRAM_ALERTS_ENABLED) {
    return;
  }

  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
    logger.log('warn', 'Telegram alerts are enabled but Token or Chat ID is missing.');
    return;
  }

  const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  try {
    // Fire and forget
    axios.post(url, {
      chat_id: config.TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML' // Allow bold, italic, etc.
    }).catch(error => {
      // Catch network errors specifically from axios
      logger.log('error', `Failed to send Telegram alert: ${error.message}`);
    });
  } catch (error) {
    logger.log('error', `Unexpected error when sending Telegram alert: ${error.message}`);
  }
}

/**
 * Helper to send a nicely formatted trading signal combining Rule-based trigger and AI analysis
 * @param {Object} options
 * @param {Object} options.ruleDecision - Rule-based signal { action, reason, ... }
 * @param {Object} [options.aiDecision] - AI evaluation { action, confidence, reason, ... }
 * @param {Object} [options.context] - Market context with indicators
 * @param {Object} [options.calculatedOrder] - Order setup { entryPrice, sl, tp, slDistance, tpDistance }
 */
function sendSignalAlert(options) {
  // Support either options object or positional arguments for flexibility
  let ruleDecision, aiDecision, context, calculatedOrder;
  if (arguments.length > 1 || (options && options.action && !options.ruleDecision)) {
    ruleDecision = arguments[0] || {};
    context = arguments[1] || {};
    calculatedOrder = arguments[2] || null;
    aiDecision = ruleDecision.aiDecision || null;
  } else {
    ruleDecision = options.ruleDecision || {};
    aiDecision = options.aiDecision || null;
    context = options.context || {};
    calculatedOrder = options.calculatedOrder || null;
  }

  const action = (ruleDecision.action || (aiDecision && aiDecision.action) || 'signal').toUpperCase();
  const icon = action === 'BUY' ? '🟢' : (action === 'SELL' ? '🔴' : '🔔');
  const symbol = (context && context.symbol) || config.SYMBOL || 'XAU_USD';

  let msg = `${icon} <b>TÍN HIỆU KỸ THUẬT: ${action} ${symbol}</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━\n`;

  if (calculatedOrder && calculatedOrder.entryPrice) {
    msg += `🎯 <b>Entry:</b> ${calculatedOrder.entryPrice}\n`;
    if (calculatedOrder.sl) msg += `🛑 <b>SL:</b> ${calculatedOrder.sl}\n`;
    if (calculatedOrder.tp) msg += `🎁 <b>TP:</b> ${calculatedOrder.tp}\n`;
    if (calculatedOrder.slDistance && calculatedOrder.tpDistance) {
      const rr = (calculatedOrder.tpDistance / calculatedOrder.slDistance).toFixed(2);
      msg += `⚖️ <b>Risk:Reward:</b> 1:${rr}\n`;
    }
    msg += `\n`;
  }

  if (ruleDecision.reason) {
    msg += `📋 <b>Rule Strategy:</b>\n${ruleDecision.reason}\n\n`;
  }

  if (aiDecision) {
    const aiAction = (aiDecision.action || 'skip').toUpperCase();
    const aiIcon = aiAction === 'BUY' ? '✅' : (aiAction === 'SELL' ? '🔻' : '⚠️');
    const confPercent = aiDecision.confidence !== undefined ? `${(aiDecision.confidence * 100).toFixed(0)}%` : 'N/A';
    
    msg += `🤖 <b>AI Đánh Giá:</b> ${aiIcon} <b>${aiAction}</b> (Độ tin cậy: ${confPercent})\n`;
    if (aiDecision.reason) {
      msg += `💡 <b>Nhận định AI:</b> ${aiDecision.reason}\n\n`;
    }
  }

  // Market technical indicators summary
  const ind = context.indicators;
  if (ind) {
    msg += `📊 <b>Chỉ số Kỹ thuật:</b>\n`;
    if (ind.h1_trend) msg += `• H1 Trend: <b>${ind.h1_trend}</b>\n`;
    if (ind.rsi !== undefined) msg += `• RSI: <b>${ind.rsi}</b>\n`;
    if (ind.adx !== undefined) msg += `• ADX: <b>${ind.adx}</b>\n`;
    if (ind.atr !== undefined) msg += `• ATR: <b>${ind.atr}</b>\n`;
  }

  sendAlert(msg);
}

module.exports = {
  sendAlert,
  sendSignalAlert
};
