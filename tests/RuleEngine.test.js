const { evaluateRule } = require('../src/strategy/RuleEngine');

describe('RuleEngine', () => {
  const config = {
    STC_GREEN_LINE: 25,
    STC_RED_LINE: 75,
  };

  const createBaseContext = () => ({
    currentPrice: 2000,
    indicators: {
      utbot1_signal: null,
      utbot2_signal: null,
      stc_current: 50,
      stc_prev: 50,
      atr: 2
    }
  });

  it('should skip when STC is null (warming up)', () => {
    const context = createBaseContext();
    context.indicators.stc_current = null;
    
    const result = evaluateRule(context, config);
    expect(result.action).toBe('skip');
    expect(result.reason).toMatch(/warming up/);
  });

  it('BUY rule: should return buy when UTBot 2 Buy and STC < 25 and moving up', () => {
    const context = createBaseContext();
    context.indicators.utbot2_signal = 'buy';
    context.indicators.stc_prev = 10;
    context.indicators.stc_current = 20; // < 25 and moving up
    
    const result = evaluateRule(context, config);
    expect(result.action).toBe('buy');
    expect(result.confidence).toBe(1.0);
  });

  it('SELL rule: should return sell when UTBot 1 Sell and STC > 75 and moving down', () => {
    const context = createBaseContext();
    context.indicators.utbot1_signal = 'sell';
    context.indicators.stc_prev = 90;
    context.indicators.stc_current = 80; // > 75 and moving down
    
    const result = evaluateRule(context, config);
    expect(result.action).toBe('sell');
    expect(result.confidence).toBe(1.0);
  });

  it('should skip BUY if STC is moving down', () => {
    const context = createBaseContext();
    context.indicators.utbot2_signal = 'buy';
    context.indicators.stc_prev = 20;
    context.indicators.stc_current = 10; // < 25 but moving down
    
    const result = evaluateRule(context, config);
    expect(result.action).toBe('skip');
  });

  it('should skip BUY if STC is above green line', () => {
    const context = createBaseContext();
    context.indicators.utbot2_signal = 'buy';
    context.indicators.stc_prev = 30;
    context.indicators.stc_current = 40; // moving up but > 25
    
    const result = evaluateRule(context, config);
    expect(result.action).toBe('skip');
  });

  it('should skip SELL if STC is moving up', () => {
    const context = createBaseContext();
    context.indicators.utbot1_signal = 'sell';
    context.indicators.stc_prev = 80;
    context.indicators.stc_current = 90; // > 75 but moving up
    
    const result = evaluateRule(context, config);
    expect(result.action).toBe('skip');
  });

  it('should skip SELL if STC is below red line', () => {
    const context = createBaseContext();
    context.indicators.utbot1_signal = 'sell';
    context.indicators.stc_prev = 70;
    context.indicators.stc_current = 60; // moving down but < 75
    
    const result = evaluateRule(context, config);
    expect(result.action).toBe('skip');
  });
});
