const { buildContext } = require('../src/bot/SignalBuilder');
const MA = require('../src/indicators/MA');
const RSI = require('../src/indicators/RSI');
const ATR = require('../src/indicators/ATR');

jest.mock('../src/indicators/MA');
jest.mock('../src/indicators/RSI');
jest.mock('../src/indicators/ATR');

describe('SignalBuilder', () => {
  const mockConfig = {
    SYMBOL: 'XAU_USD',
    TIMEFRAME: 'M5',
    MA_FAST_PERIOD: 9,
    MA_SLOW_PERIOD: 21,
    RSI_PERIOD: 14,
    RSI_OVERSOLD: 30,
    RSI_OVERBOUGHT: 70,
    ATR_PERIOD: 14
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
      // requires max(9, 21, 14, 14) = 21 candles
      const candles = generateMockCandles(20); 
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
      
      RSI.calculate.mockReturnValue(Array(candles.length).fill(32.5));
      RSI.getZone.mockReturnValue('neutral');
      
      ATR.calculate.mockReturnValue(Array(candles.length).fill(1.85));

      const result = buildContext(candles, mockConfig);

      // Verify the indicators were called correctly
      expect(MA.calculateEMA).toHaveBeenCalledTimes(2);
      expect(MA.getCrossSignal).toHaveBeenCalledWith(2348.20, 2348.20, 2345.80, 2345.80);
      expect(RSI.calculate).toHaveBeenCalledTimes(1);
      expect(RSI.getZone).toHaveBeenCalledWith(32.5, 30, 70);
      expect(ATR.calculate).toHaveBeenCalledTimes(1);

      // Verify the output matches the expected schema
      expect(result).toEqual({
        symbol: 'XAU_USD',
        timeframe: 'M5',
        currentPrice: candles[24].close, // latest candle
        indicators: {
          ma9: 2348.20,
          ma21: 2345.80,
          rsi: 32.5,
          atr: 1.85,
          ma_cross: 'bullish_cross',
          rsi_zone: 'neutral',
          rsi_touched_oversold: false,
          rsi_touched_overbought: false,
          candle_close_vs_ma21: 'above'
        },
        recentCandles: candles.slice(-5)
      });
    });
  });
});
