const { calculate, calculateValues } = require('../src/indicators/ADX');

describe('ADX Indicator', () => {
  const period = 14;
  const count = 40;
  const highs = Array.from({ length: count }, (_, i) => 100 + i * 1.5 + Math.sin(i));
  const lows = Array.from({ length: count }, (_, i) => 95 + i * 1.5 - Math.sin(i));
  const closes = Array.from({ length: count }, (_, i) => 98 + i * 1.5);

  describe('calculate', () => {
    it('should calculate ADX correctly with valid inputs', () => {
      const result = calculate(highs, lows, closes, period);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('adx');
      expect(result[0]).toHaveProperty('pdi');
      expect(result[0]).toHaveProperty('mdi');
      expect(typeof result[0].adx).toBe('number');
    });

    it('should return empty array if input length is insufficient (<= 2 * period)', () => {
      const shortHighs = [10, 11, 12];
      const shortLows = [9, 10, 11];
      const shortCloses = [9.5, 10.5, 11.5];
      expect(calculate(shortHighs, shortLows, shortCloses, 14)).toEqual([]);
    });

    it('should return empty array on null or undefined inputs', () => {
      expect(calculate(null, lows, closes, period)).toEqual([]);
      expect(calculate(highs, null, closes, period)).toEqual([]);
      expect(calculate(highs, lows, null, period)).toEqual([]);
    });
  });

  describe('calculateValues', () => {
    it('should return only numeric ADX values', () => {
      const values = calculateValues(highs, lows, closes, period);
      expect(values.length).toBeGreaterThan(0);
      expect(typeof values[0]).toBe('number');
    });
  });
});
