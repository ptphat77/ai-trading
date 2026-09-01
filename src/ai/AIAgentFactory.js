const config = require('../config');
const QwenAgent = require('./QwenAgent');
const GeminiAgent = require('./GeminiAgent');

/**
 * Factory to create AI agent based on configured provider ('qwen' | 'gemini').
 */
class AIAgentFactory {
  /**
   * Creates an AI agent instance.
   * @param {Object} [options]
   * @param {string} [options.provider] - 'qwen' | 'gemini'
   * @returns {QwenAgent|GeminiAgent}
   */
  static createAgent(options = {}) {
    const provider = (options.provider || config.AI_PROVIDER || 'qwen').toLowerCase();

    if (provider === 'gemini') {
      return new GeminiAgent(options);
    }

    // Default to Qwen (Alibaba Cloud DashScope)
    return new QwenAgent(options);
  }
}

module.exports = AIAgentFactory;
