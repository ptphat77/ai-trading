const { buildContext } = require('../src/bot/SignalBuilder');
const UTBot = require('../src/indicators/UTBot');
const STC = require('../src/indicators/STC');
const ATR = require('../src/indicators/ATR');
const RSI = require('../src/indicators/RSI');
const MA = require('../src/indicators/MA');

jest.mock('../src/indicators/UTBot');
jest.mock('../src/indicators/STC');
jest.mock('../src/indicators/ATR');
jest.mock('../src/indicators/RSI');
jest.mock('../src/indicators/MA');

describe('SignalBuilder', () => {
  const mockConfig = {
    SYMBOL: 'XAU_USD',
    TIMEFRAME: 'M5',
    UTBOT1_KEY: 2,
    UTBOT1_ATR_PERIOD: 1,
    UTBOT2_KEY: 2,
    UTBOT2_ATR_PERIOD: 300,
    STC_LENGTH: 80,
    STC_FAST_LENGTH: 27,
    STC_SLOW_LENGTH: 50,
    STC_FACTOR: 0.5,
    ATR_PERIOD: 14,
    RSI_PERIOD: 14,
    EMA_PERIOD: 200
  };

  const generateMockCandles = (count) => {
    return Array.from({ length: count }, (_, i) => ({
      time: `2026-08-29T10:${i.toString().padStart(2, '0')}:00Z`,
      open: 2350 + i,
      high: 2352 + i,
      low: 2348 + i,
      close: 2351 + i,
      volume: 1000 + i * 10
    }));
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('buildContext', () => {
    it('should return null if there are not enough candles', () => {
      const candles = generateMockCandles(10); 
      const result = buildContext(candles, mockConfig);
      
      expect(result).toBeNull();
    });

    it('should build the correct context object when there are enough candles', () => {
      const candles = generateMockCandles(100);
      
      // Mock implementations for indicators
      UTBot.calculate.mockImplementation((highs, lows, closes, key, period) => {
        if (period === 1) return { stopLine: [], positions: [], signals: Array(closes.length).fill('sell') };
        if (period === 300) return { stopLine: [], positions: [], signals: Array(closes.length).fill('buy') };
        return { stopLine: [], positions: [], signals: [] };
      });
      
      STC.calculate.mockReturnValue(Array(candles.length).fill(45.5));
      ATR.calculate.mockReturnValue(Array(candles.length).fill(1.85));
      RSI.calculate.mockReturnValue(Array(candles.length).fill(55.0));
      MA.calculateEMA.mockReturnValue(Array(candles.length).fill(2300));

      const result = buildContext(candles, mockConfig);

      // Verify the indicators were called correctly
      expect(UTBot.calculate).toHaveBeenCalledTimes(2);
      expect(STC.calculate).toHaveBeenCalledTimes(1);
      expect(ATR.calculate).toHaveBeenCalledTimes(1);

      // Verify the output matches the expected schema
      expect(result).toEqual({
        symbol: 'XAU_USD',
        timeframe: 'M5',
        currentPrice: candles[99].close,
        indicators: {
          utbot1_signal: 'sell',
          utbot2_signal: 'buy',
          stc_current: 45.5,
          stc_prev: 45.5,
          atr: 1.85,
          rsi_current: 55,
          ema_trend: 2300,
          candle_body: 'bullish',
          candle_wick_rejection: 'none',
          body_to_atr_ratio: 0.54,
          recent_swing_high: 2451,
          recent_swing_low: 2398
        },
        recentCandles: candles.slice(-5)
      });
    });
  });
});
