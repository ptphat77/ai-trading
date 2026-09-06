const { evaluateRule } = require('../src/strategy/RuleEngine');

describe('RuleEngine', () => {
  const config = {
    DEFAULT_SL_ATR_MULTIPLIER: 1.2,
    DEFAULT_TP_ATR_MULTIPLIER: 1.8,
    ADX_THRESHOLD: 20,
    RSI_BUY_MIN: 40,
    RSI_BUY_MAX: 65,
    RSI_SELL_MIN: 35,
    RSI_SELL_MAX: 60,
    MAX_DISTANCE_TO_MA_ATR: 1.2,
    RSI_OVERSOLD: 30,
    RSI_OVERBOUGHT: 70,
  };

  const createBaseContext = () => ({
    currentPrice: 2000,
    indicators: {
      rsi: 50,
      adx: 25,
      ma_cross: 'none',
      h1_trend: 'neutral',
      candle_body: 'bullish',
      candle_wick_rejection: 'none',
      distance_to_ma21_atr: 0.5,
      atr: 2
    }
  });

  it('BUY rule: should return buy when conditions are met', () => {
    const context = createBaseContext();
    context.indicators.h1_trend = 'uptrend';
    context.indicators.ma_cross = 'bullish_cross';
    context.indicators.rsi = 50;

    const result = evaluateRule(context, config);
    expect(result.action).toBe('buy');
    expect(result.confidence).toBe(1.0);
  });

  it('SELL rule: should return sell when conditions are met', () => {
    const context = createBaseContext();
    context.indicators.h1_trend = 'downtrend';
    context.indicators.ma_cross = 'bearish_cross';
    context.indicators.rsi = 45;
    context.indicators.candle_body = 'bearish';

    const result = evaluateRule(context, config);
    expect(result.action).toBe('sell');
    expect(result.confidence).toBe(1.0);
  });

  it('ADX filter: should skip if ADX <= threshold', () => {
    const context = createBaseContext();
    context.indicators.adx = 15;
    context.indicators.h1_trend = 'uptrend';
    context.indicators.ma_cross = 'bullish_cross';
    context.indicators.rsi = 50;

    const result = evaluateRule(context, config);
    expect(result.action).toBe('skip');
    expect(result.reason).toMatch(/ADX/);
  });

  it('H1 trend mismatch: should skip uptrend + bearish_cross', () => {
    const context = createBaseContext();
    context.indicators.h1_trend = 'uptrend';
    context.indicators.ma_cross = 'bearish_cross';
    context.indicators.candle_body = 'bearish';

    const result = evaluateRule(context, config);
    expect(result.action).toBe('skip');
  });

  it('RSI out of zone: should skip if RSI > rsiBuyMax', () => {
    const context = createBaseContext();
    context.indicators.h1_trend = 'uptrend';
    context.indicators.ma_cross = 'bullish_cross';
    context.indicators.rsi = 70; // > 65

    const result = evaluateRule(context, config);
    expect(result.action).toBe('skip');
  });

  it('Oversold fallback: RSI < 30 + bullish_cross should buy', () => {
    const context = createBaseContext();
    context.indicators.h1_trend = 'downtrend'; // Not matching MTF
    context.indicators.ma_cross = 'bullish_cross';
    context.indicators.rsi = 25; // < 30

    const result = evaluateRule(context, config);
    expect(result.action).toBe('buy');
    expect(result.reason).toMatch(/Oversold/);
  });
});
