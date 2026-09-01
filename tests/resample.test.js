const { resampleToH1, evaluateH1Trend } = require('../src/utils/resample');

describe('resample utility', () => {
  it('should return empty array for empty inputs', () => {
    expect(resampleToH1([])).toEqual([]);
    expect(resampleToH1(null)).toEqual([]);
  });

  it('should resample M5 candles within the same hour into a single H1 candle', () => {
    const m5Candles = [
      { time: '2026-08-31T09:00:00.000Z', open: 2500, high: 2505, low: 2498, close: 2502, volume: 100 },
      { time: '2026-08-31T09:05:00.000Z', open: 2502, high: 2510, low: 2501, close: 2508, volume: 150 },
      { time: '2026-08-31T09:55:00.000Z', open: 2508, high: 2512, low: 2504, close: 2511, volume: 200 },
      { time: '2026-08-31T10:00:00.000Z', open: 2511, high: 2515, low: 2509, close: 2514, volume: 120 }
    ];

    const h1 = resampleToH1(m5Candles);
    expect(h1.length).toBe(2);

    const firstHour = h1[0];
    expect(firstHour.time).toBe('2026-08-31T09:00:00.000Z');
    expect(firstHour.open).toBe(2500);
    expect(firstHour.high).toBe(2512);
    expect(firstHour.low).toBe(2498);
    expect(firstHour.close).toBe(2511);
    expect(firstHour.volume).toBe(450);
  });

  describe('evaluateH1Trend', () => {
    it('should return neutral if not enough H1 candles', () => {
      const h1Candles = Array.from({ length: 50 }, (_, i) => ({ close: 2500 + i }));
      const result = evaluateH1Trend(h1Candles, 2550, 50, 200);
      expect(result.trend).toBe('neutral');
    });

    it('should identify uptrend when price > EMA200 and EMA50 > EMA200', () => {
      const count = 250;
      // Steadily rising closes
      const h1Candles = Array.from({ length: count }, (_, i) => ({ close: 2000 + i * 2 }));
      const result = evaluateH1Trend(h1Candles, 2600, 50, 200);
      expect(result.trend).toBe('uptrend');
      expect(result.emaFast).toBeGreaterThan(result.emaSlow);
    });

    it('should identify downtrend when price < EMA200 and EMA50 < EMA200', () => {
      const count = 250;
      // Steadily declining closes
      const h1Candles = Array.from({ length: count }, (_, i) => ({ close: 3000 - i * 2 }));
      const result = evaluateH1Trend(h1Candles, 2400, 50, 200);
      expect(result.trend).toBe('downtrend');
      expect(result.emaFast).toBeLessThan(result.emaSlow);
    });
  });
});
