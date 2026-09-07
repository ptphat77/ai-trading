# STRATEGY.md — XAU/USD Trading Strategy (Dual-Tier M5 Scalping)

> ⚠️ This document changes frequently during strategy optimization.
> Do not modify `ARCHITECTURE.md` when only changing parameters here — the code should only read parameters from here via config, without hardcoding.

**Current version**: v3.2.0
**Last updated**: 2026-09-07

---

## 1. Technical Indicators (Core Rules)

| Indicator | Parameter | Value (v3.2.0) | Description |
|---|---|---|---|
| **UT Bot (Fast)** | Key Value / ATR Period | `2` / `1` | Tier 1 SELL Signals |
| **UT Bot (Slow)** | Key Value / ATR Period | `2` / `300` | Tier 1 BUY Signals |
| **STC Oscillator** | Length / Fast / Slow | `60` / `35` / `50` | Momentum cycle detection |
| **STC AAA** | Factor | `0.7` | Smoothing factor (0.5 - 0.7) |
| **STC Bounds** | Buy Zone / Sell Zone | `< 20` / `> 80` | Extreme exhaustion zones |
| **EMA** | Period | `200` | Tier 2 Macro Trend Filter |
| **RSI** | Period / Oversold / Overbought | `14` / `< 40` / `> 60` | Tier 2 Momentum Confirmation |
| **ATR** | Period | `14` | Used to calculate dynamic SL/TP |

---

## 2. Entry & Exit Logic (Dual-Tier)

Used when running `BacktestEngine` or Live Bot. The system uses a Dual-Tier approach to maximize valid trades while maintaining safety.

### Tier 1 (Macro Exhaustion via UTBot)
- **BUY Signal:** `UT Bot 2` signals **BUY** AND `STC` < `20` AND `STC` is currently moving UP.
- **SELL Signal:** `UT Bot 1` signals **SELL** AND `STC` > `80` AND `STC` is currently moving DOWN.

### Tier 2 (Trend-Aligned Mean Reversion)
- **BUY Signal:** Price > `EMA 200` (Uptrend) AND `STC` < `20` (rising) AND `RSI` < `40` (oversold).
- **SELL Signal:** Price < `EMA 200` (Downtrend) AND `STC` > `80` (falling) AND `RSI` > `60` (overbought).

### Exit Rules
- **Dynamic Stop-Loss (SL)**: Set behind local pivot swing (lookback 50 candles) + `0.15 x ATR` buffer, bounded between `0.85 x ATR` and `1.15 x ATR`.
- **Fixed Take-Profit (TP)**: Enforced strict 1:2 Risk/Reward ratio (TP distance is exactly 2.0x SL distance).
- **Time-Decay Profit Take**: After 3 candles, if trade is stalled but in green profit (`floatingGain >= 0.20R`), bank profit at market price to protect against adverse retracements.
- **Stagnation Exit**: After 16 candles (80 mins) in sideways chop, close position to free margin.
- **Smart Early Exit**: If floating profit is `<= 0.20R` (loss or near breakeven) and opposite setup occurs, exit early.

---

## 3. AI Decision Layer — Configuration

| Parameter | Value | Notes |
|---|---|---|
| Confidence threshold (`MIN_CONFIDENCE`) | 0.70 | Below this threshold → automatically `skip` even if AI proposes buy/sell |
| AI Provider | Configured via `.env` (`AI_PROVIDER`) | Default: `gemini` / `qwen`. |
| AI Model | Configured via `.env` (`GEMINI_MODEL` or `DASHSCOPE_MODEL`) | Depends on active provider. Do not hardcode. |

---

## 4. Prompt Template (shared by all AI providers)

> The template below is stored in `src/ai/promptTemplate.js` and used by **all** AI agents (`QwenAgent`, `GeminiAgent`, etc.) via `BaseAIAgent`.

```
You are an expert Gold (XAU/USD) quantitative analyst and execution engine for a Dual-Tier M5 scalping strategy.
Your primary mission is HIGH-PRECISION SIGNAL FILTERING — eliminating false breakouts, chop, and counter-trend traps while preserving high-probability trend continuation setups.

### Strategy Rules & Multi-Factor Confluence:

1. Dual-Tier Entry Logic:
   - Tier 1: Relies on UTBot + STC extreme zones.
   - Tier 2: Relies on EMA200 Trend + STC extreme zones + RSI momentum.

2. Mandatory SKIP Conditions (Filter Out Noise):
   - Reject if trade is against major macroeconomic news flow (if provided).
   - Reject if the setup occurs during a clear flat-ranging market with no volume.

3. Dynamic Risk Parameters & Confidence Calibration:
   - sl_atr_multiplier: Use the mathematical calculation provided by the system.
   - tp_atr_multiplier: Use the mathematical calculation provided by the system.
   - Confidence scoring:
     * 0.80 - 1.00: High confidence (Clear trend + strong momentum + solid candle confirmation).
     * 0.70 - 0.79: Valid setup meeting rules.
     * Below 0.70: Conflicting signals -> output "skip".

Return strictly valid JSON in this schema:
{
  "action": "buy" | "sell" | "skip",
  "confidence": 0.0 to 1.0,
  "reason": "Concise technical explanation"
}
```

---

## 5. Risk Rules applied to this strategy

| Parameter | Value |
|---|---|
| Risk per trade | 1.5% account (`RISK_PER_TRADE`) |
| Max Trades per Day | Unlimited (Removed limitation) |
| Loss Cooldown | 2 hours after 2 consecutive losses |
| Leverage | 1:50 |

---

## 6. Strategy Changelog (parameters + backtest results)

| Version | Date | Changes | Reason | Backtest Results |
|---|---|---|---|---|
| v1.0.0 | 2026-08-29 | Baseline: MA9/21, RSI 30/70, confidence ≥ 0.70, Default SL/TP ATR 1.5/2.5 | Initialized based on the initial implementation plan | Not run yet |
| v1.1.0 | 2026-08-29 | Rule-based entry logic: RSI threshold 40/60 → 30/70 (matches Indicator Parameters) | Synchronized consistent oversold/overbought thresholds across all documents | Total Trades: 0 |
| v1.2.0 | 2026-08-30 | Switched MA to EMA9/21, added RSI extreme touch lookback (20 candles), and candle close confirmation | Fixed logic contradiction in v1.1 where RSI 30/70 and MA cross were mutually exclusive | Total Trades: 550, Win Rate: 38.7%, Profit Factor: 1.04, Net Profit: +$14,246.69 (+14.25%) |
| v1.3.0 | 2026-08-31 | EMA9/100, RSI 36/64 (lookback 18), SL 1.5 ATR / TP 1.1 ATR, Risk 1.75% per trade | Parameter optimization targeting ~66% Win Rate and 100% Net Profit | Total Trades: 352, Win Rate: 64.8%, Profit Factor: 1.34, Net Profit: +$104,732.62 (+104.73%) |
| v2.0.0 | 2026-09-01 | MTF H1 EMA50/200 Trend Filter, M5 EMA9/21 cross, RSI9 [40-65 buy / 35-60 sell], ADX14 > 20 | Implemented multi-timeframe strategy with optimized AI prompt filtering | Total Trades: 213, Win Rate: 60.1%, Profit Factor: 1.31, Net Profit: +$44,094.43 (+44.09%) |
| v2.1.0 | 2026-09-02 | Dynamic Market Structure SL, Dynamic Momentum TP, Hard constraint R:R >= 1:1, Smart Early Exit | Replaced overfitted fixed negative R:R with mathematically sound dynamic SL/TP | Total Trades: 173, Win Rate: 43.9%, Profit Factor: 1.18, Net Profit: +$26,431.82 (+26.43%) |
| v2.2.0 | 2026-09-02 | Dynamic SL (0.85-1.15 ATR), Dynamic TP (R:R >= 1:1.05), Time-Decay Profit Take (>= 3 candles & >= 0.25R) | Optimized trade management & dynamic exit timing to achieve >= 60% win-rate | Total Trades: 173, Win Rate: 60.1%, Profit Factor: 1.21, Net Profit: +$22,474.88 (+22.47%) |
| v2.3.0 | 2026-09-02 | Added loose EMA21 trailing stop, Adjusted Time-Decay thresholds (0.20R), Increased dynamic R:R | Tuned exit logic to hit PRD performance targets. | Total Trades: 174, Win Rate: 61.5%, Profit Factor: 1.51, Net Profit: +$58,864.84 (+58.86%) |
| v2.3.1 | 2026-09-02 | Tuned AI Prompt: tolerate minor wicks, don't fear local swing highs/lows in strong trend | Reduce False Negatives. Goal is to bring AI-simulated Profit Factor back to >= 1.5. | Total Trades: 151, Win Rate: 57.0%, Profit Factor: 1.27, Net Profit: +$19,357.97 (+19.36%) |
| v2.4.0 | 2026-09-02 | CORE LOGIC: Overrode AI-guessed SL/TP multipliers with dynamic mathematical multipliers | Prevent AI from guessing poor SL/TP multipliers. | Total Trades: 141, Win Rate: 60.3%, Profit Factor: 1.46, Net Profit: +$41,693.38 (+41.69%) |
| v2.4.1 | 2026-09-02 | PROMPT TWEAK: Relaxed candle shape restrictions | Reduce false negatives. | Total Trades: 162, Win Rate: 61.1%, Profit Factor: 1.49, Net Profit: +$52,536.02 (+52.54%) |
| v2.4.2 | 2026-09-02 | PROMPT TWEAK: Stripped all mathematical inequalities (RSI boundaries, ADX >, MA distance <) from prompt | Gemini Flash Lite struggled with decimal inequalities. | Total Trades: 167, Win Rate: 61.1%, Profit Factor: 1.48, Net Profit: +$51,744.28 (+51.74%) |
| v2.4.3 | 2026-09-02 | PROMPT TWEAK: Repositioned AI as a "Glaring Danger Detector" | Stop AI from trying to outsmart the mathematical engine. | Total Trades: 174, Win Rate: 61.5%, Profit Factor: 1.51, Net Profit: +$58,864.84 (+58.86%) |
| v2.4.4 | 2026-09-02 | PROMPT TWEAK: Filter `body_to_atr_ratio > 1.0` and distance to swing `< 6.0` | Exceed $58.8k Net Profit. | Total Trades: 137, Win Rate: 64.2%, Profit Factor: 1.65, Net Profit: +$54,139.27 (+54.14%) |
| v3.0.0 | 2026-09-07 | CORE LOGIC: Complete strategy overhaul to M5 Scalping with UT Bot Alerts and STC Oscillator. Removed H1 filter, EMA cross, ADX. Enforced strict 1:2 R/R ratio. | Requested by user based on new 5-minute scalping video. | Total Trades: 524, Win Rate: 57.4%, Profit Factor: 1.13, Net Profit: +$61,098.07 (+61.10%) |
| v3.1.0 | 2026-09-07 | RULE TWEAK: STC Length 80→60, Fast 27→35, Factor 0.5→0.7, Green Line 25→20, Red Line 75→80. All via 12-iteration parameter sweep. | Rule-based PF 1.13 was below target. Optimization discovered STC responsiveness & zone tightening improves quality. | Total Trades: 317, Win Rate: 60.9%, Profit Factor: 1.42, Net Profit: +$124,003.33 (+124.00%) |
| **v3.2.0** | **2026-09-07** | **CORE LOGIC: Added Tier 2 (EMA200 + RSI + STC Extreme) for mean reversion in direction of trend.** | **Goal to increase trade frequency to ~700/year (2/day) without sacrificing metrics. Dual-Tier proved highly effective.** | **Total Trades: 804, Win Rate: 62.4%, Profit Factor: 1.48, Net Profit: +$476,427.76 (+476.43%), Max DD: -18.89%** |

---

## 7. Link to trade log

Every record in `logs/trade_log.jsonl` and every `backtest_result.json` has a `strategy_version` field that matches the version at the time of the run, to know which parameter set was used for that trade/result (see `DATA-SCHEMA.md`).
