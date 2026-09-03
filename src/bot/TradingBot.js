const CsvDataClient = require('../data/CsvDataClient');
const AIAgentFactory = require('../ai/AIAgentFactory');
const SignalBuilder = require('./SignalBuilder');
const { calculateUnits } = require('./RiskManager');
const notifier = require('../utils/notifier');
const { log } = require('../utils/logger');
const globalConfig = require('../config');

class TradingBot {
  /**
   * @param {Object} [options]
   * @param {Object} [options.dataClient] - Data provider (CsvDataClient / BrokerClient)
   * @param {Object} [options.aiAgent] - AI Agent instance
   * @param {Object} [options.config] - Configuration overrides
   */
  constructor(options = {}) {
    this.config = { ...globalConfig, ...options.config };
    this.dataClient = options.dataClient || new CsvDataClient();
    this.aiAgent = options.aiAgent || AIAgentFactory.createAgent();
    this.isRunning = false;
  }

  /**
   * Evaluates a single market cycle for a given set of candles.
   * Can be called directly for testing or during live loops.
   * 
   * @param {Array} [candles] - Optional array of candles. If omitted, fetched from dataClient.
   * @returns {Promise<Object>} The evaluation result
   */
  async evaluateCycle(candles = null) {
    const config = this.config;
    const candleCount = config.CANDLE_COUNT || 100;

    if (!candles) {
      candles = await this.dataClient.getCandles(candleCount);
    }

    if (!candles || candles.length < 30) {
      log('warn', 'Số lượng nến không đủ để phân tích chỉ báo.');
      return { status: 'insufficient_candles' };
    }

    // 1. Xây dựng Context và tính toán các chỉ báo kỹ thuật
    const context = SignalBuilder.buildContext(candles, config);
    if (!context || !context.indicators) {
      log('warn', 'Không thể khởi tạo context từ dữ liệu nến.');
      return { status: 'context_failed' };
    }

    // 2. Đánh giá tín hiệu kỹ thuật (Tier 1: Rule-based)
    const ruleDecision = this._evaluateRuleDecision(context);
    log('info', `[Rule Check] Action: ${ruleDecision.action.toUpperCase()} | Reason: ${ruleDecision.reason}`);

    // Nếu không có tín hiệu Buy/Sell từ Rule -> Skip chu kỳ này
    if (ruleDecision.action !== 'buy' && ruleDecision.action !== 'sell') {
      return {
        action: 'skip',
        ruleDecision,
        context
      };
    }

    // 3. Tính toán SL, TP tham khảo từ ATR
    const currentPrice = context.currentPrice;
    const atr = context.indicators.atr || 1.0;
    const defaultSlMultiplier = config.DEFAULT_SL_ATR_MULTIPLIER || 1.2;
    const defaultTpMultiplier = config.DEFAULT_TP_ATR_MULTIPLIER || 1.8;

    const slDistance = Number((defaultSlMultiplier * atr).toFixed(2));
    const tpDistance = Number((defaultTpMultiplier * atr).toFixed(2));

    const sl = ruleDecision.action === 'buy'
      ? Number((currentPrice - slDistance).toFixed(2))
      : Number((currentPrice + slDistance).toFixed(2));

    const tp = ruleDecision.action === 'buy'
      ? Number((currentPrice + tpDistance).toFixed(2))
      : Number((currentPrice - tpDistance).toFixed(2));

    const calculatedOrder = {
      entryPrice: currentPrice,
      sl,
      tp,
      slDistance,
      tpDistance
    };

    // 4. Gọi AI phân tích (Tier 2)
    log('info', `Phát hiện tín hiệu ${ruleDecision.action.toUpperCase()} từ Rule -> Đang gửi sang AI (${config.AI_PROVIDER})...`);
    let aiDecision = null;
    try {
      aiDecision = await this.aiAgent.getDecision(context);
      log('info', `[AI Phản hồi] Action: ${aiDecision.action.toUpperCase()} | Confidence: ${(aiDecision.confidence * 100).toFixed(0)}% | Lý do: ${aiDecision.reason}`);
    } catch (error) {
      log('error', `Lỗi khi gọi AI: ${error.message}`);
      aiDecision = {
        action: 'skip',
        confidence: 0,
        reason: `AI API Error: ${error.message}`
      };
    }

    // 5. Bắn tín hiệu Telegram kết hợp Rule + AI
    notifier.sendSignalAlert({
      ruleDecision,
      aiDecision,
      context,
      calculatedOrder
    });

    // 6. Xử lý chế độ thực thi (BOT_MODE)
    if (config.BOT_MODE === 'signal_only') {
      log('info', 'Chế độ [signal_only]: Đã gửi Signal về Telegram, bỏ qua bước đặt lệnh.');
      return {
        action: ruleDecision.action,
        ruleDecision,
        aiDecision,
        calculatedOrder,
        executed: false
      };
    }

    // Nếu là chế độ auto_trade
    if (config.BOT_MODE === 'auto_trade') {
      const isApproved = aiDecision &&
        aiDecision.action === ruleDecision.action &&
        aiDecision.confidence >= (config.MIN_CONFIDENCE || 0.7);

      if (!isApproved) {
        log('info', 'AI không đồng thuận hoặc độ tin cậy thấp -> Không đặt lệnh.');
        return {
          action: 'skip',
          ruleDecision,
          aiDecision,
          executed: false
        };
      }

      // Kiểm tra vị thế đang mở
      const openPositions = await this.dataClient.getOpenPositions(config.SYMBOL);
      if (openPositions && openPositions.length > 0) {
        log('warn', 'Đang có vị thế mở, không mở thêm lệnh.');
        return { action: 'skip', reason: 'position_already_open' };
      }

      // Tính số lượng units qua RiskManager
      const balance = await this.dataClient.getAccountBalance();
      const units = calculateUnits(balance, config.RISK_PER_TRADE, slDistance);

      if (units <= 0) {
        log('warn', 'RiskManager tính toán units <= 0, bỏ qua lệnh.');
        return { action: 'skip', reason: 'zero_units' };
      }

      log('info', `Đặt lệnh ${ruleDecision.action.toUpperCase()} | Units: ${units} | SL: ${sl} | TP: ${tp}`);
      const orderResult = await this.dataClient.createOrder(
        ruleDecision.action,
        units,
        sl,
        tp
      );

      notifier.sendAlert(`✅ <b>ĐÃ KHỚP LỆNH ${ruleDecision.action.toUpperCase()}</b>\nUnits: ${units}\nPrice: ${currentPrice}\nSL: ${sl} | TP: ${tp}`);

      return {
        action: ruleDecision.action,
        ruleDecision,
        aiDecision,
        orderResult,
        executed: true
      };
    }

    return {
      action: ruleDecision.action,
      ruleDecision,
      aiDecision
    };
  }

  /**
   * Evaluates technical rules (Tier 1).
   * @private
   */
  _evaluateRuleDecision(context) {
    const { indicators } = context;
    const rsi = indicators.rsi;
    const adx = indicators.adx ?? 25;
    const maCross = indicators.ma_cross;
    const h1Trend = indicators.h1_trend || 'neutral';

    const adxThreshold = this.config.ADX_THRESHOLD || 20;
    const rsiBuyMin = this.config.RSI_BUY_MIN || 40;
    const rsiBuyMax = this.config.RSI_BUY_MAX || 65;
    const rsiSellMin = this.config.RSI_SELL_MIN || 35;
    const rsiSellMax = this.config.RSI_SELL_MAX || 60;

    if (adx <= adxThreshold) {
      return {
        action: 'skip',
        reason: `ADX (${adx}) <= ${adxThreshold} - Thị trường sideway/không có sóng.`
      };
    }

    const isBullishCandle = indicators.candle_body === 'bullish' || indicators.candle_wick_rejection === 'bottom_wick';
    const notOverextended = (indicators.distance_to_ma21_atr || 0) <= 1.2;

    // BUY Rule
    if (
      (h1Trend === 'uptrend' || h1Trend === 'neutral_permissive') &&
      maCross === 'bullish_cross' &&
      rsi >= rsiBuyMin &&
      rsi <= rsiBuyMax &&
      isBullishCandle &&
      notOverextended
    ) {
      return {
        action: 'buy',
        reason: `Tín hiệu BUY: H1 Uptrend, M5 Bullish Cross, RSI (${rsi}) trong [${rsiBuyMin}, ${rsiBuyMax}], ADX (${adx}) > ${adxThreshold}`
      };
    }

    const isBearishCandle = indicators.candle_body === 'bearish' || indicators.candle_wick_rejection === 'top_wick';

    // SELL Rule
    if (
      (h1Trend === 'downtrend' || h1Trend === 'neutral_permissive') &&
      maCross === 'bearish_cross' &&
      rsi >= rsiSellMin &&
      rsi <= rsiSellMax &&
      isBearishCandle &&
      notOverextended
    ) {
      return {
        action: 'sell',
        reason: `Tín hiệu SELL: H1 Downtrend, M5 Bearish Cross, RSI (${rsi}) trong [${rsiSellMin}, ${rsiSellMax}], ADX (${adx}) > ${adxThreshold}`
      };
    }

    return {
      action: 'skip',
      reason: `Chưa thỏa mãn điều kiện chiến lược (Cross: ${maCross}, RSI: ${rsi}, H1: ${h1Trend})`
    };
  }

  /**
   * Main bot loop.
   */
  async run() {
    this.isRunning = true;
    const mode = (this.config.BOT_MODE || 'signal_only').toUpperCase();
    log('info', `Khởi động TradingBot... [Mode: ${mode}]`);
    notifier.sendAlert(`🟢 <b>TradeBot Khởi Động</b>\nChế độ: <b>${mode}</b>\nSymbol: ${this.config.SYMBOL} | Timeframe: ${this.config.TIMEFRAME}`);

    const cycle = async () => {
      if (!this.isRunning) return;
      try {
        await this.evaluateCycle();
      } catch (err) {
        log('error', `Lỗi trong chu kỳ giao dịch: ${err.message}`);
        notifier.sendAlert(`🚨 <b>LỖI CHU KỲ BOT:</b> ${err.message}`);
      }
      this._scheduleNextCycle();
    };

    this._scheduleNextCycle = () => {
      if (!this.isRunning) return;
      
      const now = new Date();
      // Calculate the next 5-minute boundary (e.g., 05, 10, 15, 20)
      const currentMinute = now.getMinutes();
      const nextMinute = Math.ceil((currentMinute + 1) / 5) * 5; 
      
      // Add a 5-second buffer to ensure the exchange's candle is fully closed and available via API
      const nextTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), nextMinute, 5, 0);
      
      const delayMs = nextTime.getTime() - now.getTime();
      
      log('info', `[Sync] Đã đồng bộ đồng hồ. Kiểm tra nến tiếp theo lúc ${nextTime.toLocaleTimeString()} (đợi ${(delayMs/1000).toFixed(0)}s).`);
      
      this.timer = setTimeout(cycle, delayMs);
    };

    // Chạy ngay chu kỳ đầu tiên để test, sau đó tự động vào guồng đồng bộ giờ
    await cycle();
  }

  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    log('info', 'TradingBot đã dừng.');
  }
}

module.exports = TradingBot;
