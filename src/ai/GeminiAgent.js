const { GoogleGenAI } = require('@google/genai');
const config = require('../config');
const { log } = require('../utils/logger');

const PROMPT_TEMPLATE = `You are an expert Forex technical analyst.
Analyze the following signal and make a trading decision for XAU/USD:
[context: symbol, timeframe, currentPrice, indicators{ma9, ma21, rsi, atr, ma_cross}, recentCandles]

Requirement: Return JSON with the format:
{
  "action": "buy" | "sell" | "skip",
  "confidence": 0.0-1.0,
  "sl_atr_multiplier": number,
  "tp_atr_multiplier": number,
  "reason": "Brief explanation"
}`;

class GeminiAgent {
  constructor() {
    this.ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
    this.modelName = config.GEMINI_MODEL || 'gemini-3.7-flash';
  }

  /**
   * Calls Gemini API to get a trading decision based on technical context.
   * @param {Object} context - The context object matching GeminiContext schema.
   * @returns {Promise<Object>} - The GeminiResponse object. Always falls back to 'skip' on error.
   */
  async getDecision(context) {
    const promptText = `${PROMPT_TEMPLATE}\n\nContext:\n${JSON.stringify(context, null, 2)}`;

    try {
      // Apply a timeout of 15 seconds to prevent hanging
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 15000);

      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: promptText,
        config: {
          responseMimeType: 'application/json',
        }
      }, {
        signal: abortController.signal
      });

      clearTimeout(timeoutId);

      const responseText = response.text;
      if (!responseText) {
        throw new Error('Empty response from Gemini');
      }

      return this._validateAndFormatDecision(responseText);
      
    } catch (error) {
      log('warn', 'Gemini API call failed or timed out', { error: error.message });
      return this._createSkipFallback('API error or timeout: ' + error.message);
    }
  }

  /**
   * Validates the parsed JSON decision against the schema and safety rules.
   * @param {string} rawText - Raw text response for logging on failure.
   * @returns {Object} Validated decision object or skip fallback.
   */
  _validateAndFormatDecision(rawText) {
    try {
      const decision = JSON.parse(rawText);
      // 1. Check missing fields
      if (
        !decision.action ||
        typeof decision.confidence !== 'number' ||
        typeof decision.sl_atr_multiplier !== 'number' ||
        typeof decision.tp_atr_multiplier !== 'number' ||
        !decision.reason
      ) {
        throw new Error('Missing or invalid field type in response');
      }

      // 2. Validate action
      if (!['buy', 'sell', 'skip'].includes(decision.action)) {
        throw new Error(`Invalid action: ${decision.action}`);
      }

      // 3. Validate confidence bounds
      if (decision.confidence < 0 || decision.confidence > 1) {
        throw new Error(`Confidence out of bounds: ${decision.confidence}`);
      }

      // 4. Validate SL/TP multipliers
      if (decision.sl_atr_multiplier <= 0 || decision.tp_atr_multiplier <= 0) {
        throw new Error('SL/TP multipliers must be positive');
      }

      // 5. Apply MIN_CONFIDENCE safety fallback
      if (decision.confidence < config.MIN_CONFIDENCE) {
        log('info', `Confidence ${decision.confidence} below threshold ${config.MIN_CONFIDENCE}, skipping.`);
        decision.action = 'skip';
        decision.reason = `Confidence too low. Original reason: ${decision.reason}`;
      }

      return decision;

    } catch (validationError) {
      log('warn', 'Gemini response validation failed', { error: validationError.message, rawText });
      return this._createSkipFallback('Validation failed: ' + validationError.message);
    }
  }

  /**
   * Creates a safe 'skip' fallback decision object.
   * @param {string} reason - The reason for falling back.
   * @returns {Object} Fallback decision.
   */
  _createSkipFallback(reason) {
    return {
      action: 'skip',
      confidence: 0,
      sl_atr_multiplier: 1.5,
      tp_atr_multiplier: 2.5,
      reason: reason
    };
  }
}

module.exports = GeminiAgent;
