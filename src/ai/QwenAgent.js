const axios = require('axios');
const config = require('../config');
const { log } = require('../utils/logger');
const BaseAIAgent = require('./BaseAIAgent');

class QwenAgent extends BaseAIAgent {
  constructor(options = {}) {
    super(options);
    this.apiKey = options.apiKey !== undefined ? options.apiKey : config.DASHSCOPE_API_KEY;
    this.modelName = options.modelName || config.DASHSCOPE_MODEL || 'qwen-plus';
    this.baseUrl = options.baseUrl || config.DASHSCOPE_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
    this.timeoutMs = options.timeoutMs || 15000;
  }

  /**
   * Calls Alibaba Cloud DashScope (Qwen) API to get a trading decision based on technical context.
   * @param {Object} context - The context object matching AI Context schema.
   * @returns {Promise<Object>} - The decision object. Always falls back to 'skip' on error.
   */
  async getDecision(context) {
    if (!this.apiKey) {
      log('warn', 'DASHSCOPE_API_KEY is not configured. Falling back to skip.');
      return this._createSkipFallback('DASHSCOPE_API_KEY is missing');
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), this.timeoutMs);

    try {
      const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;

      const response = await axios.post(
        endpoint,
        {
          model: this.modelName,
          messages: [
            {
              role: 'system',
              content: this.promptTemplate
            },
            {
              role: 'user',
              content: `Analyze the following technical context and provide your decision strictly in JSON:\n\n${JSON.stringify(context, null, 2)}`
            }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          signal: abortController.signal
        }
      );

      clearTimeout(timeoutId);

      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from DashScope Qwen');
      }

      return this._validateAndFormatDecision(content);

    } catch (error) {
      clearTimeout(timeoutId);
      const isTimeout = error.name === 'CanceledError' || error.code === 'ECONNABORTED' || abortController.signal.aborted;
      const errorMessage = isTimeout ? 'Request timed out' : (error.response?.data?.message || error.message);
      
      log('warn', 'Qwen API call failed or timed out', { error: errorMessage });
      return this._createSkipFallback('API error or timeout: ' + errorMessage);
    }
  }
}

module.exports = QwenAgent;
