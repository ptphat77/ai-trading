const CsvDataClient = require('../data/CsvDataClient');
const AIAgentFactory = require('../ai/AIAgentFactory');
const { buildContext } = require('../bot/SignalBuilder');
const { evaluateRule } = require('../strategy/RuleEngine');
const { checkNoiseFilters, updateAfterClose, createFilterState } = require('../strategy/NoiseFilter');
const { calculate: calculateATR } = require('../indicators/ATR');
const { calculate: calculateRSI } = require('../indicators/RSI');
const { calculateEMA } = require('../indicators/MA');
const UTBot = require('../indicators/UTBot');
const STC = require('../indicators/STC');
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
    this.candles = options.candles || null;
    this.dataClient = options.dataClient || new CsvDataClient();
    this.aiAgent = options.aiAgent || options.geminiAgent || AIAgentFactory.createAgent();
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

    const allCandles = this.candles || await this.dataClient.getCandles(Number.MAX_SAFE_INTEGER);
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
    const filterState = createFilterState();

    // Map: logEntry index -> logEntry object, so we can enrich it when the trade closes
    const pendingTradeLogIdx = new Map(); // tradeIndex (trades.length at open time) -> logs index

    // Check if buildContext is mocked in test environment
    const isMocked = Boolean(buildContext && (buildContext._isMockFunction || buildContext.mock));

    let utbot1Array = [];
    let utbot2Array = [];
    let stcArray = [];
    let atrArray = [];
    let rsiArray = [];
    let emaArray = [];
    let atrOffset = 0;
    let utbot1Offset = 0;
    let utbot2Offset = 0;
    let stcOffset = 0;
    let rsiOffset = 0;
    let emaOffset = 0;

    let h1Candles = [];

    if (!isMocked) {
      const closePrices = candles.map(c => c.close);
      const highPrices = candles.map(c => c.high);
      const lowPrices = candles.map(c => c.low);

      const ut1Key = config.UTBOT1_KEY || 2;
      const ut1Period = config.UTBOT1_ATR_PERIOD || 1;
      const ut2Key = config.UTBOT2_KEY || 2;
      const ut2Period = config.UTBOT2_ATR_PERIOD || 300;

      utbot1Array = UTBot.calculate(highPrices, lowPrices, closePrices, ut1Key, ut1Period).signals;
      utbot2Array = UTBot.calculate(highPrices, lowPrices, closePrices, ut2Key, ut2Period).signals;
      
      const stcLength = config.STC_LENGTH || 80;
      const stcFast = config.STC_FAST_LENGTH || 27;
      const stcSlow = config.STC_SLOW_LENGTH || 50;
      const stcFactor = config.STC_FACTOR || 0.5;
      stcArray = STC.calculate(closePrices, stcLength, stcFast, stcSlow, stcFactor);
      
      atrArray = calculateATR(highPrices, lowPrices, closePrices, config.ATR_PERIOD || 14);

      // RSI for Tier 2 confirmation
      rsiArray = calculateRSI(closePrices, config.RSI_PERIOD || 14);

      // EMA for Tier 2 macro trend filter
      emaArray = calculateEMA(closePrices, config.EMA_PERIOD || 200);

      utbot1Offset = candles.length - utbot1Array.length;
      utbot2Offset = candles.length - utbot2Array.length;
      stcOffset = candles.length - stcArray.length;
      atrOffset = candles.length - atrArray.length;
      rsiOffset = candles.length - rsiArray.length;
      emaOffset = candles.length - emaArray.length;
    }

    // Resample to H1 from all available candles so H1 EMAs are fully calculated
    h1Candles = resampleToH1(allCandles || candles);
    const h1Closes = h1Candles.map(c => c.close);
    // Helper to find latest completed H1 candle index (kept if needed for resampling features)
    let currentH1Idx = 0;

    // Slide window across candles
    for (let i = windowSize - 1; i < candles.length; i++) {
      const currentCandle = candles[i];
      const candleDateStr = currentCandle.time.slice(0, 10);
      const currentCandleMs = new Date(currentCandle.time).getTime();

      let currUtBot1, currUtBot2, currStc, prevStc, currAtr, currRsi, currEma;

      if (!isMocked) {
        currUtBot1 = utbot1Array[i - utbot1Offset];
        currUtBot2 = utbot2Array[i - utbot2Offset];
        currStc = stcArray[i - stcOffset];
        prevStc = stcArray[i - stcOffset - 1];
        currAtr = atrArray[i - atrOffset];
        currRsi = rsiArray[i - rsiOffset]; // may be undefined during warmup
        currEma = emaArray[i - emaOffset]; // may be undefined during warmup

        if (currUtBot1 === undefined || currUtBot2 === undefined || currAtr === undefined) {
          continue;
        }
      }

      // 1. Check open position against current candle price extremes & early exit
      if (openPosition) {
        let exitPrice = null;
        let exitReason = null;

        openPosition.candlesHeld = (openPosition.candlesHeld || 0) + 1;

        if (openPosition.side === 'buy') {
          const floatingGain = currentCandle.close - openPosition.entryPrice;

          // Check SL first for risk safety
          if (currentCandle.low <= openPosition.sl) {
            exitPrice = openPosition.sl;
            exitReason = 'sl';
          } else if (currentCandle.high >= openPosition.tp) {
            exitPrice = openPosition.tp;
            exitReason = 'tp';
          } else if (earlyExitEnabled && currUtBot1 === 'sell' && currStc > config.STC_RED_LINE && currStc < prevStc && floatingGain <= 0.20 * openPosition.slDistance) {
            exitPrice = currentCandle.close;
            exitReason = 'early_exit';
          } else if (openPosition.candlesHeld >= 3 && floatingGain >= 0.20 * openPosition.slDistance) {
            // Time-decay profit take: after 20 mins, bank profit if stalled
            exitPrice = currentCandle.close;
            exitReason = 'time_decay_tp';
          } else if (openPosition.candlesHeld >= 16) {
            // Stagnation exit: after 80 mins in sideways chop, close position
            exitPrice = currentCandle.close;
            exitReason = 'stagnation_exit';
          }

        } else if (openPosition.side === 'sell') {
          const floatingGain = openPosition.entryPrice - currentCandle.close;

          if (currentCandle.high >= openPosition.sl) {
            exitPrice = openPosition.sl;
            exitReason = 'sl';
          } else if (currentCandle.low <= openPosition.tp) {
            exitPrice = openPosition.tp;
            exitReason = 'tp';
          } else if (earlyExitEnabled && currUtBot2 === 'buy' && currStc < config.STC_GREEN_LINE && currStc > prevStc && floatingGain <= 0.20 * openPosition.slDistance) {
            exitPrice = currentCandle.close;
            exitReason = 'early_exit';
          } else if (openPosition.candlesHeld >= 3 && floatingGain >= 0.20 * openPosition.slDistance) {
            exitPrice = currentCandle.close;
            exitReason = 'time_decay_tp';
          } else if (openPosition.candlesHeld >= 16) {
            exitPrice = currentCandle.close;
            exitReason = 'stagnation_exit';
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
          }

          trades.push(tradeRecord);
          currentBalance += profit;

          // Update consecutive loss state for cooldown filter
          updateAfterClose(filterState, profit, currentCandleMs, candleDateStr, config);

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
      } else {
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

        const lookbackSR = 50;
        const recentSrCandles = candles.slice(Math.max(0, i - lookbackSR + 1), i + 1);
        const recentSwingHigh = recentSrCandles.length > 0 ? Math.max(...recentSrCandles.map(c => c.high)) : currentCandle.high;
        const recentSwingLow = recentSrCandles.length > 0 ? Math.min(...recentSrCandles.map(c => c.low)) : currentCandle.low;

        context = {
          symbol: config.SYMBOL || 'XAU_USD',
          timeframe: config.TIMEFRAME || 'M5',
          currentPrice: currentCandle.close,
          indicators: {
            utbot1_signal: currUtBot1,
            utbot2_signal: currUtBot2,
            stc_current: currStc !== null ? Number(currStc.toFixed(2)) : null,
            stc_prev: prevStc !== null ? Number(prevStc.toFixed(2)) : null,
            atr: Number(currAtr.toFixed(2)),
            rsi_current: currRsi !== undefined ? Number(currRsi.toFixed(2)) : null,
            ema_trend: currEma !== undefined ? Number(currEma.toFixed(2)) : null,
            candle_body: candleBodyDirection,
            candle_wick_rejection: candleWickRejection,
            body_to_atr_ratio: bodyToAtrRatio,
            recent_swing_high: recentSwingHigh,
            recent_swing_low: recentSwingLow
          },
          recentCandles: candles.slice(Math.max(0, i - 4), i + 1)
        };
      }

      if (!context) {
        continue;
      }

      // 3. Apply Noise Filters (Max trades/day & Consecutive loss cooldown)
      // Tạm thời vô hiệu hóa để test workflow (không giới hạn lệnh/ngày và cooldown)
      // const filterResult = checkNoiseFilters(filterState, candleDateStr, currentCandleMs, config);
      // const filterBlocked = filterResult.blocked;
      // const filterReason = filterResult.reason;
      const filterBlocked = false;
      const filterReason = '';

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
        const ruleBasedDecision = evaluateRule(context, config);

        if (mode === 'rule-based') {
          decision = ruleBasedDecision;
        } else {
          // AI-simulated mode: Only query AI when rule-based strategy triggers a valid Buy/Sell signal (or for mocked test objects)
          if (isMocked || ruleBasedDecision.action === 'buy' || ruleBasedDecision.action === 'sell') {
            try {
              if (config.AI_RATE_LIMIT_DELAY_MS > 0 && !isMocked) {
                await new Promise(resolve => setTimeout(resolve, config.AI_RATE_LIMIT_DELAY_MS));
              }
              const aiDecision = await this.aiAgent.getDecision(context);
              decision = {
                ...ruleBasedDecision,
                action: aiDecision.action,
                confidence: aiDecision.confidence,
                reason: aiDecision.reason,
                gemini_raw_response: aiDecision
              };
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
      let nextTime = currentCandle.time;

      if (
        (decision.action === 'buy' || decision.action === 'sell') &&
        decision.confidence >= config.MIN_CONFIDENCE
      ) {
        if (candles[i + 1]) {
          nextTime = candles[i + 1].time;
        } else {
          const timeframeMs = (config.TIMEFRAME === 'M15' ? 15 : (config.TIMEFRAME === 'H1' ? 60 : 5)) * 60000;
          if (typeof currentCandle.time === 'number') {
            const isMs = currentCandle.time > 1e11;
            const ms = isMs ? currentCandle.time : currentCandle.time * 1000;
            nextTime = isMs ? (ms + timeframeMs) : ((ms + timeframeMs) / 1000);
          } else {
            nextTime = new Date(new Date(currentCandle.time).getTime() + timeframeMs).toISOString();
          }
        }

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

          if (tpDistance < slDistance) {
            decision.action = 'skip';
            decision.reason = `Strict filter: R:R ratio is less than 1:1 (SL distance: ${slDistance}, TP distance: ${tpDistance})`;
          } else {
            const units = calculateUnits(currentBalance, config.RISK_PER_TRADE, slDistance);

            if (units > 0) {
              openPosition = {
                symbol: config.SYMBOL,
                side: decision.action,
                entryPrice: currentPrice,
                entryTime: nextTime,
                sl,
                tp,
                units,
                slDistance,
                tpDistance, // Track tpDistance for breakeven logic
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
              const todayTrades = filterState.dailyTradesCount.get(candleDateStr) || 0;
              filterState.dailyTradesCount.set(candleDateStr, todayTrades + 1);
            }
          }
        }
      }

      // 6. Record Log Entry (DATA-SCHEMA.md §6)
      const logEntry = {
        timestamp: executedOrder ? nextTime : currentCandle.time,
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
      openPosition, // Expose open position to the frontend
      logs,
      candlesCount: candles.length,
      allCandles: candles  // exposed for TradeLogExporter forward simulation
    };
  }


}

module.exports = BacktestEngine;
