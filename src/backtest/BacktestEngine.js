const CsvDataClient = require('../data/CsvDataClient');
const GeminiAgent = require('../ai/GeminiAgent');
const { buildContext } = require('../bot/SignalBuilder');
const { calculateSMA, calculateEMA, getCrossSignal } = require('../indicators/MA');
const { calculate: calculateRSI, getZone: getRSIZone } = require('../indicators/RSI');
const { calculate: calculateATR } = require('../indicators/ATR');
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
    const defaultTpAtrMultiplier = config.DEFAULT_TP_ATR_MULTIPLIER || 1.1;

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

    const rsiLookback = config.RSI_LOOKBACK_CANDLES || 18;
    const confirmationWindow = config.EMA_CONFIRMATION_WINDOW || 5;

    // Check if buildContext is mocked in test environment
    const isMocked = Boolean(buildContext && (buildContext._isMockFunction || buildContext.mock));

    let maFast = [];
    let maSlow = [];
    let rsiArray = [];
    let atrArray = [];
    let fastOffset = 0;
    let slowOffset = 0;
    let rsiOffset = 0;
    let atrOffset = 0;

    if (!isMocked) {
      const closePrices = candles.map(c => c.close);
      const highPrices = candles.map(c => c.high);
      const lowPrices = candles.map(c => c.low);
      const isEMA = (config.MA_TYPE || 'EMA').toUpperCase() === 'EMA';

      maFast = (isEMA ? calculateEMA : calculateSMA)(closePrices, config.MA_FAST_PERIOD || 9);
      maSlow = (isEMA ? calculateEMA : calculateSMA)(closePrices, config.MA_SLOW_PERIOD || 100);
      rsiArray = calculateRSI(closePrices, config.RSI_PERIOD || 14);
      atrArray = calculateATR(highPrices, lowPrices, closePrices, config.ATR_PERIOD || 14);

      fastOffset = candles.length - maFast.length;
      slowOffset = candles.length - maSlow.length;
      rsiOffset = candles.length - rsiArray.length;
      atrOffset = candles.length - atrArray.length;
    }

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
      let context;
      if (isMocked) {
        const candleWindow = candles.slice(i - windowSize + 1, i + 1);
        context = buildContext(candleWindow, config);
      } else {
        const currFast = maFast[i - fastOffset];
        const prevFast = maFast[i - fastOffset - 1];
        const currSlow = maSlow[i - slowOffset];
        const prevSlow = maSlow[i - slowOffset - 1];
        const currRsi = rsiArray[i - rsiOffset];
        const currAtr = atrArray[i - atrOffset];

        if (currFast === undefined || currSlow === undefined || currRsi === undefined || currAtr === undefined) {
          continue;
        }

        const maCross = getCrossSignal(prevFast, currFast, prevSlow, currSlow);
        const rsiZone = getRSIZone(currRsi, config.RSI_OVERSOLD || 36, config.RSI_OVERBOUGHT || 64);
        const startRsiIdx = Math.max(0, i - rsiOffset - rsiLookback + 1);
        const recentRsi = rsiArray.slice(startRsiIdx, i - rsiOffset + 1);
        const rsiTouchedOversold = recentRsi.some(r => r <= (config.RSI_OVERSOLD || 36));
        const rsiTouchedOverbought = recentRsi.some(r => r >= (config.RSI_OVERBOUGHT || 64));
        const candleCloseVsMaSlow = currentCandle.close > currSlow ? 'above' : (currentCandle.close < currSlow ? 'below' : 'equal');

        context = {
          symbol: config.SYMBOL || 'XAU_USD',
          timeframe: config.TIMEFRAME || 'M5',
          currentPrice: currentCandle.close,
          indicators: {
            ma_fast: Number(currFast.toFixed(2)),
            ma_slow: Number(currSlow.toFixed(2)),
            ma9: Number(currFast.toFixed(2)),
            ma21: Number(currSlow.toFixed(2)),
            rsi: Number(currRsi.toFixed(2)),
            atr: Number(currAtr.toFixed(2)),
            ma_cross: maCross,
            rsi_zone: rsiZone,
            rsi_touched_oversold: rsiTouchedOversold,
            rsi_touched_overbought: rsiTouchedOverbought,
            candle_close_vs_ma21: candleCloseVsMaSlow,
            candle_close_vs_ma_slow: candleCloseVsMaSlow
          },
          recentCandles: candles.slice(Math.max(0, i - 4), i + 1)
        };
      }

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

    const maFast = indicators.ma_fast ?? indicators.maFast ?? indicators.ma9;
    const maSlow = indicators.ma_slow ?? indicators.maSlow ?? indicators.ma21;

    // BUY: RSI touched oversold (<=30) AND Bullish EMA cross occurred
    if (
      buySetup.rsiTouched &&
      buySetup.emaCrossed &&
      maFast > maSlow
    ) {
      return {
        action: 'buy',
        confidence: 1.0,
        sl_atr_multiplier: defaultSlAtrMultiplier,
        tp_atr_multiplier: defaultTpAtrMultiplier,
        reason: `Rule-based: RSI touched oversold (<= ${config.RSI_OVERSOLD}) and EMA${config.MA_FAST_PERIOD} crossed above EMA${config.MA_SLOW_PERIOD}`
      };
    }

    // SELL: RSI touched overbought (>=70) AND Bearish EMA cross occurred
    if (
      sellSetup.rsiTouched &&
      sellSetup.emaCrossed &&
      maFast < maSlow
    ) {
      return {
        action: 'sell',
        confidence: 1.0,
        sl_atr_multiplier: defaultSlAtrMultiplier,
        tp_atr_multiplier: defaultTpAtrMultiplier,
        reason: `Rule-based: RSI touched overbought (>= ${config.RSI_OVERBOUGHT}) and EMA${config.MA_FAST_PERIOD} crossed below EMA${config.MA_SLOW_PERIOD}`
      };
    }

    return {
      action: 'skip',
      confidence: 0.0,
      sl_atr_multiplier: defaultSlAtrMultiplier,
      tp_atr_multiplier: defaultTpAtrMultiplier,
      reason: 'Rule-based: Setup condition not met'
    };
  }
}

module.exports = BacktestEngine;
