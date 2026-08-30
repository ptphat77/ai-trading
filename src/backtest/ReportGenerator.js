const fs = require('fs');
const path = require('path');
const globalConfig = require('../config');
const { log } = require('../utils/logger');

/**
 * Calculates backtest performance metrics from BacktestEngine simulation output.
 *
 * @param {Object} backtestResult - Result from BacktestEngine
 * @param {Object} [customConfig] - Optional config overrides
 * @returns {Object} Metric calculations conforming to DATA-SCHEMA.md §7 + signal metrics
 */
function calculateMetrics(backtestResult, customConfig = {}) {
  const config = { ...globalConfig, ...customConfig };
  const {
    mode = 'rule-based',
    initialBalance = 100000,
    finalBalance = initialBalance,
    trades = [],
    logs = []
  } = backtestResult || {};

  const totalTrades = trades.length;
  const winningTrades = trades.filter(t => t.profit > 0);
  const losingTrades = trades.filter(t => t.profit <= 0);

  const winningTradesCount = winningTrades.length;
  const losingTradesCount = losingTrades.length;

  const grossProfit = winningTrades.reduce((sum, t) => sum + t.profit, 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.profit, 0));

  const winRate = totalTrades > 0 ? Number((winningTradesCount / totalTrades).toFixed(3)) : 0;

  let profitFactor;
  if (grossLoss === 0) {
    profitFactor = grossProfit > 0 ? Infinity : 0;
  } else {
    profitFactor = Number((grossProfit / grossLoss).toFixed(2));
  }

  const netProfit = Number((finalBalance - initialBalance).toFixed(2));
  const netProfitPercent = initialBalance > 0 ? Number((netProfit / initialBalance).toFixed(4)) : 0;

  // Max Drawdown calculation using running equity curve
  let runningBalance = initialBalance;
  let peakBalance = initialBalance;
  let maxDrawdown = 0;

  for (const trade of trades) {
    runningBalance += trade.profit;
    if (runningBalance > peakBalance) {
      peakBalance = runningBalance;
    }
    const currentDrawdown = (runningBalance - peakBalance) / (peakBalance || 1);
    if (currentDrawdown < maxDrawdown) {
      maxDrawdown = currentDrawdown;
    }
  }

  maxDrawdown = Number(maxDrawdown.toFixed(4));

  // Sharpe Ratio based on trade returns
  let sharpeRatio = 0;
  if (totalTrades > 1) {
    const returns = trades.map(t => (t.profitPercent !== undefined ? t.profitPercent : t.profit / (initialBalance || 1)));
    const meanReturn = returns.reduce((a, b) => a + b, 0) / totalTrades;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (totalTrades - 1);
    const stdDev = Math.sqrt(variance);
    if (stdDev > 0) {
      sharpeRatio = Number((meanReturn / stdDev).toFixed(2));
    }
  }

  const avgWin = winningTradesCount > 0 ? Number((grossProfit / winningTradesCount).toFixed(2)) : 0;
  const avgLoss = losingTradesCount > 0 ? Number((-grossLoss / losingTradesCount).toFixed(2)) : 0;

  // Signals and AI-accepted entries from logs
  const minConfidence = config.MIN_CONFIDENCE !== undefined ? config.MIN_CONFIDENCE : 0.7;

  const totalSignals = logs.filter(l => {
    const rawAction = l.gemini_raw_response ? l.gemini_raw_response.action : l.action;
    return rawAction === 'buy' || rawAction === 'sell';
  }).length;

  const aiAcceptedEntries = logs.filter(l => {
    const rawAction = l.gemini_raw_response ? l.gemini_raw_response.action : l.action;
    const confidence = l.gemini_raw_response && l.gemini_raw_response.confidence !== undefined
      ? l.gemini_raw_response.confidence
      : l.confidence;
    return (rawAction === 'buy' || rawAction === 'sell') && confidence >= minConfidence;
  }).length;

  // Period determination from logs or trades
  let from = 'N/A';
  let to = 'N/A';
  if (logs.length > 0) {
    from = logs[0].timestamp ? logs[0].timestamp.split('T')[0] : 'N/A';
    to = logs[logs.length - 1].timestamp ? logs[logs.length - 1].timestamp.split('T')[0] : 'N/A';
  } else if (trades.length > 0) {
    from = trades[0].entryTime ? trades[0].entryTime.split('T')[0] : 'N/A';
    to = trades[trades.length - 1].exitTime ? trades[trades.length - 1].exitTime.split('T')[0] : 'N/A';
  }

  return {
    period: { from, to },
    symbol: config.SYMBOL || 'XAU_USD',
    timeframe: config.TIMEFRAME || 'M5',
    strategy_version: config.STRATEGY_VERSION || 'v1.0',
    mode,
    totalTrades,
    winningTradesCount,
    losingTradesCount,
    totalSignals,
    aiAcceptedEntries,
    winRate,
    profitFactor,
    netProfit,
    netProfitPercent,
    maxDrawdown,
    sharpeRatio,
    avgWin,
    avgLoss
  };
}

/**
 * Generates report, exports backtest_result.json, and logs console summary.
 *
 * @param {Object} backtestResult - Simulation output
 * @param {Object} [customConfig] - Optional configuration overrides
 * @param {Object} [options] - Optional export options (e.g., outputPath, silent)
 * @returns {Object} Report metrics object
 */
function generateReport(backtestResult, customConfig = {}, options = {}) {
  const report = calculateMetrics(backtestResult, customConfig);

  const outputPath = options.outputPath
    ? path.resolve(process.cwd(), options.outputPath)
    : path.resolve(process.cwd(), 'backtest_result.json');

  try {
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
    if (!options.silent) {
      log('info', `Backtest report successfully exported to: ${outputPath}`);
    }
  } catch (error) {
    log('warn', `Failed to write backtest result file: ${error.message}`);
  }

  if (!options.silent) {
    console.log('\n========================================');
    console.log('       📊 BACKTEST REPORT SUMMARY       ');
    console.log('========================================');
    console.log(`Symbol:            ${report.symbol} (${report.timeframe})`);
    console.log(`Period:            ${report.period.from} to ${report.period.to}`);
    console.log(`Strategy Version:  ${report.strategy_version} (${report.mode})`);
    console.log('----------------------------------------');
    console.log(`Total Signals:     ${report.totalSignals}`);
    console.log(`AI Accepted:       ${report.aiAcceptedEntries}`);
    console.log(`Total Trades:      ${report.totalTrades}`);
    console.log(`Winning Trades:    ${report.winningTradesCount}`);
    console.log(`Losing Trades:     ${report.losingTradesCount}`);
    console.log(`Win Rate:          ${(report.winRate * 100).toFixed(1)}%`);
    console.log(`Profit Factor:     ${report.profitFactor}`);
    console.log(`Net Profit:        $${report.netProfit} (${(report.netProfitPercent * 100).toFixed(2)}%)`);
    console.log(`Max Drawdown:      ${(report.maxDrawdown * 100).toFixed(2)}%`);
    console.log(`Sharpe Ratio:      ${report.sharpeRatio}`);
    console.log(`Avg Win / Loss:    $${report.avgWin} / $${report.avgLoss}`);
    console.log('========================================\n');
  }

  return report;
}

module.exports = {
  calculateMetrics,
  generateReport
};
