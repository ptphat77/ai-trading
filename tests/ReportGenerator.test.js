const fs = require('fs');
const path = require('path');
const { calculateMetrics, generateReport } = require('../src/backtest/ReportGenerator');

jest.mock('fs');
jest.mock('../src/utils/logger', () => ({
  log: jest.fn()
}));

describe('ReportGenerator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateMetrics', () => {
    it('should calculate metrics correctly for mixed winning and losing trades', () => {
      const mockResult = {
        mode: 'rule-based',
        initialBalance: 10000,
        finalBalance: 10200,
        trades: [
          { profit: 150, profitPercent: 0.015, entryTime: '2026-08-01T10:00:00Z', exitTime: '2026-08-01T10:30:00Z' },
          { profit: -50, profitPercent: -0.005, entryTime: '2026-08-01T11:00:00Z', exitTime: '2026-08-01T11:15:00Z' },
          { profit: 150, profitPercent: 0.015, entryTime: '2026-08-02T14:00:00Z', exitTime: '2026-08-02T14:45:00Z' },
          { profit: -50, profitPercent: -0.005, entryTime: '2026-08-03T09:00:00Z', exitTime: '2026-08-03T09:20:00Z' }
        ],
        logs: [
          {
            timestamp: '2026-08-01T10:00:00Z',
            gemini_raw_response: { action: 'buy', confidence: 0.85 }
          },
          {
            timestamp: '2026-08-01T10:05:00Z',
            gemini_raw_response: { action: 'buy', confidence: 0.5 } // Below min confidence
          },
          {
            timestamp: '2026-08-01T10:10:00Z',
            gemini_raw_response: { action: 'skip', confidence: 0.0 }
          },
          {
            timestamp: '2026-08-03T09:20:00Z',
            gemini_raw_response: { action: 'sell', confidence: 0.9 }
          }
        ]
      };

      const metrics = calculateMetrics(mockResult, {
        SYMBOL: 'XAU_USD',
        TIMEFRAME: 'M5',
        STRATEGY_VERSION: 'v1.0',
        MIN_CONFIDENCE: 0.7
      });

      expect(metrics.totalTrades).toBe(4);
      expect(metrics.winningTradesCount).toBe(2);
      expect(metrics.losingTradesCount).toBe(2);
      expect(metrics.winRate).toBe(0.5);
      expect(metrics.profitFactor).toBe(3.0); // 300 / 100
      expect(metrics.netProfit).toBe(200);
      expect(metrics.netProfitPercent).toBe(0.02);
      expect(metrics.avgWin).toBe(150);
      expect(metrics.avgLoss).toBe(-50);
      expect(metrics.totalSignals).toBe(3); // 2 buy, 1 sell
      expect(metrics.aiAcceptedEntries).toBe(2); // 1 buy (0.85) + 1 sell (0.9)
      expect(metrics.period.from).toBe('2026-08-01');
      expect(metrics.period.to).toBe('2026-08-03');
    });

    it('should handle zero trades gracefully', () => {
      const mockResult = {
        mode: 'rule-based',
        initialBalance: 10000,
        finalBalance: 10000,
        trades: [],
        logs: []
      };

      const metrics = calculateMetrics(mockResult);

      expect(metrics.totalTrades).toBe(0);
      expect(metrics.winningTradesCount).toBe(0);
      expect(metrics.losingTradesCount).toBe(0);
      expect(metrics.winRate).toBe(0);
      expect(metrics.profitFactor).toBe(0);
      expect(metrics.netProfit).toBe(0);
      expect(metrics.maxDrawdown).toBe(0);
      expect(metrics.sharpeRatio).toBe(0);
      expect(metrics.avgWin).toBe(0);
      expect(metrics.avgLoss).toBe(0);
      expect(metrics.totalSignals).toBe(0);
      expect(metrics.aiAcceptedEntries).toBe(0);
    });

    it('should handle all winning trades (profitFactor is Infinity)', () => {
      const mockResult = {
        initialBalance: 10000,
        finalBalance: 10300,
        trades: [
          { profit: 100, profitPercent: 0.01 },
          { profit: 200, profitPercent: 0.02 }
        ],
        logs: []
      };

      const metrics = calculateMetrics(mockResult);

      expect(metrics.winningTradesCount).toBe(2);
      expect(metrics.losingTradesCount).toBe(0);
      expect(metrics.winRate).toBe(1.0);
      expect(metrics.profitFactor).toBe(Infinity);
      expect(metrics.avgWin).toBe(150);
      expect(metrics.avgLoss).toBe(0);
    });

    it('should handle all losing trades (profitFactor is 0)', () => {
      const mockResult = {
        initialBalance: 10000,
        finalBalance: 9800,
        trades: [
          { profit: -100, profitPercent: -0.01 },
          { profit: -100, profitPercent: -0.01 }
        ],
        logs: []
      };

      const metrics = calculateMetrics(mockResult);

      expect(metrics.winningTradesCount).toBe(0);
      expect(metrics.losingTradesCount).toBe(2);
      expect(metrics.winRate).toBe(0);
      expect(metrics.profitFactor).toBe(0);
      expect(metrics.avgWin).toBe(0);
      expect(metrics.avgLoss).toBe(-100);
    });

    it('should accurately calculate max drawdown along running balance', () => {
      const mockResult = {
        initialBalance: 10000,
        finalBalance: 9500,
        trades: [
          { profit: 1000 }, // Balance = 11000 (Peak = 11000)
          { profit: -2200 }, // Balance = 8800 (DD = (8800 - 11000) / 11000 = -0.2)
          { profit: 700 }   // Balance = 9500 (DD = (9500 - 11000) / 11000 = -0.136)
        ],
        logs: []
      };

      const metrics = calculateMetrics(mockResult);

      expect(metrics.maxDrawdown).toBe(-0.2);
    });
  });

  describe('generateReport', () => {
    it('should write report to disk and return report object', () => {
      const mockResult = {
        mode: 'rule-based',
        initialBalance: 10000,
        finalBalance: 10150,
        trades: [{ profit: 150, profitPercent: 0.015, entryTime: '2026-08-01T10:00:00Z', exitTime: '2026-08-01T10:30:00Z' }],
        logs: []
      };

      const report = generateReport(mockResult, {}, { outputPath: 'test_result.json', silent: true });

      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.resolve(process.cwd(), 'test_result.json'),
        expect.stringContaining('"totalTrades": 1'),
        'utf8'
      );
      expect(report.totalTrades).toBe(1);
      expect(report.netProfit).toBe(150);
    });

    it('should handle write errors without crashing', () => {
      fs.writeFileSync.mockImplementation(() => {
        throw new Error('Disk full');
      });

      const mockResult = {
        mode: 'rule-based',
        initialBalance: 10000,
        finalBalance: 10000,
        trades: [],
        logs: []
      };

      expect(() => {
        generateReport(mockResult, {}, { silent: true });
      }).not.toThrow();
    });
  });
});
