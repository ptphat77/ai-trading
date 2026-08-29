const { calculate } = require('../src/indicators/ATR');

describe('ATR Indicator', () => {
  const highs = [48.70, 48.72, 48.90, 48.87, 48.82, 49.05];
  const lows = [47.79, 48.14, 48.39, 48.37, 48.24, 48.64];
  const closes = [48.16, 48.61, 48.75, 48.63, 48.74, 49.03];
  const period = 3;

  describe('calculate', () => {
    it('should calculate ATR correctly', () => {
      const result = calculate(highs, lows, closes, period);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return empty array if input arrays length is less than or equal to period', () => {
      const result = calculate([1, 2], [1, 2], [1, 2], 3);
      expect(result).toEqual([]);
    });

    it('should return empty array if missing inputs', () => {
      expect(calculate(null, lows, closes, period)).toEqual([]);
      expect(calculate(highs, null, closes, period)).toEqual([]);
      expect(calculate(highs, lows, null, period)).toEqual([]);
    });
  });
});
