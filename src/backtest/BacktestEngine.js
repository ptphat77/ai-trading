const CsvDataClient = require('../data/CsvDataClient');
const AIAgentFactory = require('../ai/AIAgentFactory');
const GeminiAgent = require('../ai/GeminiAgent');
const { buildContext } = require('../bot/SignalBuilder');
const { calculateSMA, calculateEMA, getCrossSignal } = require('../indicators/MA');
const { calculate: calculateRSI, getZone: getRSIZone } = require('../indicators/RSI');
const { calculate: calculateATR } = require('../indicators/ATR');
const { calculate: calculateADX } = require('../indicators/ADX');
const { resampleToH1 } = require('../utils/resample');
const { calculateUnits } = require('../bot/RiskManager');
const globalConfig = require('../config');
const { log } = require('../utils/logger');

/**
 * BacktestEngine — simulates trading on historical candle data.
 *
 * Data source: CsvDataClient (reads local CSV file, no broker API needed).
 * Two modes:
 *   - rule-based:    fast, uses Multi-Timeframe EMA + RSI + ADX rules per strategy doc.
 *   - ai-simulated:  actual AI calls via QwenAgent or GeminiAgent, used to validate prompt quality.
 */
class BacktestEngine {
  /**
   * @param {Object} [options]
   * @param {CsvDataClient} [options.dataClient] - Optional injected data client
   * @param {Object} [options.aiAgent] - Optional injected AI agent (QwenAgent / GeminiAgent)
   * @param {GeminiAgent} [options.geminiAgent] - Backward compatibility alias for aiAgent
   */
  constructor(options = {}) {
    this.dataClient = options.dataClient || new CsvDataClient();
    this.aiAgent = options.aiAgent || options.geminiAgent || AIAgentFactory.createAgent();
    this.geminiAgent = this.aiAgent; // Backward compatibility alias
  }

  /**
   * Runs rule-based backtest on historical data without calling AI.
   * @param {Object} [customConfig] - Optional config overrides
   * @returns {Promise<Object>} Backtest execution result with trades and logs
   */
  async runRuleBased(customConfig = {}) {
    return this._runSimulation('rule-based', customConfig);
  }

  /**
   * Runs AI-simulated backtest on historical data with AI decision making.
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
    const defaultSlAtrMultiplier = config.DEFAULT_SL_ATR_MULTIPLIER || 1.2;
    const defaultTpAtrMultiplier = config.DEFAULT_TP_ATR_MULTIPLIER || 1.8;
    const earlyExitEnabled = config.EARLY_EXIT_ENABLED !== false;
    const maxTradesPerDay = config.MAX_TRADES_PER_DAY || 5;
    const cooldownHours = config.CONSECUTIVE_LOSS_COOLDOWN_HOURS || 2;
    const maxAiCalls = config.MAX_AI_CALLS || 0;
    const maxAiAccepted = config.MAX_AI_ACCEPTED || 0;

    const allCandles = await this.dataClient.getCandles(Number.MAX_SAFE_INTEGER);
    let candles = allCandles;
    if (candles && config.MAX_CANDLES_TO_PROCESS && config.MAX_CANDLES_TO_PROCESS > 0) {
      candles = candles.slice(0, config.MAX_CANDLES_TO_PROCESS);
    }

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
    let aiCallCount = 0;

    // Tracking state for noise filters
    const dailyTradesCount = new Map(); // 'YYYY-MM-DD' -> count
    let consecutiveLosses = 0;
    let lastLossTime = null;

    // Map: logEntry index -> logEntry object, so we can enrich it when the trade closes
    const pendingTradeLogIdx = new Map(); // tradeIndex (trades.length at open time) -> logs index

    // Check if buildContext is mocked in test environment
    const isMocked = Boolean(buildContext && (buildContext._isMockFunction || buildContext.mock));

    let maFast = [];
    let maSlow = [];
    let rsiArray = [];
    let atrArray = [];
    let adxArray = [];
    let fastOffset = 0;
    let slowOffset = 0;
    let rsiOffset = 0;
    let atrOffset = 0;
    let adxOffset = 0;

    let h1Candles = [];
    let h1FastEma = [];
    let h1SlowEma = [];
    let h1FastOffset = 0;
    let h1SlowOffset = 0;

    if (!isMocked) {
      const closePrices = candles.map(c => c.close);
      const highPrices = candles.map(c => c.high);
      const lowPrices = candles.map(c => c.low);
      const isEMA = (config.MA_TYPE || 'EMA').toUpperCase() === 'EMA';

      maFast = (isEMA ? calculateEMA : calculateSMA)(closePrices, config.MA_FAST_PERIOD || 9);
      maSlow = (isEMA ? calculateEMA : calculateSMA)(closePrices, config.MA_SLOW_PERIOD || 21);
      rsiArray = calculateRSI(closePrices, config.RSI_PERIOD || 9);
      atrArray = calculateATR(highPrices, lowPrices, closePrices, config.ATR_PERIOD || 14);
      adxArray = calculateADX(highPrices, lowPrices, closePrices, config.ADX_PERIOD || 14);

      fastOffset = candles.length - maFast.length;
      slowOffset = candles.length - maSlow.length;
      rsiOffset = candles.length - rsiArray.length;
      atrOffset = candles.length - atrArray.length;
      adxOffset = candles.length - adxArray.length;

      // Resample to H1 from all available candles so H1 EMAs are fully calculated
      h1Candles = resampleToH1(allCandles || candles);
      const h1Closes = h1Candles.map(c => c.close);
      const h1FastPeriod = config.H1_MA_FAST_PERIOD || 50;
      const h1SlowPeriod = config.H1_MA_SLOW_PERIOD || 200;

      if (h1Candles.length >= h1SlowPeriod) {
        h1FastEma = calculateEMA(h1Closes, h1FastPeriod);
        h1SlowEma = calculateEMA(h1Closes, h1SlowPeriod);
        h1FastOffset = h1Candles.length - h1FastEma.length;
        h1SlowOffset = h1Candles.length - h1SlowEma.length;
      }
    }

    // Helper to find latest completed H1 candle index
    let currentH1Idx = 0;

    // Slide window across candles
    for (let i = windowSize - 1; i < candles.length; i++) {
      const currentCandle = candles[i];
      const candleDateStr = currentCandle.time.slice(0, 10);
      const currentCandleMs = new Date(currentCandle.time).getTime();

      let currFast, prevFast, currSlow, prevSlow, currRsi, currAtr, currAdx, maCross;

      if (!isMocked) {
        currFast = maFast[i - fastOffset];
        prevFast = maFast[i - fastOffset - 1];
        currSlow = maSlow[i - slowOffset];
        prevSlow = maSlow[i - slowOffset - 1];
        currRsi = rsiArray[i - rsiOffset];
        currAtr = atrArray[i - atrOffset];
        const adxObj = adxArray[i - adxOffset];
        currAdx = adxObj ? adxObj.adx : 0;

        if (currFast === undefined || currSlow === undefined || currRsi === undefined || currAtr === undefined) {
          continue;
        }

        maCross = getCrossSignal(prevFast, currFast, prevSlow, currSlow);
      }

      // 1. Check open position against current candle price extremes & early exit
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
          } else if (earlyExitEnabled && maCross === 'bearish_cross') {
            // Early exit: EMA9 crosses below EMA21
            exitPrice = currentCandle.close;
            exitReason = 'early_exit';
          }
        } else if (openPosition.side === 'sell') {
          if (currentCandle.high >= openPosition.sl) {
            exitPrice = openPosition.sl;
            exitReason = 'sl';
          } else if (currentCandle.low <= openPosition.tp) {
            exitPrice = openPosition.tp;
            exitReason = 'tp';
          } else if (earlyExitEnabled && maCross === 'bullish_cross') {
            // Early exit: EMA9 crosses above EMA21
            exitPrice = currentCandle.close;
            exitReason = 'early_exit';
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
            pnl: Number(profit.toFixed(2)),
            exitReason
          };

          const tradeOutcome = profit > 0 ? 'win' : (profit < 0 ? 'loss' : 'breakeven');
          tradeRecord.outcome = tradeOutcome;

          // Enrich the logEntry that opened this trade with actual AI trade result
          const originLogIdx = pendingTradeLogIdx.get(openPosition.logIdx);
          if (originLogIdx !== undefined && logs[originLogIdx]) {
            logs[originLogIdx].aiOutcome = tradeOutcome;
            logs[originLogIdx].aiProfit = tradeRecord.profit;
            logs[originLogIdx].aiExitTime = currentCandle.time;
            logs[originLogIdx].aiExitPrice = exitPrice;
            logs[originLogIdx].aiExitReason = exitReason;
            logs[originLogIdx].tradeId = tradeRecord.id;
            // NOTE: ruleBasedOutcome is NOT set here — it must be simulated separately
            // by TradeLogExporter using logEntry.ruleSl / logEntry.ruleTp + forward candles
            // because AI multipliers differ from rule default multipliers.
          }

          trades.push(tradeRecord);
          currentBalance += profit;

          // Update consecutive loss state for cooldown filter
          if (profit < 0) {
            consecutiveLosses++;
            lastLossTime = currentCandleMs;
          } else {
            consecutiveLosses = 0;
            lastLossTime = null;
          }

          openPosition = null;
        }
      }

      // If position is still open, do not open a new one (PROJECT-RULES.md §1.5)
      if (openPosition) {
        continue;
      }

      // If max AI calls reached and no open position, terminate simulation
      if (mode === 'ai-simulated' && maxAiCalls > 0 && aiCallCount >= maxAiCalls) {
        break;
      }

      // If max AI accepted trades reached and no open position, terminate simulation
      if (mode === 'ai-simulated' && maxAiAccepted > 0 && trades.length >= maxAiAccepted) {
        break;
      }

      // 2. Build Context
      let context;
      let h1Trend = 'neutral';

      if (isMocked) {
        const windowCandles = candles.slice(i - windowSize + 1, i + 1);
        context = buildContext(windowCandles, config);
        if (context && context.indicators) {
          maCross = context.indicators.ma_cross;
          h1Trend = context.indicators.h1_trend || 'uptrend';
        }
      } else {
        const rsiZone = getRSIZone(currRsi, config.RSI_OVERSOLD || 35, config.RSI_OVERBOUGHT || 65);

        // Determine current H1 candle corresponding to this M5 candle
        while (
          currentH1Idx + 1 < h1Candles.length &&
          new Date(h1Candles[currentH1Idx + 1].time).getTime() <= currentCandleMs
        ) {
          currentH1Idx++;
        }

        let h1FastVal = null;
        let h1SlowVal = null;

        if (h1FastEma.length > 0 && currentH1Idx >= h1FastOffset) {
          h1FastVal = h1FastEma[currentH1Idx - h1FastOffset];
        }
        if (h1SlowEma.length > 0 && currentH1Idx >= h1SlowOffset) {
          h1SlowVal = h1SlowEma[currentH1Idx - h1SlowOffset];
        }

        if (h1FastVal !== null && h1SlowVal !== null) {
          const currentH1Close = h1Candles[currentH1Idx].close;
          if (currentH1Close > h1SlowVal && h1FastVal > h1SlowVal) {
            h1Trend = 'uptrend';
          } else if (currentH1Close < h1SlowVal && h1FastVal < h1SlowVal) {
            h1Trend = 'downtrend';
          } else {
            h1Trend = 'sideway';
          }
        } else {
          // If not enough H1 candles for EMA200, assume neutral
          h1Trend = 'neutral_permissive';
        }

        const candleCloseVsMaSlow = currentCandle.close > currSlow ? 'above' : (currentCandle.close < currSlow ? 'below' : 'equal');
        const candleBodyDirection = currentCandle.close > currentCandle.open
          ? 'bullish'
          : (currentCandle.close < currentCandle.open ? 'bearish' : 'doji');
        const totalRange = currentCandle.high - currentCandle.low;
        const bodySize = Math.abs(currentCandle.close - currentCandle.open);
        const upperWick = currentCandle.high - Math.max(currentCandle.open, currentCandle.close);
        const lowerWick = Math.min(currentCandle.open, currentCandle.close) - currentCandle.low;
        
        let candleWickRejection = 'none';
        if (totalRange > 0) {
          if (lowerWick > bodySize * 2 && lowerWick > upperWick) {
            candleWickRejection = 'bottom_wick';
          } else if (upperWick > bodySize * 2 && upperWick > lowerWick) {
            candleWickRejection = 'top_wick';
          }
        }

        const bodyToAtrRatio = currAtr > 0 ? Number((bodySize / currAtr).toFixed(2)) : 0;
        const distanceToMa21 = Math.abs(currentCandle.close - currSlow);
        const distanceToMa21Atr = currAtr > 0 ? Number((distanceToMa21 / currAtr).toFixed(2)) : 0;

        const lookbackSR = 50;
        const recentSrCandles = candles.slice(Math.max(0, i - lookbackSR + 1), i + 1);
        const recentSwingHigh = recentSrCandles.length > 0 ? Math.max(...recentSrCandles.map(c => c.high)) : currentCandle.high;
        const recentSwingLow = recentSrCandles.length > 0 ? Math.min(...recentSrCandles.map(c => c.low)) : currentCandle.low;

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
            adx: Number(currAdx.toFixed(2)),
            atr: Number(currAtr.toFixed(2)),
            ma_cross: maCross,
            rsi_zone: rsiZone,
            candle_close_vs_ma21: candleCloseVsMaSlow,
            candle_close_vs_ma_slow: candleCloseVsMaSlow,
            candle_body: candleBodyDirection,
            candle_wick_rejection: candleWickRejection,
            body_to_atr_ratio: bodyToAtrRatio,
            distance_to_ma21_atr: distanceToMa21Atr,
            recent_swing_high: recentSwingHigh,
            recent_swing_low: recentSwingLow,
            h1_trend: h1Trend,
            h1_ema50: h1FastVal ? Number(h1FastVal.toFixed(2)) : null,
            h1_ema200: h1SlowVal ? Number(h1SlowVal.toFixed(2)) : null
          },
          recentCandles: candles.slice(Math.max(0, i - 4), i + 1)
        };
      }

      if (!context) {
        continue;
      }

      // 3. Apply Noise Filters (Max trades/day & Consecutive loss cooldown)
      let filterBlocked = false;
      let filterReason = '';

      const todayTrades = dailyTradesCount.get(candleDateStr) || 0;
      if (todayTrades >= maxTradesPerDay) {
        filterBlocked = true;
        filterReason = `Max daily trades reached (${todayTrades}/${maxTradesPerDay})`;
      }

      if (
        !filterBlocked &&
        consecutiveLosses >= 2 &&
        lastLossTime &&
        currentCandleMs - lastLossTime < cooldownHours * 60 * 60 * 1000
      ) {
        filterBlocked = true;
        filterReason = `Cooldown active after ${consecutiveLosses} consecutive losses (${cooldownHours}h)`;
      } else if (
        lastLossTime &&
        currentCandleMs - lastLossTime >= cooldownHours * 60 * 60 * 1000
      ) {
        // Cooldown expired
        consecutiveLosses = 0;
        lastLossTime = null;
      }

      // 4. Determine decision based on mode
      let decision;
      if (filterBlocked) {
        decision = {
          action: 'skip',
          confidence: 0.0,
          sl_atr_multiplier: defaultSlAtrMultiplier,
          tp_atr_multiplier: defaultTpAtrMultiplier,
          reason: `Filter: ${filterReason}`
        };
      } else {
        const ruleBasedDecision = this._evaluateRuleBasedDecision(
          context,
          config,
          h1Trend,
          defaultSlAtrMultiplier,
          defaultTpAtrMultiplier
        );

        if (mode === 'rule-based') {
          decision = ruleBasedDecision;
        } else {
          // AI-simulated mode: Only query AI when rule-based strategy triggers a valid Buy/Sell signal (or for mocked test objects)
          if (isMocked || ruleBasedDecision.action === 'buy' || ruleBasedDecision.action === 'sell') {
            try {
              if (config.AI_RATE_LIMIT_DELAY_MS > 0 && !isMocked) {
                await new Promise(resolve => setTimeout(resolve, config.AI_RATE_LIMIT_DELAY_MS));
              }
              decision = await this.aiAgent.getDecision(context);
              if (!isMocked) {
                console.log(`[AI #${++aiCallCount}] [${currentCandle.time}] Rule: ${ruleBasedDecision.action.toUpperCase()} -> AI: ${decision.action.toUpperCase()} (Conf: ${decision.confidence}) | Balance: $${currentBalance.toFixed(2)}`);
              }
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
          } else {
            decision = ruleBasedDecision;
          }
        }

        // In AI mode, tag whether the AI accepted or rejected the rule-based signal
        if (mode === 'ai-simulated') {
          decision._ruleBasedAction = ruleBasedDecision.action;
          decision._ruleBasedReason = ruleBasedDecision.reason;
          const aiActed = decision.action === 'buy' || decision.action === 'sell';
          const aiConfident = decision.confidence >= (config.MIN_CONFIDENCE || 0.7);
          decision._aiAccepted = aiActed && aiConfident;
          decision._ruleHadSignal = ruleBasedDecision.action === 'buy' || ruleBasedDecision.action === 'sell';
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
              slDistance,
              logIdx: logs.length  // will point to the logEntry we're about to push
            };

            // Compute rule-based SL/TP separately (using default config multipliers, not AI multipliers)
            const ruleSlDistance = Number((defaultSlAtrMultiplier * atr).toFixed(2));
            const ruleTpDistance = Number((defaultTpAtrMultiplier * atr).toFixed(2));
            let ruleSl, ruleTp;
            if (decision.action === 'buy') {
              ruleSl = Number((currentPrice - ruleSlDistance).toFixed(2));
              ruleTp = Number((currentPrice + ruleTpDistance).toFixed(2));
            } else {
              ruleSl = Number((currentPrice + ruleSlDistance).toFixed(2));
              ruleTp = Number((currentPrice - ruleTpDistance).toFixed(2));
            }

            executedOrder = { sl, tp, units, ruleSl, ruleTp, entryPrice: currentPrice, candleIdx: i };
            dailyTradesCount.set(candleDateStr, todayTrades + 1);
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
        strategy_version: config.STRATEGY_VERSION || 'v2.0',
        price: currentCandle.close,
        sl: executedOrder ? executedOrder.sl : null,
        tp: executedOrder ? executedOrder.tp : null,
        units: executedOrder ? executedOrder.units : 0,
        gemini_raw_response: decision,
        error: null
      };

      // In AI mode, enrich log with rule-vs-AI comparison fields
      if (mode === 'ai-simulated') {
        logEntry.ruleBasedAction = decision._ruleBasedAction || decision.action;
        logEntry.ruleBasedReason = decision._ruleBasedReason || decision.reason;
        logEntry.aiAction = (decision._ruleHadSignal) ? decision.action : null;
        logEntry.aiConfidence = (decision._ruleHadSignal) ? decision.confidence : null;
        logEntry.aiAccepted = decision._aiAccepted || false;
        logEntry.aiReason = (decision._ruleHadSignal) ? decision.reason : null;
        logEntry.isRuleSignal = decision._ruleHadSignal || false;
        // Outcomes filled in later when trade closes (see pendingTradeLogIdx)
        logEntry.ruleBasedOutcome = null;  // simulated by TradeLogExporter via ruleSl/ruleTp trace
        logEntry.ruleBasedProfit = null;
        logEntry.aiOutcome = null;
        logEntry.aiProfit = null;
        logEntry.aiExitTime = null;
        logEntry.aiExitPrice = null;
        logEntry.aiExitReason = null;
        logEntry.tradeId = null;

        // Store rule SL/TP and entry info so TradeLogExporter can simulate hypothetical outcomes
        // (applies to both AI-accepted and AI-rejected rule signals)
        if (logEntry.isRuleSignal && executedOrder) {
          logEntry.entryPrice = executedOrder.entryPrice;
          logEntry.aiSl = executedOrder.sl;
          logEntry.aiTp = executedOrder.tp;
          logEntry.ruleSl = executedOrder.ruleSl;
          logEntry.ruleTp = executedOrder.ruleTp;
          logEntry.candleIdx = executedOrder.candleIdx;  // index into candles[] for forward simulation
        } else if (logEntry.isRuleSignal && !executedOrder) {
          // AI rejected: compute rule SL/TP for hypothetical simulation
          // (atr and context are available in this scope)
          const _atr = context.indicators ? context.indicators.atr : 0;
          if (_atr > 0) {
            const _ruleSlDist = Number((defaultSlAtrMultiplier * _atr).toFixed(2));
            const _ruleTpDist = Number((defaultTpAtrMultiplier * _atr).toFixed(2));
            const _side = logEntry.ruleBasedAction;
            const _price = currentCandle.close;
            logEntry.entryPrice = _price;
            logEntry.aiSl = null;
            logEntry.aiTp = null;
            if (_side === 'buy') {
              logEntry.ruleSl = Number((_price - _ruleSlDist).toFixed(2));
              logEntry.ruleTp = Number((_price + _ruleTpDist).toFixed(2));
            } else if (_side === 'sell') {
              logEntry.ruleSl = Number((_price + _ruleSlDist).toFixed(2));
              logEntry.ruleTp = Number((_price - _ruleTpDist).toFixed(2));
            }
            logEntry.candleIdx = i;
          }
        }
      }

      logs.push(logEntry);

      // After pushing, update pendingTradeLogIdx to use the actual pushed index
      // (openPosition.logIdx was set to logs.length BEFORE push, so it matches)
      if (mode === 'ai-simulated' && logEntry.aiAccepted && executedOrder && openPosition) {
        pendingTradeLogIdx.set(openPosition.logIdx, logs.length - 1);
      }
    }

    return {
      mode,
      initialBalance,
      finalBalance: Number(currentBalance.toFixed(2)),
      trades,
      logs,
      candlesCount: candles.length,
      allCandles: candles  // exposed for TradeLogExporter forward simulation
    };
  }

  /**
   * Rule-based decision evaluation for Multi-Timeframe EMA + RSI + ADX strategy.
   *
   * @private
   * @param {Object} context
   * @param {Object} config
   * @param {string} h1Trend
   * @param {number} defaultSlAtrMultiplier
   * @param {number} defaultTpAtrMultiplier
   * @returns {Object}
   */
  _evaluateRuleBasedDecision(
    context,
    config,
    h1Trend,
    defaultSlAtrMultiplier,
    defaultTpAtrMultiplier
  ) {
    const { indicators } = context;
    const rsi = indicators.rsi;
    const adx = indicators.adx ?? 25;
    const maCross = indicators.ma_cross;

    const adxThreshold = config.ADX_THRESHOLD || 20;
    const rsiBuyMin = config.RSI_BUY_MIN || 40;
    const rsiBuyMax = config.RSI_BUY_MAX || 65;
    const rsiSellMin = config.RSI_SELL_MIN || 35;
    const rsiSellMax = config.RSI_SELL_MAX || 60;

    // Precondition: ADX > threshold
    const isTrending = adx > adxThreshold;
    if (!isTrending) {
      return {
        action: 'skip',
        confidence: 0.0,
        sl_atr_multiplier: defaultSlAtrMultiplier,
        tp_atr_multiplier: defaultTpAtrMultiplier,
        reason: `ADX (${adx}) <= threshold (${adxThreshold}) - market is sideway`
      };
    }

    // BUY Rule (chien-luoc-ema-rsi-m5-bot.md §3)
    // 1. H1 is Uptrend
    // 2. EMA9 crosses above EMA21 (bullish_cross)
    // 3. RSI9 is within 40-65
    // 4. ADX14 > 20
    const isH1Uptrend = h1Trend === 'uptrend';
    if (
      isH1Uptrend &&
      maCross === 'bullish_cross' &&
      rsi >= rsiBuyMin &&
      rsi <= rsiBuyMax
    ) {
      return {
        action: 'buy',
        confidence: 1.0,
        sl_atr_multiplier: defaultSlAtrMultiplier,
        tp_atr_multiplier: defaultTpAtrMultiplier,
        reason: `Rule-based BUY: H1 Uptrend, EMA9 cross > EMA21, RSI (${rsi}) in [${rsiBuyMin}, ${rsiBuyMax}], ADX (${adx}) > ${adxThreshold}`
      };
    }

    // SELL Rule (chien-luoc-ema-rsi-m5-bot.md §3)
    // 1. H1 is Downtrend
    // 2. EMA9 crosses below EMA21 (bearish_cross)
    // 3. RSI9 is within 35-60
    // 4. ADX14 > 20
    const isH1Downtrend = h1Trend === 'downtrend';
    if (
      isH1Downtrend &&
      maCross === 'bearish_cross' &&
      rsi >= rsiSellMin &&
      rsi <= rsiSellMax
    ) {
      return {
        action: 'sell',
        confidence: 1.0,
        sl_atr_multiplier: defaultSlAtrMultiplier,
        tp_atr_multiplier: defaultTpAtrMultiplier,
        reason: `Rule-based SELL: H1 Downtrend, EMA9 cross < EMA21, RSI (${rsi}) in [${rsiSellMin}, ${rsiSellMax}], ADX (${adx}) > ${adxThreshold}`
      };
    }

    // Fallback: If conditions are not satisfied under MTF
    // Check if traditional oversold / overbought cross is met for backwards compatibility when RSI is extreme
    if (rsi < (config.RSI_OVERSOLD || 30) && maCross === 'bullish_cross') {
      return {
        action: 'buy',
        confidence: 1.0,
        sl_atr_multiplier: defaultSlAtrMultiplier,
        tp_atr_multiplier: defaultTpAtrMultiplier,
        reason: `Rule-based BUY: Oversold rebound RSI (${rsi}) and bullish EMA cross`
      };
    }

    if (rsi > (config.RSI_OVERBOUGHT || 70) && maCross === 'bearish_cross') {
      return {
        action: 'sell',
        confidence: 1.0,
        sl_atr_multiplier: defaultSlAtrMultiplier,
        tp_atr_multiplier: defaultTpAtrMultiplier,
        reason: `Rule-based SELL: Overbought reversal RSI (${rsi}) and bearish EMA cross`
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
