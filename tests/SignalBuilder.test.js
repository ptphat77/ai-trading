const { buildContext } = require('../src/bot/SignalBuilder');
const MA = require('../src/indicators/MA');
const RSI = require('../src/indicators/RSI');
const ATR = require('../src/indicators/ATR');
const ADX = require('../src/indicators/ADX');

jest.mock('../src/indicators/MA');
jest.mock('../src/indicators/RSI');
jest.mock('../src/indicators/ATR');
jest.mock('../src/indicators/ADX');

describe('SignalBuilder', () => {
  const mockConfig = {
    SYMBOL: 'XAU_USD',
    TIMEFRAME: 'M5',
    MA_FAST_PERIOD: 9,
    MA_SLOW_PERIOD: 21,
    RSI_PERIOD: 9,
    RSI_OVERSOLD: 35,
    RSI_OVERBOUGHT: 65,
    ATR_PERIOD: 14,
    ADX_PERIOD: 14,
    ADX_THRESHOLD: 20
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
      const candles = generateMockCandles(25);
      
      // Mock implementations for indicators
      MA.calculateEMA.mockImplementation((prices, period) => {
        if (period === 9) return Array(prices.length).fill(2348.20);
        if (period === 21) return Array(prices.length).fill(2345.80);
        return [];
      });
      MA.calculateSMA.mockImplementation((prices, period) => {
        if (period === 9) return Array(prices.length).fill(2348.20);
        if (period === 21) return Array(prices.length).fill(2345.80);
        return [];
      });
      MA.getCrossSignal.mockReturnValue('bullish_cross');
      
      RSI.calculate.mockReturnValue(Array(candles.length).fill(45.5));
      RSI.getZone.mockReturnValue('neutral');
      
      ATR.calculate.mockReturnValue(Array(candles.length).fill(1.85));
      ADX.calculate.mockReturnValue(Array(candles.length).fill({ adx: 25.4, pdi: 30, mdi: 15 }));

      const result = buildContext(candles, mockConfig);

      // Verify the indicators were called correctly
      expect(MA.calculateEMA).toHaveBeenCalled();
      expect(RSI.calculate).toHaveBeenCalledTimes(1);
      expect(ATR.calculate).toHaveBeenCalledTimes(1);
      expect(ADX.calculate).toHaveBeenCalledTimes(1);

      // Verify the output matches the expected schema
      expect(result).toEqual({
        symbol: 'XAU_USD',
        timeframe: 'M5',
        currentPrice: candles[24].close,
        indicators: {
          ma_fast: 2348.20,
          ma_slow: 2345.80,
          ma9: 2348.20,
          ma21: 2345.80,
          rsi: 45.5,
          adx: 25.4,
          adx_trending: true,
          atr: 1.85,
          ma_cross: 'bullish_cross',
          rsi_zone: 'neutral',
          rsi_touched_oversold: false,
          rsi_touched_overbought: false,
          candle_close_vs_ma21: 'above',
          candle_close_vs_ma_slow: 'above',
          h1_trend: 'neutral',
          h1_ema50: null,
          h1_ema200: null
        },
        recentCandles: candles.slice(-5)
      });
    });
  });
});
