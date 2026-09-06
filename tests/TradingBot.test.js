const TradingBot = require('../src/bot/TradingBot');
const RuleEngine = require('../src/strategy/RuleEngine');
const SlTpCalculator = require('../src/strategy/SlTpCalculator');
const SignalBuilder = require('../src/bot/SignalBuilder');
const RiskManager = require('../src/bot/RiskManager');
const notifier = require('../src/utils/notifier');

jest.mock('../src/strategy/RuleEngine');
jest.mock('../src/strategy/SlTpCalculator');
jest.mock('../src/bot/SignalBuilder');
jest.mock('../src/bot/RiskManager');
jest.mock('../src/utils/notifier');
jest.mock('../src/utils/logger', () => ({ log: jest.fn() }));

describe('TradingBot', () => {
  let mockDataClient, mockAiAgent, bot;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDataClient = {
      getCandles: jest.fn().mockResolvedValue(new Array(50).fill({})),
      getOpenPositions: jest.fn().mockResolvedValue([]),
      getAccountBalance: jest.fn().mockResolvedValue(10000),
      createOrder: jest.fn().mockResolvedValue({ id: 'order_1' })
    };
    mockAiAgent = {
      getDecision: jest.fn().mockResolvedValue({ action: 'buy', confidence: 0.9, reason: 'ok' })
    };
    SignalBuilder.buildContext.mockReturnValue({
      currentPrice: 2000,
      indicators: { atr: 2 }
    });
    SlTpCalculator.calculateFixedSlTp.mockReturnValue({
      sl: 1998, tp: 2005, slDistance: 2, tpDistance: 5
    });
    RiskManager.calculateUnits.mockReturnValue(50);
    
    bot = new TradingBot({
      dataClient: mockDataClient,
      aiAgent: mockAiAgent,
      config: { BOT_MODE: 'auto_trade', SYMBOL: 'XAU_USD' }
    });
  });

  it('Kiểm tra evaluateCycle() gọi evaluateRule()', async () => {
    RuleEngine.evaluateRule.mockReturnValue({ action: 'buy', reason: 'test' });
    const res = await bot.evaluateCycle();
    
    expect(RuleEngine.evaluateRule).toHaveBeenCalled();
    expect(res.action).toBe('buy');
    expect(mockDataClient.createOrder).toHaveBeenCalled();
  });

  it('Open position -> skip', async () => {
    RuleEngine.evaluateRule.mockReturnValue({ action: 'buy', reason: 'test' });
    mockDataClient.getOpenPositions.mockResolvedValue([{ id: 'pos_1' }]);
    
    const res = await bot.evaluateCycle();
    
    expect(res.action).toBe('skip');
    expect(res.reason).toBe('position_already_open');
    expect(mockDataClient.createOrder).not.toHaveBeenCalled();
  });

  it('Rule skip -> không gọi AI', async () => {
    RuleEngine.evaluateRule.mockReturnValue({ action: 'skip', reason: 'bad market' });
    
    const res = await bot.evaluateCycle();
    
    expect(res.action).toBe('skip');
    expect(mockAiAgent.getDecision).not.toHaveBeenCalled();
  });

  it('AI low confidence -> không place order', async () => {
    RuleEngine.evaluateRule.mockReturnValue({ action: 'buy', reason: 'good' });
    mockAiAgent.getDecision.mockResolvedValue({ action: 'buy', confidence: 0.5 });
    
    const res = await bot.evaluateCycle();
    
    expect(res.action).toBe('skip');
    expect(mockDataClient.createOrder).not.toHaveBeenCalled();
  });

  it('BOT_MODE signal_only -> không place order', async () => {
    bot.config.BOT_MODE = 'signal_only';
    RuleEngine.evaluateRule.mockReturnValue({ action: 'buy', reason: 'good' });
    
    const res = await bot.evaluateCycle();
    
    expect(res.action).toBe('buy');
    expect(res.executed).toBe(false);
    expect(mockDataClient.createOrder).not.toHaveBeenCalled();
  });
});
