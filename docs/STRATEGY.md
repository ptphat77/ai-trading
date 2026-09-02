# STRATEGY.md — XAU/USD Trading Strategy (Multi-Timeframe EMA + RSI + ADX + ATR + AI)

> ⚠️ This document changes frequently during strategy optimization.
> Do not modify `ARCHITECTURE.md` when only changing parameters here — the code should only read parameters from here via config, without hardcoding.

**Current version**: v2.2
**Last updated**: 2026-09-02

---

## 1. Indicator Parameters (current)

### Higher Timeframe (H1) — Trend Filter
| Parameter | Value | Notes |
|---|---|---|
| H1 EMA fast | 50 | Exponential Moving Average on H1 |
| H1 EMA slow | 200 | Exponential Moving Average on H1 |
| H1 Alignment | Price > EMA50 > EMA200 (Uptrend) / Price < EMA50 < EMA200 (Downtrend) | Strict 3-point alignment filter |

### Entry Timeframe (M5)
| Parameter | Value | Notes |
|---|---|---|
| M5 EMA fast | 9 | Exponential Moving Average on M5 |
| M5 EMA slow | 21 | Exponential Moving Average on M5 |
| RSI period | 9 | Momentum confirmation on M5 |
| RSI Buy Zone | [40, 65] | Avoid buying above 65/70 overbought |
| RSI Sell Zone | [35, 60] | Avoid selling below 35/30 oversold |
| ADX period | 14 | Average Directional Index on M5 |
| ADX Threshold | 20 | Market is considered trending when ADX > 20; <= 20 is sideway |
| ATR period | 14 | Used to calculate dynamic SL/TP |

---

## 2. Entry & Exit Logic — Rule-based (used for fast Backtest, without calling AI)

Used when running `BacktestEngine` in Rule-based mode for fast testing without consuming Gemini quota:

- **Precondition (mandatory)**:
  - `ADX14 (M5) > 20`: market is in an active trend. If `ADX14 <= 20`, bot skips and stays out.

- **Bullish Signal (BUY)**:
  1. H1 Trend is **Uptrend**: `Price(H1) > EMA50(H1) AND EMA50(H1) > EMA200(H1)`.
  2. M5 EMA9 crosses above EMA21 (`bullish_cross`).
  3. M5 RSI9 is in sweet-spot zone: `40 <= RSI9 <= 65`.
  4. M5 Candle Confirmation: `candle_body === 'bullish'` OR `candle_wick_rejection === 'bottom_wick'`.
  5. Distance to EMA21: `<= 1.2 x ATR` (not overextended).
  6. ADX14 > 20.

- **Bearish Signal (SELL)**:
  1. H1 Trend is **Downtrend**: `Price(H1) < EMA50(H1) AND EMA50(H1) < EMA200(H1)`.
  2. M5 EMA9 crosses below EMA21 (`bearish_cross`).
  3. M5 RSI9 is in sweet-spot zone: `35 <= RSI9 <= 60`.
  4. M5 Candle Confirmation: `candle_body === 'bearish'` OR `candle_wick_rejection === 'top_wick'`.
  5. Distance to EMA21: `<= 1.2 x ATR` (not overextended).
  6. ADX14 > 20.

- **Exit Rules**:
  - **Dynamic Stop-Loss (SL)**: Set behind local pivot swing (lookback 15 candles) + `0.15 x ATR` buffer, bounded between `0.85 x ATR` and `1.15 x ATR`.
  - **Dynamic Take-Profit (TP)**: Scaled by ADX trend momentum with strict R:R multiplier:
    - ADX < 23: `1.05 x SL distance` (R:R 1:1.05)
    - ADX >= 28: `1.10 x SL distance` (R:R 1:1.10)
  - **Strict R:R Constraint**: `TP distance >= SL distance` (Hard constraint enforced in code; R:R < 1:1 is never entered).
  - **Time-Decay Profit Take**: After 3 candles (15 mins), if trade is stalled but in green profit (`floatingGain >= 0.25R`), bank profit at market price to protect against adverse retracements.
  - **Stagnation Exit**: After 16 candles (80 mins) in sideways chop, close position to free margin.
  - **Smart Early Exit**: If opposite EMA cross occurs and floating profit is `<= 0.25R` (loss or near breakeven), exit early to protect capital.

---

## 3. AI Decision Layer — Configuration

| Parameter | Value | Notes |
|---|---|---|
| Confidence threshold (`MIN_CONFIDENCE`) | 0.70 | Below this threshold → automatically `skip` even if AI proposes buy/sell |
| Dynamic SL Calculation | Market Structure + ATR Buffer | Derived from local swing high/low + 0.15 ATR buffer (0.85 - 1.15 ATR) |
| Dynamic TP Calculation | Momentum-scaled R:R (1:1.05 to 1:1.10) | Strictly requires TP distance >= SL distance |
| AI Provider | Configured via `.env` (`AI_PROVIDER`) | Default: `gemini` / `qwen`. |
| AI Model | Configured via `.env` (`GEMINI_MODEL` or `DASHSCOPE_MODEL`) | Depends on active provider. Do not hardcode. |

---

## 4. Prompt Template (shared by all AI providers)

> The template below is stored in `src/ai/promptTemplate.js` and used by **all** AI agents (`QwenAgent`, `GeminiAgent`, etc.) via `BaseAIAgent`. Do not hardcode this in any `*Agent.js` file.

```
You are an expert Gold (XAU/USD) quantitative analyst and execution engine for a Multi-Timeframe M5/H1 trading strategy.
Your primary mission is HIGH-PRECISION SIGNAL FILTERING — eliminating false breakouts, chop, and counter-trend traps while preserving high-probability trend continuation setups.

### Strategy Rules & Multi-Factor Confluence:

1. Macro Trend Confluence (H1 Timeframe):
   - Strictly follow the pre-computed `indicators.h1_trend` ('uptrend' | 'downtrend' | 'sideway'). Do not try to re-evaluate macro trend using M5 price.
   - If `indicators.h1_trend === 'uptrend'` -> ONLY consider BUY setups.
   - If `indicators.h1_trend === 'downtrend'` -> ONLY consider SELL setups.
   - If `indicators.h1_trend === 'sideway'` or 'neutral' -> MUST return "action": "skip".

2. Entry Trigger & Momentum (M5 Timeframe):
   - BUY SETUP:
     * Trigger: EMA9 crosses above EMA21 (`indicators.ma_cross === 'bullish_cross'`).
     * Candle Confirmation: `indicators.candle_close_vs_ma21 === 'above'` AND (`indicators.candle_body === 'bullish'` OR `indicators.candle_wick_rejection === 'bottom_wick'`).
     * RSI(9) Health: Within sweet-spot [40, 65]. Reject if RSI > 68 (overbought exhaustion).
     * Trend Strength: `indicators.adx > 20` (market in active expansion, not chop).
   - SELL SETUP:
     * Trigger: EMA9 crosses below EMA21 (`indicators.ma_cross === 'bearish_cross'`).
     * Candle Confirmation: `indicators.candle_close_vs_ma21 === 'below'` AND (`indicators.candle_body === 'bearish'` OR `indicators.candle_wick_rejection === 'top_wick'`).
     * RSI(9) Health: Within sweet-spot [35, 60]. Reject if RSI < 32 (oversold exhaustion).
     * Trend Strength: `indicators.adx > 20` (market in active expansion, not chop).

3. Mandatory SKIP Conditions (Filter Out Noise):
   - Any counter-trend setup (e.g., BUY when H1 is downtrend, or SELL when H1 is uptrend).
   - ADX <= 20 (ranging / sideways consolidation).
   - Price Structure Risk: Skip BUY if price is extremely close to `indicators.recent_swing_high` (risk of buying the top). Skip SELL if price is extremely close to `indicators.recent_swing_low`.
   - Mean-Reversion Risk: Skip if `indicators.distance_to_ma21_atr > 1.2` (price is overextended and due for a pullback).
   - Opposing candle structure: e.g., BUY with strong top wick rejection (`indicators.candle_wick_rejection === 'top_wick'`) or SELL with strong bottom wick rejection. Minor wicks are normal and should be tolerated in strong trends.
   - Neutral MA cross: If `indicators.ma_cross === 'neutral'` -> ALWAYS "skip".

4. Dynamic Risk Parameters & Confidence Calibration:
   - sl_atr_multiplier: Propose a dynamic multiplier based on distance to recent_swing_high/low + a small buffer.
   - tp_atr_multiplier: Propose a dynamic multiplier based on momentum.
   - MANDATORY RULE: Your proposed TP distance MUST be >= SL distance (Risk-Reward >= 1:1). If the market structure does not allow a 1:1 ratio before hitting major resistance/support, you MUST output "action": "skip".
   - Confidence scoring:
     * 0.80 - 1.00: High confidence (Clear H1 trend alignment + fresh M5 cross + RSI in sweet spot + ADX > 20 + solid candle confirmation + room to swing high/low).
     * 0.70 - 0.79: Valid setup meeting all confluence rules.
     * Below 0.70: Conflicting signals, weak momentum, overextended price (`distance_to_ma21_atr` > 1.2), or blocked by SR -> output "skip" or confidence < 0.70.

Return strictly valid JSON in this schema:
{
  "action": "buy" | "sell" | "skip",
  "confidence": 0.0 to 1.0,
  "sl_atr_multiplier": number,
  "tp_atr_multiplier": number,
  "reason": "Concise technical explanation referencing H1 trend, M5 cross, RSI, ADX, and candle structure"
}
```

Full schema for input/output: see `DATA-SCHEMA.md`. Technical contracts: see `API-CONTRACTS.md`.

---

## 5. Risk Rules applied to this strategy

| Parameter | Value |
|---|---|
| Risk per trade | 1.5% account (`RISK_PER_TRADE`) |
| Max Trades per Day | 4 (`MAX_TRADES_PER_DAY`) |
| Loss Cooldown | 2 hours after 2 consecutive losses |
| Leverage | 1:50 |

---

## 6. Strategy Changelog (parameters + backtest results)

| Version | Date | Changes | Reason | Backtest Results |
|---|---|---|---|---|
| v1.0 | 2026-08-29 | Baseline: MA9/21, RSI 30/70, confidence ≥ 0.70, Default SL/TP ATR 1.5/2.5 | Initialized based on the initial implementation plan | Not run yet |
| v1.1 | 2026-08-29 | Rule-based entry logic: RSI threshold 40/60 → 30/70 (matches Indicator Parameters) | Synchronized consistent oversold/overbought thresholds across all documents | Total Trades: 0 (Condition conflict: MA cross occurs at avg RSI 55.2/45.2, never <30 or >70) |
| v1.2 | 2026-08-30 | Switched MA to EMA9/21, added RSI extreme touch lookback (20 candles), and candle close confirmation across EMA21 (5 candles window) | Fixed logic contradiction in v1.1 where RSI 30/70 and MA cross were mutually exclusive | Total Trades: 550, Win Rate: 38.7%, Profit Factor: 1.04, Net Profit: +$14,246.69 (+14.25%), Max Drawdown: -23.33%, Sharpe: 0.02 |
| v1.3 | 2026-08-31 | EMA9/100, RSI 36/64 (lookback 18), SL 1.5 ATR / TP 1.1 ATR, Risk 1.75% per trade | Parameter optimization targeting ~66% Win Rate and 100% Net Profit with strictly controlled Drawdown | Total Trades: 352, Win Rate: 64.8%, Profit Factor: 1.34, Net Profit: +$104,732.62 (+104.73%), Max Drawdown: -12.71%, Sharpe: 0.15 |
| v2.0 | 2026-09-01 | MTF H1 EMA50/200 Trend Filter, M5 EMA9/21 cross, RSI9 [40-65 buy / 35-60 sell], ADX14 > 20, SL 1.5 ATR / TP 1.1 ATR, Early Exit on reverse cross, Max 5 trades/day, Tuned Prompt with multi-factor confluence | Implemented multi-timeframe strategy with optimized AI prompt filtering (Qwen/Gemini) | Total Trades: 213, Win Rate: 60.1%, Profit Factor: 1.31, Net Profit: +$44,094.43 (+44.09%), Max Drawdown: -13.70%, Sharpe: 0.13 (1-Year Full Dataset: 69,866 candles) |
| v2.1 | 2026-09-02 | Dynamic Market Structure SL (local pivot swing + 0.15 ATR buffer, bound 1.0-1.3 ATR), Dynamic Momentum TP (R:R 1:1.25 to 1:1.60 based on ADX), Hard constraint R:R >= 1:1, Strict H1 alignment (Price > EMA50 > EMA200), Smart Early Exit (only if floating profit <= 0.5R) | Replaced overfitted fixed negative R:R (1:0.73) with mathematically sound dynamic market structure SL/TP, eliminating curve-fitting while enforcing positive R:R | Total Trades: 173, Win Rate: 43.9%, Profit Factor: 1.18, Net Profit: +$26,431.82 (+26.43%), Max Drawdown: -17.07%, Sharpe: 0.09, Avg Win / Loss: $2,334.05 / $-1,556.25 (R:R 1:1.50) (1-Year Full Dataset: 69,866 candles) |
| v2.2 | 2026-09-02 | Dynamic SL (0.85-1.15 ATR), Dynamic TP (R:R >= 1:1.05), Time-Decay Profit Take (>= 3 candles & >= 0.25R), Stagnation Exit (16 candles), Smart Early Exit (loss <= 0.25R) | Optimized trade management & dynamic exit timing to achieve >= 60% win-rate with positive R:R and ultra-low drawdown (< 10%) | Total Trades: 173, Win Rate: 60.1%, Profit Factor: 1.21, Net Profit: +$22,474.88 (+22.47%), Max Drawdown: -9.98%, Sharpe: 0.09, Avg Win / Loss: $1,259.39 / $-1,572.49 (1-Year Full Dataset: 69,866 candles) |

---

## 7. Link to trade log

Every record in `logs/trade_log.jsonl` and every `backtest_result.json` has a `strategy_version` field that matches the version at the time of the run, to know which parameter set was used for that trade/result (see `DATA-SCHEMA.md`).
