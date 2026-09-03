const fs = require('fs');
const path = require('path');
const { exportTradeLog } = require('../src/backtest/TradeLogExporter');
const globalConfig = require('../src/config');

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn()
}));

// Mock console to avoid noisy logs during test
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;

beforeAll(() => {
  console.log = jest.fn();
  console.warn = jest.fn();
});

afterAll(() => {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
});

describe('TradeLogExporter', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const mockCandles = [
    { time: '2025-01-01T10:00:00Z', low: 100, high: 110 },
    { time: '2025-01-01T10:05:00Z', low: 95, high: 115 }, // Buy SL=90 TP=115 -> Win at index 1
    { time: '2025-01-01T10:10:00Z', low: 85, high: 120 }  // Buy SL=90 TP=115 -> Loss at index 2 if starting from 1
  ];

  it('should return null and skip export if mode is not ai-simulated', () => {
    const result = exportTradeLog({ mode: 'rule-based' });
    expect(result).toBeNull();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('should export detailed JSON log when mode is ai-simulated', () => {
    // arrange
    const backtestResult = {
      mode: 'ai-simulated',
      initialBalance: 100000,
      allCandles: mockCandles,
      trades: [
        { id: 'trade_1', units: 100, profit: 500 }
      ],
      logs: [
        {
          isRuleSignal: true,
          timestamp: '2025-01-01T10:00:00Z',
          entryPrice: 105,
          candleIdx: 0,
          ruleBasedAction: 'buy',
          ruleBasedReason: 'MACD crossover',
          ruleSl: 90,
          ruleTp: 115,
          // AI stuff
          aiAction: 'buy',
          aiConfidence: 0.85,
          aiAccepted: true,
          aiReason: 'Looks good',
          aiSl: 90,
          aiTp: 115,
          aiOutcome: 'win',
          aiProfit: 500,
          aiExitPrice: 115,
          aiExitTime: '2025-01-01T10:05:00Z',
          aiExitReason: 'tp',
          tradeId: 'trade_1'
        },
        {
          isRuleSignal: true,
          timestamp: '2025-01-01T10:05:00Z',
          entryPrice: 110,
          candleIdx: 1,
          ruleBasedAction: 'buy',
          ruleBasedReason: 'RSI oversold',
          ruleSl: 90, // Loss at candle 2 (low: 85)
          ruleTp: 130,
          // AI stuff
          aiAction: 'skip',
          aiConfidence: 0.5,
          aiAccepted: false,
          aiReason: 'Too risky',
          tradeId: null
        }
      ]
    };

    fs.existsSync.mockReturnValue(true);

    // act
    const outputPath = exportTradeLog(backtestResult, { SYMBOL: 'TEST', TIMEFRAME: 'M5', AI_PROVIDER: 'gemini' }, { silent: true });

    // assert
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    
    // Extract JSON payload written to fs
    const writeCallArgs = fs.writeFileSync.mock.calls[0];
    const writtenJson = JSON.parse(writeCallArgs[1]);

    // Check meta
    expect(writtenJson.meta.symbol).toBe('TEST (M5)');
    expect(writtenJson.meta.ai_provider).toBe('gemini');

    // Check 3-way comparison summary
    expect(writtenJson.summary.three_way_comparison.all_rule_signals.total_signals).toBe(2);
    expect(writtenJson.summary.three_way_comparison.all_rule_signals.winning_signals).toBe(1); // Signal 1 wins
    expect(writtenJson.summary.three_way_comparison.all_rule_signals.losing_signals).toBe(1); // Signal 2 loses

    // AI Accepted Actual (Trade 1)
    expect(writtenJson.summary.three_way_comparison.ai_accepted_actual.total_trades).toBe(1);
    expect(writtenJson.summary.three_way_comparison.ai_accepted_actual.net_profit).toBe(500);

    // Filter Quality
    expect(writtenJson.summary.ai_filter_quality.total_rule_signals).toBe(2);
    expect(writtenJson.summary.ai_filter_quality.ai_accepted_count).toBe(1);
    expect(writtenJson.summary.ai_filter_quality.ai_rejected_count).toBe(1);
    expect(writtenJson.summary.ai_filter_quality.avoided_losses_true_negative).toBe(1); // Rejected a loss
    expect(writtenJson.summary.ai_filter_quality.missed_wins_false_negative).toBe(0); 
    expect(writtenJson.summary.execution_engine_impact.ruined_win_by_engine).toBe(0);
    expect(writtenJson.summary.execution_engine_impact.saved_loss_by_engine).toBe(0);

    // Check signals array
    expect(writtenJson.signals).toHaveLength(2);
    expect(writtenJson.signals[0].rule_based.outcome).toBe('win');
    expect(writtenJson.signals[0].ai.accepted).toBe(true);
    
    expect(writtenJson.signals[1].rule_based.outcome).toBe('loss');
    expect(writtenJson.signals[1].ai.accepted).toBe(false);

    expect(outputPath).toContain('logs');
  });

  it('should gracefully handle missing fs dir creation', () => {
    fs.existsSync.mockReturnValue(false); // Simulate logs dir does not exist
    
    exportTradeLog({ mode: 'ai-simulated' }, {}, { silent: true });

    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('logs'), { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalled();
  });
});
