const fs = require('fs');
const path = require('path');
const globalConfig = require('../config');

/**
 * TradeLogExporter — generates a structured JSON trade log for AI-simulated backtests.
 *
 * Produces a .json file in logs/ with:
 *   - meta: symbol, timeframe, period, strategy version, AI model info
 *   - summary:
 *       - three_way_comparison: all rule signals, AI accepted (actual), AI accepted (rule SL/TP)
 *       - ai_filter_quality: total, accepted, rejected, avoided losses (TN), missed wins (FN)
 *   - signals: unified array linking rule_based and ai decision/outcomes per signal
 *
 * Only applicable when mode === 'ai-simulated'.
 */

/**
 * Simulate hypothetical trade outcome by tracing forward candles from entry.
 *
 * @param {string} side  - 'buy' | 'sell'
 * @param {number} entryPrice
 * @param {number} sl
 * @param {number} tp
 * @param {number} startCandleIdx - index of entry candle in allCandles[]
 * @param {Array}  allCandles
 * @returns {{ outcome: 'win'|'loss'|'open', exitPrice: number|null, exitTime: string|null }}
 */
function simulateHypotheticalOutcome(side, entryPrice, sl, tp, startCandleIdx, allCandles) {
  if (!allCandles || startCandleIdx >= allCandles.length - 1) {
    return { outcome: 'open', exitPrice: null, exitTime: null };
  }

  for (let j = startCandleIdx + 1; j < allCandles.length; j++) {
    const c = allCandles[j];
    if (side === 'buy') {
      if (c.low <= sl) {
        return { outcome: 'loss', exitPrice: sl, exitTime: c.time };
      }
      if (c.high >= tp) {
        return { outcome: 'win', exitPrice: tp, exitTime: c.time };
      }
    } else if (side === 'sell') {
      if (c.high >= sl) {
        return { outcome: 'loss', exitPrice: sl, exitTime: c.time };
      }
      if (c.low <= tp) {
        return { outcome: 'win', exitPrice: tp, exitTime: c.time };
      }
    }
  }

  return { outcome: 'open', exitPrice: null, exitTime: null };
}

/**
 * Calculate performance metrics from an array of trade objects with { profit }.
 * @param {Array} trades
 * @param {number} initialBalance
 * @returns {Object}
 */
function calcSubsetMetrics(trades, initialBalance) {
  if (!trades || trades.length === 0) {
    return {
      total_trades: 0,
      winning_trades: 0,
      losing_trades: 0,
      win_rate: 0,
      profit_factor: 0,
      net_profit: 0,
      max_drawdown: 0,
      sharpe_ratio: 0,
      avg_win: 0,
      avg_loss: 0
    };
  }

  const winning = trades.filter(t => t.profit > 0);
  const losing = trades.filter(t => t.profit <= 0);
  const grossProfit = winning.reduce((s, t) => s + t.profit, 0);
  const grossLoss = Math.abs(losing.reduce((s, t) => s + t.profit, 0));
  const winRate = trades.length > 0 ? winning.length / trades.length : 0;
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLoss;
  const netProfit = trades.reduce((s, t) => s + t.profit, 0);

  let runningBalance = initialBalance;
  let peakBalance = initialBalance;
  let maxDrawdown = 0;
  for (const trade of trades) {
    runningBalance += trade.profit;
    if (runningBalance > peakBalance) peakBalance = runningBalance;
    const dd = (runningBalance - peakBalance) / (peakBalance || 1);
    if (dd < maxDrawdown) maxDrawdown = dd;
  }

  let sharpeRatio = 0;
  if (trades.length > 1) {
    const returns = trades.map(t => t.profit / (initialBalance || 1));
    const mean = returns.reduce((a, b) => a + b, 0) / trades.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (trades.length - 1);
    const std = Math.sqrt(variance);
    if (std > 0) sharpeRatio = mean / std;
  }

  const avgWin = winning.length > 0 ? grossProfit / winning.length : 0;
  const avgLoss = losing.length > 0 ? -(grossLoss / losing.length) : 0;

  return {
    total_trades: trades.length,
    winning_trades: winning.length,
    losing_trades: losing.length,
    win_rate: Number((winRate * 100).toFixed(1)),
    profit_factor: Number(profitFactor.toFixed(2)),
    net_profit: Number(netProfit.toFixed(2)),
    max_drawdown: Number((Math.abs(maxDrawdown) * 100).toFixed(2)),
    sharpe_ratio: Number(sharpeRatio.toFixed(2)),
    avg_win: Number(avgWin.toFixed(2)),
    avg_loss: Number(avgLoss.toFixed(2))
  };
}

/**
 * Exports a structured JSON trade log for AI-simulated backtest results.
 *
 * @param {Object} backtestResult - Result from BacktestEngine (mode must be 'ai-simulated')
 * @param {Object} [customConfig] - Optional config overrides
 * @param {Object} [options] - { outputPath, silent }
 * @returns {string|null} Path to the generated JSON file, or null if skipped
 */
function exportTradeLog(backtestResult, customConfig = {}, options = {}) {
  const config = { ...globalConfig, ...customConfig };

  if (backtestResult.mode !== 'ai-simulated') {
    if (!options.silent) {
      console.log('[TradeLogExporter] Skipped: only applicable in ai-simulated mode.');
    }
    return null;
  }

  const {
    logs = [],
    trades = [],
    allCandles = [],
    initialBalance = 100000
  } = backtestResult;

  const minConfidence = config.MIN_CONFIDENCE !== undefined ? config.MIN_CONFIDENCE : 0.7;
  const symbol = config.SYMBOL || 'XAU_USD';
  const timeframe = config.TIMEFRAME || 'M5';
  const strategyVersion = config.STRATEGY_VERSION || 'v2.0';
  const aiProvider = config.AI_PROVIDER || 'gemini';
  const aiModel = aiProvider === 'gemini' ? config.GEMINI_MODEL : config.DASHSCOPE_MODEL;

  // Filter to rule signals only
  const ruleSignals = logs.filter(l => l.isRuleSignal);

  // Map tradeId -> trade record
  const tradeById = {};
  for (const t of trades) {
    tradeById[t.id] = t;
  }

  // 1. Trace rule-based hypothetical outcomes for all rule signals
  for (const entry of ruleSignals) {
    if (entry.ruleSl == null || entry.ruleTp == null || entry.candleIdx == null) continue;

    const hyp = simulateHypotheticalOutcome(
      entry.ruleBasedAction,
      entry.entryPrice,
      entry.ruleSl,
      entry.ruleTp,
      entry.candleIdx,
      allCandles
    );
    entry.ruleBasedOutcome = hyp.outcome;
    entry.ruleBasedExitTime = hyp.exitTime;
    entry.ruleBasedExitPrice = hyp.exitPrice;
  }

  const acceptedEntries = ruleSignals.filter(l => l.aiAccepted);
  const rejectedEntries = ruleSignals.filter(l => !l.aiAccepted);

  // 2. Build metrics for all rule signals (based on simulated hypothetical win/loss)
  const allRuleWins = ruleSignals.filter(l => l.ruleBasedOutcome === 'win').length;
  const allRuleLosses = ruleSignals.filter(l => l.ruleBasedOutcome === 'loss').length;
  const allRuleOpen = ruleSignals.filter(l => l.ruleBasedOutcome === 'open').length;
  const allRuleResolved = allRuleWins + allRuleLosses;
  const allRuleWinRate = allRuleResolved > 0 ? Number((allRuleWins / allRuleResolved * 100).toFixed(1)) : 0;

  // Build virtual trades for accepted entries
  const ruleOutcomeAcceptedTrades = acceptedEntries.map(entry => {
    const tradeRecord = entry.tradeId ? tradeById[entry.tradeId] : null;
    if (!tradeRecord) return null;
    const units = tradeRecord.units;
    const side = entry.ruleBasedAction;
    const entryPrice = entry.entryPrice;
    const ruleSl = entry.ruleSl;
    const ruleTp = entry.ruleTp;
    let profit = null;
    if (entry.ruleBasedOutcome === 'win' && ruleTp !== null) {
      profit = side === 'buy' ? (ruleTp - entryPrice) * units : (entryPrice - ruleTp) * units;
    } else if (entry.ruleBasedOutcome === 'loss' && ruleSl !== null) {
      profit = side === 'buy' ? (ruleSl - entryPrice) * units : (entryPrice - ruleSl) * units;
    }
    entry.ruleBasedProfit = profit !== null ? Number(profit.toFixed(2)) : null;
    return profit !== null ? { profit: Number(profit.toFixed(2)) } : null;
  }).filter(t => t !== null);

  const metricsAI = calcSubsetMetrics(trades, initialBalance);
  const metricsRuleSubset = calcSubsetMetrics(ruleOutcomeAcceptedTrades, initialBalance);

  // 3. Filter quality counters
  const totalRuleSignals = ruleSignals.length;
  const totalAiAccepted = acceptedEntries.length;
  const totalAiRejected = rejectedEntries.length;
  const rejectedThatWouldWin = rejectedEntries.filter(l => l.ruleBasedOutcome === 'win').length;
  const rejectedThatWouldLose = rejectedEntries.filter(l => l.ruleBasedOutcome === 'loss').length;
  const rejectedOpen = rejectedEntries.filter(l => l.ruleBasedOutcome === 'open').length;

  const engineRuinedWin = acceptedEntries.filter(l => l.ruleBasedOutcome === 'win' && l.aiOutcome === 'loss').length;
  const engineSavedLoss = acceptedEntries.filter(l => l.ruleBasedOutcome === 'loss' && l.aiOutcome === 'win').length;

  const periodFrom = ruleSignals.length > 0
    ? (ruleSignals[0].timestamp || '').slice(0, 10)
    : (logs.length > 0 ? (logs[0].timestamp || '').slice(0, 10) : 'N/A');
  const periodTo = ruleSignals.length > 0
    ? (ruleSignals[ruleSignals.length - 1].timestamp || '').slice(0, 10)
    : (logs.length > 0 ? (logs[logs.length - 1].timestamp || '').slice(0, 10) : 'N/A');

  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

  // 4. Build unified signals array
  const formattedSignals = ruleSignals.map((entry, idx) => {
    const tradeRecord = entry.tradeId ? tradeById[entry.tradeId] : null;
    return {
      id: idx + 1,
      time: entry.timestamp,
      side: (entry.ruleBasedAction || '').toUpperCase(),
      entry_price: entry.entryPrice || entry.price,
      rule_based: {
        action: entry.ruleBasedAction,
        reason: entry.ruleBasedReason,
        sl: entry.ruleSl,
        tp: entry.ruleTp,
        outcome: entry.ruleBasedOutcome,
        exit_price: entry.ruleBasedExitPrice,
        exit_time: entry.ruleBasedExitTime
      },
      ai: {
        action: entry.aiAction || entry.action,
        confidence: entry.aiConfidence !== null ? entry.aiConfidence : entry.confidence,
        accepted: Boolean(entry.aiAccepted),
        reason: entry.aiReason || entry.reason,
        sl: entry.aiSl || entry.sl,
        tp: entry.aiTp || entry.tp,
        units: tradeRecord ? tradeRecord.units : (entry.units || 0),
        outcome: entry.aiOutcome,
        profit: entry.aiProfit,
        exit_price: entry.aiExitPrice,
        exit_time: entry.aiExitTime,
        exit_reason: entry.aiExitReason,
        trade_id: entry.tradeId
      }
    };
  });

  // 5. Build structured payload
  const logData = {
    meta: {
      symbol: `${symbol} (${timeframe})`,
      period: {
        from: periodFrom,
        to: periodTo
      },
      strategy_version: strategyVersion,
      ai_provider: aiProvider,
      ai_model: aiModel,
      min_confidence: minConfidence,
      generated_at: now.toISOString()
    },
    summary: {
      three_way_comparison: {
        all_rule_signals: {
          total_signals: totalRuleSignals,
          winning_signals: allRuleWins,
          losing_signals: allRuleLosses,
          still_open_signals: allRuleOpen,
          win_rate_percent: allRuleWinRate
        },
        ai_accepted_actual: {
          total_trades: trades.length,
          ...metricsAI
        },
        ai_accepted_rule_simulated: {
          total_trades: acceptedEntries.length,
          ...metricsRuleSubset
        }
      },
      ai_filter_quality: {
        total_rule_signals: totalRuleSignals,
        ai_accepted_count: totalAiAccepted,
        ai_accepted_rate_percent: totalRuleSignals > 0 ? Number((totalAiAccepted / totalRuleSignals * 100).toFixed(1)) : 0,
        ai_rejected_count: totalAiRejected,
        ai_rejected_rate_percent: totalRuleSignals > 0 ? Number((totalAiRejected / totalRuleSignals * 100).toFixed(1)) : 0,
        avoided_losses_true_negative: rejectedThatWouldLose,
        missed_wins_false_negative: rejectedThatWouldWin,
        still_open: rejectedOpen,
        filter_effectiveness_verdict: totalAiRejected > 0 && rejectedThatWouldLose > rejectedThatWouldWin
          ? 'effective_loss_prevention'
          : 'opportunity_cost_high'
      },
      execution_engine_impact: {
        applied_to_trades: totalAiAccepted,
        saved_loss_by_engine: engineSavedLoss,
        ruined_win_by_engine: engineRuinedWin
      }
    },
    signals: formattedSignals
  };

  const logsDir = path.resolve(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const outputPath = options.outputPath
    ? path.resolve(process.cwd(), options.outputPath)
    : path.join(logsDir, `backtest_trade_log_${ts}.json`);

  try {
    fs.writeFileSync(outputPath, JSON.stringify(logData, null, 2), 'utf8');
    if (!options.silent) {
      console.log(`\n📋 Trade log exported to: ${outputPath}`);
    }
  } catch (error) {
    console.warn(`[TradeLogExporter] Failed to write log: ${error.message}`);
  }

  return outputPath;
}

module.exports = { exportTradeLog };

