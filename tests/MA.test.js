const { calculateSMA, calculateEMA, getCrossSignal } = require('../src/indicators/MA');

describe('MA Indicator', () => {
  const closePrices = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const period = 3;

  describe('calculateSMA', () => {
    it('should calculate SMA correctly', () => {
      const result = calculateSMA(closePrices, period);
      expect(result.length).toBe(closePrices.length - period + 1);
      expect(result[0]).toBe(11);
      expect(result[result.length - 1]).toBe(19);
    });

    it('should return empty array if prices length is less than period', () => {
      const result = calculateSMA([10, 20], 3);
      expect(result).toEqual([]);
    });

    it('should return empty array if prices is null or undefined', () => {
      expect(calculateSMA(null, 3)).toEqual([]);
      expect(calculateSMA(undefined, 3)).toEqual([]);
    });
  });

  describe('calculateEMA', () => {
    it('should calculate EMA correctly', () => {
      const result = calculateEMA(closePrices, period);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('getCrossSignal', () => {
    it('should return bullish_cross when short crosses above long', () => {
      expect(getCrossSignal(10, 15, 12, 12)).toBe('bullish_cross');
      expect(getCrossSignal(12, 15, 12, 12)).toBe('bullish_cross');
    });

    it('should return bearish_cross when short crosses below long', () => {
      expect(getCrossSignal(15, 10, 12, 12)).toBe('bearish_cross');
      expect(getCrossSignal(12, 10, 12, 12)).toBe('bearish_cross');
    });

    it('should return neutral when no cross occurs', () => {
      expect(getCrossSignal(15, 15, 12, 12)).toBe('neutral');
      expect(getCrossSignal(10, 10, 12, 12)).toBe('neutral');
    });
  });
});
