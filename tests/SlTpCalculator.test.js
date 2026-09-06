const { calculateDynamicSlTp } = require('../src/strategy/SlTpCalculator');

describe('SlTpCalculator', () => {
  const config = {
    SL_ATR_BUFFER: 0.15,
    MIN_SL_ATR: 0.85,
    MAX_SL_ATR: 1.15
  };

  const createBaseContext = () => ({
    currentPrice: 2000,
    indicators: {
      atr: 2,
      adx: 20,
      local_swing_high: 2005,
      local_swing_low: 1995
    }
  });

  it('BUY: SL below swing low + buffer', () => {
    const context = createBaseContext();
    // swingDist = 2000 - 1995 = 5. rawSl = 5 + 0.15*2 = 5.3
    // maxSl = 1.15 * 2 = 2.3. minSl = 0.85 * 2 = 1.7. 
    // SL should be capped at maxSl = 2.3
    const result = calculateDynamicSlTp('buy', context, config, 1.2, 1.8);
    expect(result.slDistance).toBe(2.3);
  });

  it('SELL: SL above swing high + buffer', () => {
    const context = createBaseContext();
    // swingDist = 2005 - 2000 = 5. rawSl = 5 + 0.15*2 = 5.3
    // capped at 2.3
    const result = calculateDynamicSlTp('sell', context, config, 1.2, 1.8);
    expect(result.slDistance).toBe(2.3);
  });

  it('ADX >= 35 should yield rrRatio = 2.0', () => {
    const context = createBaseContext();
    context.indicators.adx = 40;
    const result = calculateDynamicSlTp('buy', context, config, 1.2, 1.8);
    expect(result.rrRatio).toBe(2.0);
    expect(result.tpDistance).toBe(result.slDistance * 2.0);
  });

  it('TP always >= SL distance', () => {
    const context = createBaseContext();
    context.indicators.adx = 10; // rrRatio = 1.5
    // But if somehow rrRatio is forced below 1, it should clamp. In code rrRatio is minimum 1.5, so TP is always >= SL.
    const result = calculateDynamicSlTp('buy', context, config, 1.2, 1.8);
    expect(result.tpDistance).toBeGreaterThanOrEqual(result.slDistance);
  });
});
