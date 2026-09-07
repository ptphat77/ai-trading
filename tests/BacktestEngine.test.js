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
    STC_GREEN_LINE: 25,
    STC_RED_LINE: 75,
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
          utbot1_signal: null,
          utbot2_signal: null,
          stc_current: 50,
          stc_prev: 50,
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

    it('should open BUY position and close on TP when UTBot 2 Buy and STC < 25 moving up', async () => {
      const candles = [
        { time: '2026-08-29T10:00:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:01:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:02:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:03:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        // Candle 4 (index 4) - triggers BUY (window size = 5)
        // Entry price: 2000, ATR: 2. Swing low = 1998. SL dist: (2000 - 1998) + 0.15*2 = 2.3. Limited to max 1.15*2 = 2.3. TP dist: 2.3 * 2 = 4.6.
        // Risk: 10000 * 0.01 = 100. SL distance: 2.3. Units = floor(100 / 2.3) = 43
        { time: '2026-08-29T10:04:00Z', open: 2000, high: 2001, low: 1999, close: 2000, volume: 100 },
        // Candle 5 (index 5) - hits TP (high reaches 2006 >= 2004.6)
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
          utbot2_signal: 'buy',
          stc_prev: 15,
          stc_current: 20,
          recent_swing_low: 1998,
          atr: 2,
          candle_body: 'bullish',
          candle_wick_rejection: 'none',
          body_to_atr_ratio: 0.5
        }
      });

      const engine = new BacktestEngine({ dataClient: mockDataClient });
      const result = await engine.runRuleBased(mockConfig);

      expect(result.trades.length).toBe(1);
      const trade = result.trades[0];
      expect(trade.side).toBe('buy');
      expect(trade.entryPrice).toBe(2000);
      expect(trade.exitReason).toBe('tp');
      // SL calculation: swing dist = 2. SL = 2 + 0.15*2 = 2.3. ATR=2. min=1.7, max=2.3. SL_dist = 2.3.
      // TP = 2.3 * 2.0 = 4.6. TP price = 2004.6
      expect(trade.exitPrice).toBe(2004.6);
      expect(trade.units).toBe(43); 
      // profit = 4.6 * 43 = 197.8
      expect(trade.profit).toBeCloseTo(197.8); 
    });

    it('should open BUY position and close on SL when price drops below stop loss', async () => {
      const candles = [
        { time: '2026-08-29T10:00:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:01:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:02:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:03:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        // Candle 4: Triggers BUY
        { time: '2026-08-29T10:04:00Z', open: 2000, high: 2001, low: 1999, close: 2000, volume: 100 },
        // Candle 5: Drops below SL (low 1996 <= 1997.7) SL is 2000 - 2.3 = 1997.7
        { time: '2026-08-29T10:05:00Z', open: 1999, high: 2000, low: 1996, close: 1997, volume: 100 },
        // Candle 6
        { time: '2026-08-29T10:06:00Z', open: 2000, high: 2000, low: 2000, close: 2000, volume: 100 }
      ];

      mockDataClient.getCandles.mockResolvedValue(candles);

      buildContext.mockReturnValue({
        symbol: 'XAU_USD',
        timeframe: 'M5',
        currentPrice: 2000,
        indicators: {
          utbot2_signal: 'buy',
          stc_prev: 15,
          stc_current: 20,
          recent_swing_low: 1998,
          atr: 2,
          candle_body: 'bullish',
          candle_wick_rejection: 'none'
        }
      });

      const engine = new BacktestEngine({ dataClient: mockDataClient });
      const result = await engine.runRuleBased(mockConfig);

      expect(result.trades.length).toBe(1);
      const trade = result.trades[0];
      expect(trade.side).toBe('buy');
      expect(trade.exitPrice).toBe(1997.7);
      expect(trade.exitReason).toBe('sl');
      // units = 43, profit = (1997.7 - 2000) * 43 = -98.9
      expect(trade.profit).toBeCloseTo(-98.9);
    });

    it('should open SELL position and close on TP when UTBot 1 Sell & STC > 75 moving down', async () => {
      const candles = [
        { time: '2026-08-29T10:00:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:01:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:02:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:03:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        // Candle 4: Triggers SELL. Entry: 2000, ATR: 2, swing high: 2002. SL dist: 2+0.15*2=2.3. TP dist: 4.6. Units: 43
        { time: '2026-08-29T10:04:00Z', open: 2000, high: 2001, low: 1999, close: 2000, volume: 100 },
        // Candle 5: Hits SELL TP (low reaches 1994 <= 1995.4)
        { time: '2026-08-29T10:05:00Z', open: 1998, high: 1999, low: 1994, close: 1995, volume: 100 },
        { time: '2026-08-29T10:06:00Z', open: 2000, high: 2000, low: 2000, close: 2000, volume: 100 }
      ];

      mockDataClient.getCandles.mockResolvedValue(candles);

      buildContext.mockReturnValue({
        symbol: 'XAU_USD',
        timeframe: 'M5',
        currentPrice: 2000,
        indicators: {
          utbot1_signal: 'sell',
          stc_prev: 85,
          stc_current: 80,
          recent_swing_high: 2002,
          atr: 2,
          candle_body: 'bearish',
          candle_wick_rejection: 'none'
        }
      });

      const engine = new BacktestEngine({ dataClient: mockDataClient });
      const result = await engine.runRuleBased(mockConfig);

      expect(result.trades.length).toBeGreaterThanOrEqual(1);
      const trade = result.trades[0];
      expect(trade.side).toBe('sell');
      expect(trade.entryPrice).toBe(2000);
      expect(trade.exitPrice).toBe(1995.4);
      expect(trade.exitReason).toBe('tp');
      expect(trade.profit).toBeCloseTo(197.8); 
    });

    it('should never open a second position while one is active', async () => {
      const candles = [
        { time: '2026-08-29T10:00:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:01:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:02:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        { time: '2026-08-29T10:03:00Z', open: 2000, high: 2002, low: 1998, close: 2000, volume: 100 },
        // Candle 4: Triggers BUY
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
          utbot2_signal: 'buy',
          stc_prev: 15,
          stc_current: 20,
          recent_swing_low: 1998,
          atr: 2,
          candle_body: 'bullish',
          candle_wick_rejection: 'none'
        }
      });

      const engine = new BacktestEngine({ dataClient: mockDataClient });
      const result = await engine.runRuleBased(mockConfig);

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
        { time: '2026-08-29T10:04:00Z', open: 2000, high: 2001, low: 1999, close: 2000, volume: 100 },
        { time: '2026-08-29T10:05:00Z', open: 2001, high: 2006, low: 2000, close: 2005, volume: 100 },
        { time: '2026-08-29T10:06:00Z', open: 2000, high: 2000, low: 2000, close: 2000, volume: 100 }
      ];

      mockDataClient.getCandles.mockResolvedValue(candles);

      buildContext.mockReturnValue({
        symbol: 'XAU_USD',
        timeframe: 'M5',
        currentPrice: 2000,
        indicators: {
          utbot2_signal: 'buy',
          stc_prev: 15,
          stc_current: 20,
          recent_swing_low: 1998,
          atr: 2
        }
      });

      mockGeminiAgent.getDecision.mockResolvedValue({
        action: 'buy',
        confidence: 0.85,
        sl_atr_multiplier: 1.15,
        tp_atr_multiplier: 2.3,
        reason: 'Strong momentum confirmed by AI'
      });

      const engine = new BacktestEngine({
        dataClient: mockDataClient,
        geminiAgent: mockGeminiAgent
      });

      const result = await engine.runAISimulated(mockConfig);

      expect(mockGeminiAgent.getDecision).toHaveBeenCalled();
      expect(result.trades.length).toBeGreaterThanOrEqual(1);
      expect(result.trades[0].side).toBe('buy');
      expect(result.trades[0].exitReason).toBe('tp');
    });

    it('should safely handle Gemini API failure during backtest simulation', async () => {
      const candles = generateMockCandles(10);
      mockDataClient.getCandles.mockResolvedValue(candles);

      buildContext.mockReturnValue({
        symbol: 'XAU_USD',
        timeframe: 'M5',
        currentPrice: 2000,
        indicators: {
          utbot2_signal: 'buy',
          stc_prev: 15,
          stc_current: 20,
          recent_swing_low: 1998,
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
