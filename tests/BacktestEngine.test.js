const BacktestEngine = require('../src/backtest/BacktestEngine');
const { buildContext } = require('../src/bot/SignalBuilder');

jest.mock('../src/bot/SignalBuilder');
jest.mock('../src/utils/logger', () => ({
  log: jest.fn()
}));

describe('BacktestEngine', () => {
  let mockDataClient;
  let mockGeminiAgent;

  const mockConfig = {
    SYMBOL: 'XAU_USD',
    TIMEFRAME: 'M5',
    CANDLE_COUNT: 5,
    INITIAL_BALANCE: 10000,
    RISK_PER_TRADE: 0.01,
    MIN_CONFIDENCE: 0.7,
    RSI_OVERSOLD: 30,
    RSI_OVERBOUGHT: 70,
    DEFAULT_SL_ATR_MULTIPLIER: 1.0,
    DEFAULT_TP_ATR_MULTIPLIER: 2.5,
    MAX_TRADES_PER_DAY: 1
  };

  const generateMockCandles = (count, startPrice = 2000) => {
    return Array.from({ length: count }, (_, i) => ({
      time: `2026-08-29T10:${i.toString().padStart(2, '0')}:00Z`,
      open: startPrice + i,
      high: startPrice + i + 2,
      low: startPrice + i - 2,
      close: startPrice + i,
      volume: 1000
    }));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDataClient = {
      getCandles: jest.fn()
    };
    mockGeminiAgent = {
      getDecision: jest.fn()
    };
  });

  describe('Edge Cases', () => {
    it('should return empty result when candles are insufficient', async () => {
      mockDataClient.getCandles.mockResolvedValue(generateMockCandles(3));
      const engine = new BacktestEngine({ dataClient: mockDataClient });

      const result = await engine.runRuleBased(mockConfig);

      expect(result.trades).toEqual([]);
      expect(result.logs).toEqual([]);
      expect(result.finalBalance).toBe(10000);
      expect(result.candlesCount).toBe(3);
    });

    it('should handle empty candle array gracefully', async () => {
      mockDataClient.getCandles.mockResolvedValue([]);
      const engine = new BacktestEngine({ dataClient: mockDataClient });

      const result = await engine.runRuleBased(mockConfig);

      expect(result.trades).toEqual([]);
      expect(result.finalBalance).toBe(10000);
      expect(result.candlesCount).toBe(0);
    });
  });

  describe('Rule-based Mode', () => {
    it('should skip trades when no entry rule is met', async () => {
      const candles = generateMockCandles(10);
      mockDataClient.getCandles.mockResolvedValue(candles);

      buildContext.mockReturnValue({
        symbol: 'XAU_USD',
        timeframe: 'M5',
        currentPrice: 2005,
        indicators: {
          ma_cross: 'neutral',
          rsi: 50,
          atr: 2
        }
      });

      const engine = new BacktestEngine({ dataClient: mockDataClient });
      const result = await engine.runRuleBased(mockConfig);

      expect(result.trades.length).toBe(0);
      expect(result.logs.length).toBe(6); // 10 candles - 5 + 1
      expect(result.logs.every(l => l.action === 'skip')).toBe(true);
      expect(result.finalBalance).toBe(10000);
    });

    it('should open BUY position and close on TP when bullish cross & RSI < oversold', async () => {
      const candles = [
        { time: '2026-08-29T10:00:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:01:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:02:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:03:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        // Candle 4 (index 4) - triggers BUY (window size = 5)
        // Entry price: 2000, ATR: 2 -> SL: 2000 - 1.0*2 = 1998, TP: 2000 + 2.5*2 = 2005
        // Risk: 10000 * 0.01 = 100. SL distance: 2. Units = floor(100 / 2) = 50
        { time: '2026-08-29T10:04:00Z', open: 2000, high: 2001, low: 1999, close: 2000, volume: 100 },
        // Candle 5 (index 5) - hits TP (high reaches 2006 >= 2005)
        { time: '2026-08-29T10:05:00Z', open: 2001, high: 2006, low: 2000, close: 2005, volume: 100 },
        // Candle 6 (index 6) - dummy to allow loop to evaluate index 5
        { time: '2026-08-29T10:06:00Z', open: 2005, high: 2005, low: 2005, close: 2005, volume: 100 }
      ];

      mockDataClient.getCandles.mockResolvedValue(candles);

      buildContext.mockReturnValue({
        symbol: 'XAU_USD',
        timeframe: 'M5',
        currentPrice: 2000,
        indicators: {
          h1_trend: 'uptrend',
          ma9: 2005,
          ma21: 1995,
          ma_cross: 'bullish_cross',
          rsi: 25,
          adx: 25,
          atr: 2
        }
      });

      const engine = new BacktestEngine({ dataClient: mockDataClient });
      const result = await engine.runRuleBased(mockConfig);

      expect(result.trades.length).toBe(1);
      const trade = result.trades[0];
      expect(trade.side).toBe('buy');
      expect(trade.entryPrice).toBe(2000);
      expect(trade.exitPrice).toBe(2005);
      expect(trade.exitReason).toBe('tp');
      expect(trade.units).toBe(50);
      expect(trade.profit).toBe(250); // (2005 - 2000) * 50 = 250
      expect(result.finalBalance).toBe(10250);
    });

    it('should open BUY position and close on SL when price drops below stop loss', async () => {
      const candles = [
        { time: '2026-08-29T10:00:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:01:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:02:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:03:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        // Candle 4: Triggers BUY
        { time: '2026-08-29T10:04:00Z', open: 2000, high: 2001, low: 1999, close: 2000, volume: 100 },
        // Candle 5: Drops below SL (low 1996 <= 1997)
        { time: '2026-08-29T10:05:00Z', open: 1999, high: 2000, low: 1996, close: 1997, volume: 100 },
        // Candle 6 (index 6) - dummy to allow loop to evaluate index 5
        { time: '2026-08-29T10:06:00Z', open: 2000, high: 2000, low: 2000, close: 2000, volume: 100 }
      ];

      mockDataClient.getCandles.mockResolvedValue(candles);

      buildContext.mockReturnValue({
        symbol: 'XAU_USD',
        timeframe: 'M5',
        currentPrice: 2000,
        indicators: {
          ma9: 2005,
          ma21: 1995,
          ma_cross: 'bullish_cross',
          rsi: 28,
          atr: 2
        }
      });

      const engine = new BacktestEngine({ dataClient: mockDataClient });
      const result = await engine.runRuleBased(mockConfig);

      expect(result.trades.length).toBe(1);
      const trade = result.trades[0];
      expect(trade.side).toBe('buy');
      expect(trade.exitPrice).toBe(1998);
      expect(trade.exitReason).toBe('sl');
      expect(trade.profit).toBe(-100); // (1998 - 2000) * 50 = -100
      expect(result.finalBalance).toBe(9900);
    });

    it('should open SELL position and close on TP when bearish cross & RSI > overbought', async () => {
      const candles = [
        { time: '2026-08-29T10:00:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:01:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:02:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:03:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        // Candle 4: Triggers SELL. Entry: 2000, ATR: 2 -> SL: 2002, TP: 1995. Units: 50
        { time: '2026-08-29T10:04:00Z', open: 2000, high: 2001, low: 1999, close: 2000, volume: 100 },
        // Candle 5: Hits SELL TP (low reaches 1994 <= 1995)
        { time: '2026-08-29T10:05:00Z', open: 1998, high: 1999, low: 1994, close: 1995, volume: 100 },
        // Candle 6 (index 6) - dummy to allow loop to evaluate index 5
        { time: '2026-08-29T10:06:00Z', open: 2000, high: 2000, low: 2000, close: 2000, volume: 100 }
      ];

      mockDataClient.getCandles.mockResolvedValue(candles);

      buildContext.mockReturnValue({
        symbol: 'XAU_USD',
        timeframe: 'M5',
        currentPrice: 2000,
        indicators: {
          h1_trend: 'downtrend',
          ma9: 1995,
          ma21: 2005,
          ma_cross: 'bearish_cross',
          rsi: 75,
          adx: 25,
          atr: 2
        }
      });

      const engine = new BacktestEngine({ dataClient: mockDataClient });
      const result = await engine.runRuleBased(mockConfig);

      expect(result.trades.length).toBe(1);
      const trade = result.trades[0];
      expect(trade.side).toBe('sell');
      expect(trade.entryPrice).toBe(2000);
      expect(trade.exitPrice).toBe(1995);
      expect(trade.exitReason).toBe('tp');
      expect(trade.profit).toBe(250); // (2000 - 1995) * 50 = 250
      expect(result.finalBalance).toBe(10250);
    });

    it('should never open a second position while one is active', async () => {
      const candles = [
        { time: '2026-08-29T10:00:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:01:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:02:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:03:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        // Candle 4: Triggers BUY (SL: 1998, TP: 2005)
        { time: '2026-08-29T10:04:00Z', open: 2000, high: 2001, low: 1999, close: 2000, volume: 100 },
        // Candle 5: Price neither hits SL nor TP (stays between 1999 and 2002)
        { time: '2026-08-29T10:05:00Z', open: 2000, high: 2002, low: 1999, close: 2001, volume: 100 },
        // Candle 6: Still in position, hits TP
        { time: '2026-08-29T10:06:00Z', open: 2002, high: 2006, low: 2001, close: 2005, volume: 100 }
      ];

      mockDataClient.getCandles.mockResolvedValue(candles);

      buildContext.mockReturnValue({
        symbol: 'XAU_USD',
        timeframe: 'M5',
        currentPrice: 2000,
        indicators: {
          ma9: 2005,
          ma21: 1995,
          ma_cross: 'bullish_cross',
          rsi: 20,
          atr: 2
        }
      });

      const engine = new BacktestEngine({ dataClient: mockDataClient });
      const result = await engine.runRuleBased(mockConfig);

      // buildContext should only be called once when no position is open (candle 4)
      // When position is open on candle 5 and 6, it evaluates position exit instead of building new context
      expect(result.trades.length).toBe(1);
    });
  });

  describe('AI-Simulated Mode', () => {
    it('should execute trade when Gemini returns action with high confidence', async () => {
      const candles = [
        { time: '2026-08-29T10:00:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:01:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:02:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:03:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        // Candle 4: AI triggers BUY
        { time: '2026-08-29T10:04:00Z', open: 2000, high: 2001, low: 1999, close: 2000, volume: 100 },
        // Candle 5: Hits TP
        { time: '2026-08-29T10:05:00Z', open: 2001, high: 2006, low: 2000, close: 2005, volume: 100 },
        // Candle 6: Dummy to allow loop to evaluate index 5
        { time: '2026-08-29T10:06:00Z', open: 2000, high: 2000, low: 2000, close: 2000, volume: 100 }
      ];

      mockDataClient.getCandles.mockResolvedValue(candles);

      buildContext.mockReturnValue({
        symbol: 'XAU_USD',
        timeframe: 'M5',
        currentPrice: 2000,
        indicators: {
          ma_cross: 'bullish_cross',
          rsi: 35,
          atr: 2
        }
      });

      mockGeminiAgent.getDecision.mockResolvedValue({
        action: 'buy',
        confidence: 0.85,
        sl_atr_multiplier: 1.0,
        tp_atr_multiplier: 2.5,
        reason: 'Strong momentum confirmed by AI'
      });

      const engine = new BacktestEngine({
        dataClient: mockDataClient,
        geminiAgent: mockGeminiAgent
      });

      const result = await engine.runAISimulated(mockConfig);

      expect(mockGeminiAgent.getDecision).toHaveBeenCalled();
      expect(result.trades.length).toBe(1);
      expect(result.trades[0].side).toBe('buy');
      expect(result.trades[0].exitReason).toBe('tp');
    });

    it('should skip trade when Gemini confidence is below MIN_CONFIDENCE', async () => {
      const candles = generateMockCandles(10);
      mockDataClient.getCandles.mockResolvedValue(candles);

      buildContext.mockReturnValue({
        symbol: 'XAU_USD',
        timeframe: 'M5',
        currentPrice: 2000,
        indicators: {
          ma_cross: 'bullish_cross',
          rsi: 35,
          atr: 2
        }
      });

      mockGeminiAgent.getDecision.mockResolvedValue({
        action: 'buy',
        confidence: 0.5, // below 0.70 threshold
        sl_atr_multiplier: 1.0,
        tp_atr_multiplier: 2.5,
        reason: 'Uncertain'
      });

      const engine = new BacktestEngine({
        dataClient: mockDataClient,
        geminiAgent: mockGeminiAgent
      });

      const result = await engine.runAISimulated(mockConfig);

      expect(result.trades.length).toBe(0);
      expect(result.finalBalance).toBe(10000);
    });

    it('should safely handle Gemini API failure during backtest simulation', async () => {
      const candles = generateMockCandles(10);
      mockDataClient.getCandles.mockResolvedValue(candles);

      buildContext.mockReturnValue({
        symbol: 'XAU_USD',
        timeframe: 'M5',
        currentPrice: 2000,
        indicators: {
          ma_cross: 'bullish_cross',
          rsi: 35,
          atr: 2
        }
      });

      mockGeminiAgent.getDecision.mockRejectedValue(new Error('Network error'));

      const engine = new BacktestEngine({
        dataClient: mockDataClient,
        geminiAgent: mockGeminiAgent
      });

      const result = await engine.runAISimulated(mockConfig);

      expect(result.trades.length).toBe(0);
      expect(result.logs.some(l => l.action === 'skip')).toBe(true);
    });
  });
});
