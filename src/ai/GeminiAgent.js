const { GoogleGenAI } = require('@google/genai');
const config = require('../config');
const { log } = require('../utils/logger');
const BaseAIAgent = require('./BaseAIAgent');

class GeminiAgent extends BaseAIAgent {
  constructor(options = {}) {
    super(options);
    this.apiKey = options.apiKey !== undefined ? options.apiKey : config.GEMINI_API_KEY;
    this.modelName = options.modelName || config.GEMINI_MODEL || 'gemini-2.5-flash';
    this.timeoutMs = options.timeoutMs || 15000;
    this.ai = new GoogleGenAI({ apiKey: this.apiKey || 'placeholder' });
  }

  /**
   * Calls Gemini API to get a trading decision based on technical context.
   * @param {Object} context - The context object matching GeminiContext schema.
   * @returns {Promise<Object>} - The GeminiResponse object. Always falls back to 'skip' on error.
   */
  async getDecision(context) {
    if (!this.apiKey) {
      log('warn', 'GEMINI_API_KEY is not configured. Falling back to skip.');
      return this._createSkipFallback('GEMINI_API_KEY is missing');
    }

    const promptText = `${this.promptTemplate}\n\nContext:\n${JSON.stringify(context, null, 2)}`;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), this.timeoutMs);

    try {
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
      clearTimeout(timeoutId);
      log('warn', 'Gemini API call failed or timed out', { error: error.message });
      return this._createSkipFallback('API error or timeout: ' + error.message);
    }
  }
}

module.exports = GeminiAgent;
