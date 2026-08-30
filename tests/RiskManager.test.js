const { calculateUnits } = require('../src/bot/RiskManager');

describe('RiskManager', () => {
  describe('calculateUnits', () => {
    it('should correctly calculate units rounded down to nearest integer', () => {
      // Balance: 10,000, Risk: 1% (0.01) -> Risk Amount: 100
      // SL Distance: 5
      // Units expected: 100 / 5 = 20
      expect(calculateUnits(10000, 0.01, 5)).toBe(20);
      
      // Balance: 10,000, Risk: 1% -> Risk Amount: 100
      // SL Distance: 3
      // Units expected: 100 / 3 = 33.33... -> floored to 33
      expect(calculateUnits(10000, 0.01, 3)).toBe(33);
    });

    it('should return 0 when SL distance is 0 to avoid division by zero', () => {
      expect(calculateUnits(10000, 0.01, 0)).toBe(0);
    });

    it('should return 0 when SL distance is negative', () => {
      expect(calculateUnits(10000, 0.01, -5)).toBe(0);
    });

    it('should return 0 when balance is 0 or negative', () => {
      expect(calculateUnits(0, 0.01, 5)).toBe(0);
      expect(calculateUnits(-1000, 0.01, 5)).toBe(0);
    });

    it('should return 0 when risk percentage is 0 or negative', () => {
      expect(calculateUnits(10000, 0, 5)).toBe(0);
      expect(calculateUnits(10000, -0.01, 5)).toBe(0);
    });
  });
});
