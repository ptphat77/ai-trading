const config = require('../config');
const { log } = require('../utils/logger');
const { PROMPT_TEMPLATE } = require('./promptTemplate');

/**
 * Base abstract class for all AI trading agents (GeminiAgent, QwenAgent, etc.).
 * Encapsulates shared prompt template, JSON validation, and safety fallback behavior.
 */
class BaseAIAgent {
  constructor(options = {}) {
    this.promptTemplate = options.promptTemplate || PROMPT_TEMPLATE;
  }

  /**
   * Abstract method to be implemented by specific provider subclasses.
   * @param {Object} context
   * @returns {Promise<Object>}
   */
  async getDecision(context) {
    throw new Error('getDecision() must be implemented by subclass');
  }

  /**
   * Validates the parsed JSON decision against schema and safety constraints.
   * @param {string} rawText - Raw text response from AI model.
   * @returns {Object} Validated decision object or skip fallback.
   */
  _validateAndFormatDecision(rawText) {
    try {
      let cleaned = (rawText || '').trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      }

      const decision = JSON.parse(cleaned);

      // 1. Check required fields
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
      const providerName = this.constructor.name.replace(/Agent$/, '');
      log('warn', `${providerName} response validation failed`, {
        error: validationError.message,
        rawText
      });
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
      sl_atr_multiplier: config.DEFAULT_SL_ATR_MULTIPLIER || 1.2,
      tp_atr_multiplier: config.DEFAULT_TP_ATR_MULTIPLIER || 1.8,
      reason: reason
    };
  }
}

module.exports = BaseAIAgent;
