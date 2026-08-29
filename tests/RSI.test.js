const { calculate, getZone } = require('../src/indicators/RSI');

describe('RSI Indicator', () => {
  const closePrices = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00];
  const period = 14;

  describe('calculate', () => {
    it('should calculate RSI correctly', () => {
      const result = calculate(closePrices, period);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toBeCloseTo(70.46, 1);
    });

    it('should return empty array if prices length is less than or equal to period', () => {
      const result = calculate([10, 20], 14);
      expect(result).toEqual([]);
    });
  });

  describe('getZone', () => {
    it('should return oversold when rsi < oversold threshold', () => {
      expect(getZone(25)).toBe('oversold');
      expect(getZone(29, 30, 70)).toBe('oversold');
    });

    it('should return overbought when rsi > overbought threshold', () => {
      expect(getZone(75)).toBe('overbought');
      expect(getZone(80, 30, 70)).toBe('overbought');
    });

    it('should return neutral when rsi is between thresholds', () => {
      expect(getZone(50)).toBe('neutral');
      expect(getZone(30)).toBe('neutral'); 
      expect(getZone(70)).toBe('neutral');
    });
  });
});
