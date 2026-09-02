const { GoogleGenAI } = require('@google/genai');
const GeminiAgentClass = require('../src/ai/GeminiAgent');
const config = require('../src/config');
const { log } = require('../src/utils/logger');

jest.mock('@google/genai');
jest.mock('../src/utils/logger');

describe('GeminiAgent', () => {
  let mockGenerateContent;
  let agent;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    mockGenerateContent = jest.fn();
    GoogleGenAI.mockImplementation(() => {
      return {
        models: {
          generateContent: mockGenerateContent
        }
      };
    });
    
    // Re-instantiate the agent to pick up the mocked GoogleGenAI
    agent = new GeminiAgentClass();
  });

  const mockContext = {
    symbol: "XAU/USD",
    timeframe: "M5",
    currentPrice: 2350.45,
    indicators: {
      ma9: 2348.20,
      ma21: 2345.80,
      rsi: 32.5,
      atr: 1.85,
      ma_cross: "bullish_cross"
    },
    recentCandles: []
  };

  const setupMockResponse = (jsonObj) => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(jsonObj)
    });
  };

  it('should return valid buy decision when confidence >= MIN_CONFIDENCE', async () => {
    setupMockResponse({
      action: 'buy',
      confidence: 0.85,
      sl_atr_multiplier: 1.0,
      tp_atr_multiplier: 2.5,
      reason: 'Looks good'
    });

    const result = await agent.getDecision(mockContext);
    
    expect(result.action).toBe('buy');
    expect(result.confidence).toBe(0.85);
    expect(result.sl_atr_multiplier).toBe(1.0);
    expect(result.tp_atr_multiplier).toBe(2.5);
  });

  it('should return skip decision when model explicitly returns skip', async () => {
    setupMockResponse({
      action: 'skip',
      confidence: 0.8,
      sl_atr_multiplier: 1.0,
      tp_atr_multiplier: 2.5,
      reason: 'No clear trend'
    });

    const result = await agent.getDecision(mockContext);
    
    expect(result.action).toBe('skip');
  });

  it('should override to skip when confidence is below MIN_CONFIDENCE', async () => {
    setupMockResponse({
      action: 'buy',
      confidence: 0.5, // config.MIN_CONFIDENCE is 0.7
      sl_atr_multiplier: 1.0,
      tp_atr_multiplier: 2.5,
      reason: 'Weak signal'
    });

    const result = await agent.getDecision(mockContext);
    
    expect(result.action).toBe('skip');
    expect(result.confidence).toBe(0.5); // Confidence is preserved
    expect(result.reason).toContain('Confidence too low');
    expect(log).toHaveBeenCalledWith('info', expect.any(String));
  });

  it('should fallback to skip and log warning on JSON parse fail', async () => {
    mockGenerateContent.mockResolvedValue({
      text: '{ invalid json '
    });

    const result = await agent.getDecision(mockContext);
    
    expect(result.action).toBe('skip');
    expect(result.confidence).toBe(0);
    expect(log).toHaveBeenCalledWith('warn', 'Gemini response validation failed', expect.any(Object));
  });

  it('should fallback to skip when a required field is missing', async () => {
    setupMockResponse({
      action: 'sell',
      // confidence is missing
      sl_atr_multiplier: 1.0,
      tp_atr_multiplier: 2.5,
      reason: 'Missing confidence field'
    });

    const result = await agent.getDecision(mockContext);
    
    expect(result.action).toBe('skip');
  });

  it('should fallback to skip when confidence is out of bounds', async () => {
    setupMockResponse({
      action: 'buy',
      confidence: 1.5, // > 1
      sl_atr_multiplier: 1.0,
      tp_atr_multiplier: 2.5,
      reason: 'Overconfident'
    });

    const result = await agent.getDecision(mockContext);
    
    expect(result.action).toBe('skip');
  });

  it('should fallback to skip when action is invalid', async () => {
    setupMockResponse({
      action: 'hold', // Invalid action
      confidence: 0.9,
      sl_atr_multiplier: 1.0,
      tp_atr_multiplier: 2.5,
      reason: 'Holding'
    });

    const result = await agent.getDecision(mockContext);
    
    expect(result.action).toBe('skip');
  });

  it('should fallback to skip on API error/timeout', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Network Timeout'));

    const result = await agent.getDecision(mockContext);
    
    expect(result.action).toBe('skip');
    expect(log).toHaveBeenCalledWith('warn', 'Gemini API call failed or timed out', expect.any(Object));
  });
});
