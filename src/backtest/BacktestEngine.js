const CsvDataClient = require('../data/CsvDataClient');
const GeminiAgent = require('../ai/GeminiAgent');
const { buildContext } = require('../bot/SignalBuilder');
const { calculateUnits } = require('../bot/RiskManager');
const globalConfig = require('../config');
const { log } = require('../utils/logger');

/**
 * BacktestEngine — simulates trading on historical candle data.
 *
 * Data source: CsvDataClient (reads local CSV file, no broker API needed).
 * Two modes:
 *   - rule-based:    fast, uses MA cross + RSI hard rules per STRATEGY.md, no Gemini quota consumed.
 *   - ai-simulated:  actual Gemini calls via GeminiAgent, used to validate prompt quality.
 *
 * See ARCHITECTURE.md §Layer 5 and STRATEGY.md for parameters and schemas.
 */
class BacktestEngine {
  /**
   * @param {Object} [options]
   * @param {CsvDataClient} [options.dataClient] - Optional injected data client
   * @param {GeminiAgent} [options.geminiAgent] - Optional injected Gemini agent
   */
  constructor(options = {}) {
    this.dataClient = options.dataClient || new CsvDataClient();
    this.geminiAgent = options.geminiAgent || new GeminiAgent();
  }

  /**
   * Runs rule-based backtest on historical data without calling Gemini.
   *
   * Entry rules (STRATEGY.md §2):
   * - Bullish: MA fast crosses above MA slow AND RSI < RSI_OVERSOLD -> BUY
   * - Bearish: MA fast crosses below MA slow AND RSI > RSI_OVERBOUGHT -> SELL
   * - Otherwise: skip
   *
   * @param {Object} [customConfig] - Optional config overrides
   * @returns {Promise<Object>} Backtest execution result with trades and logs
   */
  async runRuleBased(customConfig = {}) {
    return this._runSimulation('rule-based', customConfig);
  }

  /**
   * Runs AI-simulated backtest on historical data with Gemini decision making.
   *
   * @param {Object} [customConfig] - Optional config overrides
   * @returns {Promise<Object>} Backtest execution result with trades and logs
   */
  async runAISimulated(customConfig = {}) {
    return this._runSimulation('ai-simulated', customConfig);
  }

  /**
   * Core simulation engine over historical candles.
   *
   * @private
   * @param {'rule-based'|'ai-simulated'} mode
   * @param {Object} customConfig
   * @returns {Promise<Object>}
   */
  async _runSimulation(mode, customConfig = {}) {
    const config = { ...globalConfig, ...customConfig };
    const windowSize = config.CANDLE_COUNT || 100;
    const initialBalance = config.INITIAL_BALANCE || 100000;
    const defaultSlAtrMultiplier = config.DEFAULT_SL_ATR_MULTIPLIER || 1.5;
    const defaultTpAtrMultiplier = config.DEFAULT_TP_ATR_MULTIPLIER || 2.5;

    // Load all historical candles from data client
    const candles = await this.dataClient.getCandles(Number.MAX_SAFE_INTEGER);

    if (!candles || candles.length < windowSize) {
      log('warn', 'Insufficient candles for backtesting', {
        count: candles ? candles.length : 0,
        required: windowSize
      });
      return {
        mode,
        initialBalance,
        finalBalance: initialBalance,
        trades: [],
        logs: [],
        candlesCount: candles ? candles.length : 0
      };
    }

    let currentBalance = initialBalance;
    let openPosition = null;
    const trades = [];
    const logs = [];

    // State machine for tracking setup conditions (RSI extremes + EMA cross)
    let buySetup = { rsiTouched: false, rsiCandlesAgo: 999, emaCrossed: false, crossCandlesAgo: 999 };
    let sellSetup = { rsiTouched: false, rsiCandlesAgo: 999, emaCrossed: false, crossCandlesAgo: 999 };

    const rsiLookback = config.RSI_LOOKBACK_CANDLES || 20;
    const confirmationWindow = config.EMA_CONFIRMATION_WINDOW || 5;

    // Slide window across candles
    for (let i = windowSize - 1; i < candles.length; i++) {
      const currentCandle = candles[i];

      // 1. Check open position against current candle price extremes (SL/TP)
      if (openPosition) {
        let exitPrice = null;
        let exitReason = null;

        if (openPosition.side === 'buy') {
          // Check SL first for risk safety
          if (currentCandle.low <= openPosition.sl) {
            exitPrice = openPosition.sl;
            exitReason = 'sl';
          } else if (currentCandle.high >= openPosition.tp) {
            exitPrice = openPosition.tp;
            exitReason = 'tp';
          }
        } else if (openPosition.side === 'sell') {
          if (currentCandle.high >= openPosition.sl) {
            exitPrice = openPosition.sl;
            exitReason = 'sl';
          } else if (currentCandle.low <= openPosition.tp) {
            exitPrice = openPosition.tp;
            exitReason = 'tp';
          }
        }

        if (exitReason !== null) {
          const profit = openPosition.side === 'buy'
            ? (exitPrice - openPosition.entryPrice) * openPosition.units
            : (openPosition.entryPrice - exitPrice) * openPosition.units;

          const tradeRecord = {
            id: `trade_${trades.length + 1}`,
            symbol: openPosition.symbol,
            side: openPosition.side,
            entryTime: openPosition.entryTime,
            entryPrice: openPosition.entryPrice,
            exitTime: currentCandle.time,
            exitPrice,
            sl: openPosition.sl,
            tp: openPosition.tp,
            units: openPosition.units,
            profit: Number(profit.toFixed(2)),
            profitPercent: Number((profit / (currentBalance || 1)).toFixed(4)),
            exitReason
          };

          trades.push(tradeRecord);
          currentBalance += profit;
          openPosition = null;
          // Reset setups after closing position
          buySetup = { rsiTouched: false, rsiCandlesAgo: 999, emaCrossed: false, crossCandlesAgo: 999 };
          sellSetup = { rsiTouched: false, rsiCandlesAgo: 999, emaCrossed: false, crossCandlesAgo: 999 };
        }

        // Never open a new position while one is still open
        continue;
      }

      // 2. Build context for the current window
      const candleWindow = candles.slice(i - windowSize + 1, i + 1);
      const context = buildContext(candleWindow, config);

      if (!context) {
        continue;
      }

      // 3. Update Setup State Machine counters
      buySetup.rsiCandlesAgo++;
      buySetup.crossCandlesAgo++;
      sellSetup.rsiCandlesAgo++;
      sellSetup.crossCandlesAgo++;

      if (context.indicators.rsi <= config.RSI_OVERSOLD) {
        buySetup.rsiTouched = true;
        buySetup.rsiCandlesAgo = 0;
      }
      if (context.indicators.rsi >= config.RSI_OVERBOUGHT) {
        sellSetup.rsiTouched = true;
        sellSetup.rsiCandlesAgo = 0;
      }

      if (context.indicators.ma_cross === 'bullish_cross') {
        buySetup.emaCrossed = true;
        buySetup.crossCandlesAgo = 0;
        sellSetup = { rsiTouched: false, rsiCandlesAgo: 999, emaCrossed: false, crossCandlesAgo: 999 };
      } else if (context.indicators.ma_cross === 'bearish_cross') {
        sellSetup.emaCrossed = true;
        sellSetup.crossCandlesAgo = 0;
        buySetup = { rsiTouched: false, rsiCandlesAgo: 999, emaCrossed: false, crossCandlesAgo: 999 };
      }

      // Check timeouts for setup expiry
      if (buySetup.rsiCandlesAgo > rsiLookback) buySetup.rsiTouched = false;
      if (buySetup.crossCandlesAgo > confirmationWindow) buySetup.emaCrossed = false;
      if (sellSetup.rsiCandlesAgo > rsiLookback) sellSetup.rsiTouched = false;
      if (sellSetup.crossCandlesAgo > confirmationWindow) sellSetup.emaCrossed = false;

      // 4. Determine decision based on mode
      let decision;
      if (mode === 'rule-based') {
        decision = this._evaluateRuleBasedDecision(
          context,
          currentCandle,
          config,
          buySetup,
          sellSetup,
          defaultSlAtrMultiplier,
          defaultTpAtrMultiplier
        );

        if (decision.action === 'buy') {
          buySetup = { rsiTouched: false, rsiCandlesAgo: 999, emaCrossed: false, crossCandlesAgo: 999 };
        } else if (decision.action === 'sell') {
          sellSetup = { rsiTouched: false, rsiCandlesAgo: 999, emaCrossed: false, crossCandlesAgo: 999 };
        }
      } else {
        try {
          decision = await this.geminiAgent.getDecision(context);
        } catch (error) {
          log('warn', 'AI decision error during backtest', { error: error.message });
          decision = {
            action: 'skip',
            confidence: 0,
            sl_atr_multiplier: defaultSlAtrMultiplier,
            tp_atr_multiplier: defaultTpAtrMultiplier,
            reason: `AI decision error: ${error.message}`
          };
        }
      }

      // 5. Handle Decision and Risk Management
      let executedOrder = null;
      if (
        (decision.action === 'buy' || decision.action === 'sell') &&
        decision.confidence >= config.MIN_CONFIDENCE
      ) {
        const currentPrice = currentCandle.close;
        const atr = context.indicators.atr;

        if (atr > 0) {
          const slMultiplier = decision.sl_atr_multiplier || defaultSlAtrMultiplier;
          const tpMultiplier = decision.tp_atr_multiplier || defaultTpAtrMultiplier;

          const slDistance = Number((slMultiplier * atr).toFixed(2));
          const tpDistance = Number((tpMultiplier * atr).toFixed(2));

          let sl;
          let tp;

          if (decision.action === 'buy') {
            sl = Number((currentPrice - slDistance).toFixed(2));
            tp = Number((currentPrice + tpDistance).toFixed(2));
          } else {
            sl = Number((currentPrice + slDistance).toFixed(2));
            tp = Number((currentPrice - tpDistance).toFixed(2));
          }

          const units = calculateUnits(currentBalance, config.RISK_PER_TRADE, slDistance);

          if (units > 0) {
            openPosition = {
              symbol: config.SYMBOL,
              side: decision.action,
              entryPrice: currentPrice,
              entryTime: currentCandle.time,
              sl,
              tp,
              units,
              slDistance
            };

            executedOrder = { sl, tp, units };
          }
        }
      }

      // 6. Record Log Entry (DATA-SCHEMA.md §6)
      const logEntry = {
        timestamp: currentCandle.time,
        symbol: config.SYMBOL,
        action: decision.action,
        reason: decision.reason,
        confidence: decision.confidence,
        strategy_version: config.STRATEGY_VERSION || 'v1.0',
        price: currentCandle.close,
        sl: executedOrder ? executedOrder.sl : null,
        tp: executedOrder ? executedOrder.tp : null,
        units: executedOrder ? executedOrder.units : 0,
        gemini_raw_response: decision,
        error: null
      };

      logs.push(logEntry);
    }

    return {
      mode,
      initialBalance,
      finalBalance: Number(currentBalance.toFixed(2)),
      trades,
      logs,
      candlesCount: candles.length
    };
  }

  /**
   * Rule-based decision evaluation using RSI extremes, EMA cross, and candle close confirmation.
   *
   * @private
   * @param {Object} context
   * @param {Object} currentCandle
   * @param {Object} config
   * @param {Object} buySetup
   * @param {Object} sellSetup
   * @param {number} defaultSlAtrMultiplier
   * @param {number} defaultTpAtrMultiplier
   * @returns {Object}
   */
  _evaluateRuleBasedDecision(
    context,
    currentCandle,
    config,
    buySetup,
    sellSetup,
    defaultSlAtrMultiplier,
    defaultTpAtrMultiplier
  ) {
    const { indicators } = context;

    // BUY: RSI touched oversold (<=30) AND Bullish EMA cross occurred AND candle closed above EMA21
    if (
      buySetup.rsiTouched &&
      buySetup.emaCrossed &&
      indicators.ma9 > indicators.ma21 &&
      currentCandle.close > indicators.ma21
    ) {
      return {
        action: 'buy',
        confidence: 1.0,
        sl_atr_multiplier: defaultSlAtrMultiplier,
        tp_atr_multiplier: defaultTpAtrMultiplier,
        reason: `Rule-based: RSI touched oversold (<= ${config.RSI_OVERSOLD}), EMA9 crossed above EMA21, and candle closed above EMA21`
      };
    }

    // SELL: RSI touched overbought (>=70) AND Bearish EMA cross occurred AND candle closed below EMA21
    if (
      sellSetup.rsiTouched &&
      sellSetup.emaCrossed &&
      indicators.ma9 < indicators.ma21 &&
      currentCandle.close < indicators.ma21
    ) {
      return {
        action: 'sell',
        confidence: 1.0,
        sl_atr_multiplier: defaultSlAtrMultiplier,
        tp_atr_multiplier: defaultTpAtrMultiplier,
        reason: `Rule-based: RSI touched overbought (>= ${config.RSI_OVERBOUGHT}), EMA9 crossed below EMA21, and candle closed below EMA21`
      };
    }

    return {
      action: 'skip',
      confidence: 0.0,
      sl_atr_multiplier: defaultSlAtrMultiplier,
      tp_atr_multiplier: defaultTpAtrMultiplier,
      reason: 'Rule-based: Setup or candle close confirmation condition not met'
    };
  }
}

module.exports = BacktestEngine;
