const axios = require('axios');
const QwenAgent = require('../src/ai/QwenAgent');
const config = require('../src/config');
const { log } = require('../src/utils/logger');

jest.mock('axios');
jest.mock('../src/utils/logger');

describe('QwenAgent', () => {
  let agent;

  beforeEach(() => {
    jest.clearAllMocks();
    agent = new QwenAgent({
      apiKey: 'test-dashscope-key',
      modelName: 'qwen-plus',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      timeoutMs: 15000
    });
  });

  const mockContext = {
    symbol: 'XAU_USD',
    timeframe: 'M5',
    currentPrice: 2650.50,
    indicators: {
      ma9: 2648.20,
      ma21: 2645.80,
      rsi: 52.5,
      adx: 24.5,
      atr: 2.10,
      ma_cross: 'bullish_cross'
    },
    recentCandles: []
  };

  const setupMockResponse = (jsonObjOrString) => {
    const content = typeof jsonObjOrString === 'string'
      ? jsonObjOrString
      : JSON.stringify(jsonObjOrString);

    axios.post.mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: content
            }
          }
        ]
      }
    });
  };

  it('should return valid buy decision when confidence >= MIN_CONFIDENCE', async () => {
    setupMockResponse({
      action: 'buy',
      confidence: 0.85,
      sl_atr_multiplier: 1.5,
      tp_atr_multiplier: 1.8,
      reason: 'Strong bullish alignment on H1 and M5'
    });

    const result = await agent.getDecision(mockContext);

    expect(result.action).toBe('buy');
    expect(result.confidence).toBe(0.85);
    expect(result.sl_atr_multiplier).toBe(1.5);
    expect(result.tp_atr_multiplier).toBe(1.8);
    expect(result.reason).toContain('bullish alignment');
  });

  it('should handle markdown fenced JSON returned by model', async () => {
    setupMockResponse('```json\n{\n  "action": "sell",\n  "confidence": 0.8,\n  "sl_atr_multiplier": 1.3,\n  "tp_atr_multiplier": 1.6,\n  "reason": "Bearish momentum cross"\n}\n```');

    const result = await agent.getDecision(mockContext);

    expect(result.action).toBe('sell');
    expect(result.confidence).toBe(0.8);
    expect(result.sl_atr_multiplier).toBe(1.3);
    expect(result.tp_atr_multiplier).toBe(1.6);
  });

  it('should return skip decision when model explicitly returns skip', async () => {
    setupMockResponse({
      action: 'skip',
      confidence: 0.75,
      sl_atr_multiplier: 1.2,
      tp_atr_multiplier: 1.8,
      reason: 'ADX indicates choppy sideway market'
    });

    const result = await agent.getDecision(mockContext);

    expect(result.action).toBe('skip');
    expect(result.reason).toContain('choppy');
  });

  it('should override to skip when confidence is below MIN_CONFIDENCE', async () => {
    setupMockResponse({
      action: 'buy',
      confidence: 0.55, // config.MIN_CONFIDENCE is 0.7
      sl_atr_multiplier: 1.5,
      tp_atr_multiplier: 1.8,
      reason: 'Weak breakout'
    });

    const result = await agent.getDecision(mockContext);

    expect(result.action).toBe('skip');
    expect(result.confidence).toBe(0.55);
    expect(result.reason).toContain('Confidence too low');
    expect(log).toHaveBeenCalledWith('info', expect.any(String));
  });

  it('should fallback to skip and log warning on JSON parse fail', async () => {
    setupMockResponse('invalid { json response');

    const result = await agent.getDecision(mockContext);

    expect(result.action).toBe('skip');
    expect(result.confidence).toBe(0);
    expect(log).toHaveBeenCalledWith('warn', 'Qwen response validation failed', expect.any(Object));
  });

  it('should fallback to skip when a required field is missing', async () => {
    setupMockResponse({
      action: 'buy',
      // confidence is missing
      sl_atr_multiplier: 1.5,
      tp_atr_multiplier: 1.8,
      reason: 'Missing confidence'
    });

    const result = await agent.getDecision(mockContext);

    expect(result.action).toBe('skip');
    expect(result.confidence).toBe(0);
  });

  it('should fallback to skip when confidence is out of bounds', async () => {
    setupMockResponse({
      action: 'buy',
      confidence: 1.5, // > 1.0
      sl_atr_multiplier: 1.5,
      tp_atr_multiplier: 1.8,
      reason: 'Overconfident'
    });

    const result = await agent.getDecision(mockContext);

    expect(result.action).toBe('skip');
  });

  it('should fallback to skip when action is invalid', async () => {
    setupMockResponse({
      action: 'hold', // Invalid action
      confidence: 0.9,
      sl_atr_multiplier: 1.5,
      tp_atr_multiplier: 1.8,
      reason: 'Holding'
    });

    const result = await agent.getDecision(mockContext);

    expect(result.action).toBe('skip');
  });

  it('should fallback to skip when API call fails or times out', async () => {
    axios.post.mockRejectedValue(new Error('Network Timeout Error'));

    const result = await agent.getDecision(mockContext);

    expect(result.action).toBe('skip');
    expect(result.confidence).toBe(0);
    expect(log).toHaveBeenCalledWith('warn', 'Qwen API call failed or timed out', expect.any(Object));
  });

  it('should fallback to skip if DASHSCOPE_API_KEY is not provided', async () => {
    const unconfiguredAgent = new QwenAgent({ apiKey: '' });

    const result = await unconfiguredAgent.getDecision(mockContext);

    expect(result.action).toBe('skip');
    expect(result.reason).toContain('DASHSCOPE_API_KEY is missing');
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('DASHSCOPE_API_KEY is not configured'));
  });
});
