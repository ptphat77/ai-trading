const TradingBot = require('../src/bot/TradingBot');
const RuleEngine = require('../src/strategy/RuleEngine');
const SlTpCalculator = require('../src/strategy/SlTpCalculator');
const SignalBuilder = require('../src/bot/SignalBuilder');
const RiskManager = require('../src/bot/RiskManager');
const notifier = require('../src/utils/notifier');
const { log } = require('../src/utils/logger');

jest.mock('../src/strategy/RuleEngine');
jest.mock('../src/strategy/SlTpCalculator');
jest.mock('../src/bot/SignalBuilder');
jest.mock('../src/bot/RiskManager');
jest.mock('../src/utils/notifier');
jest.mock('../src/utils/logger', () => ({ log: jest.fn() }));

describe('TradingBot.evaluateCycle()', () => {
  let mockDataClient, mockAiAgent, bot;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDataClient = {
      getCandles: jest.fn().mockResolvedValue(new Array(50).fill({})),
      getOpenPositions: jest.fn().mockResolvedValue([]),
      getAccountBalance: jest.fn().mockResolvedValue(10000),
      createOrder: jest.fn().mockResolvedValue({ id: 'order_123' })
    };
    
    mockAiAgent = {
      getDecision: jest.fn().mockResolvedValue({ action: 'buy', confidence: 0.85, reason: 'Mock AI decision' })
    };

    SignalBuilder.buildContext.mockReturnValue({
      currentPrice: 2000,
      indicators: { atr: 2 }
    });
    
    SlTpCalculator.calculateFixedSlTp.mockReturnValue({
      sl: 1998, tp: 2005, slDistance: 2, tpDistance: 5
    });

    RuleEngine.evaluateRule.mockReturnValue({ action: 'buy', reason: 'Good rule' });
    RiskManager.calculateUnits.mockReturnValue(50);
    
    bot = new TradingBot({
      dataClient: mockDataClient,
      aiAgent: mockAiAgent,
      config: { BOT_MODE: 'auto_trade', SYMBOL: 'XAU_USD', MIN_CONFIDENCE: 0.7 }
    });
  });

  describe('Candle validation', () => {
    it('should return insufficient_candles if < 30 candles provided', async () => {
      mockDataClient.getCandles.mockResolvedValue(new Array(10).fill({}));
      const res = await bot.evaluateCycle();
      expect(res.action).toBe('skip');
      expect(res.reason).toBe('insufficient_candles');
    });

    it('should return context_failed if SignalBuilder returns null', async () => {
      SignalBuilder.buildContext.mockReturnValue(null);
      const res = await bot.evaluateCycle();
      expect(res.action).toBe('skip');
      expect(res.reason).toBe('context_failed');
    });
  });

  describe('Tier 1 (Rule) filter', () => {
    it('should skip immediately if Rule returns skip (0 AI calls)', async () => {
      RuleEngine.evaluateRule.mockReturnValue({ action: 'skip', reason: 'bad market' });
      const res = await bot.evaluateCycle();
      expect(res.action).toBe('skip');
      expect(mockAiAgent.getDecision).not.toHaveBeenCalled();
    });

    it('should proceed to AI if Rule returns buy', async () => {
      RuleEngine.evaluateRule.mockReturnValue({ action: 'buy', reason: 'good' });
      const res = await bot.evaluateCycle();
      expect(mockAiAgent.getDecision).toHaveBeenCalled();
      expect(res.action).toBe('buy');
    });

    it('should proceed to AI if Rule returns sell', async () => {
      RuleEngine.evaluateRule.mockReturnValue({ action: 'sell', reason: 'good' });
      mockAiAgent.getDecision.mockResolvedValue({ action: 'sell', confidence: 0.8 });
      const res = await bot.evaluateCycle();
      expect(mockAiAgent.getDecision).toHaveBeenCalled();
      expect(res.action).toBe('sell');
    });
  });

  describe('Tier 2 (AI) decision', () => {
    it('should skip if AI returns skip', async () => {
      mockAiAgent.getDecision.mockResolvedValue({ action: 'skip', confidence: 0, reason: 'bad' });
      const res = await bot.evaluateCycle();
      expect(res.action).toBe('skip');
      expect(mockDataClient.createOrder).not.toHaveBeenCalled();
    });

    it('should skip if AI confidence < MIN_CONFIDENCE', async () => {
      mockAiAgent.getDecision.mockResolvedValue({ action: 'buy', confidence: 0.5 });
      const res = await bot.evaluateCycle();
      expect(res.action).toBe('skip');
    });

    it('should skip if AI action disagrees with rule action', async () => {
      RuleEngine.evaluateRule.mockReturnValue({ action: 'buy' });
      mockAiAgent.getDecision.mockResolvedValue({ action: 'sell', confidence: 0.9 });
      const res = await bot.evaluateCycle();
      expect(res.action).toBe('skip');
    });

    it('should handle AI API error gracefully (no crash, return skip)', async () => {
      mockAiAgent.getDecision.mockRejectedValue(new Error('API Down'));
      const res = await bot.evaluateCycle();
      expect(res.action).toBe('skip');
      expect(log).toHaveBeenCalledWith('error', expect.stringContaining('Lỗi khi gọi AI'));
    });
  });

  describe('BOT_MODE: signal_only', () => {
    it('should NOT place order even if AI approved', async () => {
      bot.config.BOT_MODE = 'signal_only';
      const res = await bot.evaluateCycle();
      expect(res.action).toBe('buy');
      expect(res.executed).toBe(false);
      expect(mockDataClient.createOrder).not.toHaveBeenCalled();
    });

    it('should still send Telegram signal', async () => {
      bot.config.BOT_MODE = 'signal_only';
      await bot.evaluateCycle();
      expect(notifier.sendSignalAlert).toHaveBeenCalled();
    });

    it('should return { executed: false }', async () => {
      bot.config.BOT_MODE = 'signal_only';
      const res = await bot.evaluateCycle();
      expect(res.executed).toBe(false);
    });
  });

  describe('BOT_MODE: auto_trade', () => {


    it('should skip if units = 0 (RiskManager returns 0)', async () => {
      RiskManager.calculateUnits.mockReturnValue(0);
      const res = await bot.evaluateCycle();
      expect(res.action).toBe('skip');
      expect(mockDataClient.createOrder).not.toHaveBeenCalled();
    });

    it('should call createOrder with correct side, units, sl, tp', async () => {
      await bot.evaluateCycle();
      expect(mockDataClient.createOrder).toHaveBeenCalledWith('buy', 50, 1998, 2005);
    });

    it('should return { executed: true } on success', async () => {
      const res = await bot.evaluateCycle();
      expect(res.executed).toBe(true);
    });

    it('should handle createOrder error gracefully', async () => {
      mockDataClient.createOrder.mockRejectedValue(new Error('Broker offline'));
      const res = await bot.evaluateCycle();
      expect(res.executed).toBe(false);
      expect(log).toHaveBeenCalledWith('error', expect.stringContaining('Lỗi khi createOrder'));
    });
  });
});

describe('TradingBot.run()', () => {
  let bot;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    bot = new TradingBot({
      dataClient: { getCandles: jest.fn().mockResolvedValue([]) },
      aiAgent: { getDecision: jest.fn() },
      config: { BOT_MODE: 'auto_trade', SYMBOL: 'XAU_USD', LOOP_INTERVAL_MS: 10 }
    });
    // Mock evaluateCycle so it doesn't do real work
    bot.evaluateCycle = jest.fn().mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should start and schedule next cycle', async () => {
    bot.run();
    expect(bot.isRunning).toBe(true);
    // run the initial cycle that was called synchronously inside run()
    await Promise.resolve();
    expect(bot.evaluateCycle).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(1);
    bot.stop();
  });

  it('should stop when stop() is called', async () => {
    bot.run();
    bot.stop();
    expect(bot.isRunning).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });
});
