# STRATEGY.md — XAU/USD Trading Strategy (Multi-Timeframe EMA + RSI + ADX + ATR + AI)

> ⚠️ This document changes frequently during strategy optimization.
> Do not modify `ARCHITECTURE.md` when only changing parameters here — the code should only read parameters from here via config, without hardcoding.

**Current version**: v2.0
**Last updated**: 2026-09-01

---

## 1. Indicator Parameters (current)

### Higher Timeframe (H1) — Trend Filter
| Parameter | Value | Notes |
|---|---|---|
| H1 EMA fast | 50 | Exponential Moving Average on H1 |
| H1 EMA slow | 200 | Exponential Moving Average on H1 |

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
  1. H1 Trend is **Uptrend**: `Price(H1) > EMA200(H1) AND EMA50(H1) > EMA200(H1)`.
  2. M5 EMA9 crosses above EMA21 (`bullish_cross`).
  3. M5 RSI9 is in sweet-spot zone: `40 <= RSI9 <= 65`.
  4. ADX14 > 20.

- **Bearish Signal (SELL)**:
  1. H1 Trend is **Downtrend**: `Price(H1) < EMA200(H1) AND EMA50(H1) < EMA200(H1)`.
  2. M5 EMA9 crosses below EMA21 (`bearish_cross`).
  3. M5 RSI9 is in sweet-spot zone: `35 <= RSI9 <= 60`.
  4. ADX14 > 20.

- **Exit Rules**:
  - **Stop-Loss (SL)**: `1.5 x ATR14` (M5).
  - **Take-Profit (TP)**: `1.1 x ATR14` (M5).
  - **Early Exit**: If `openPosition.side === 'buy'` and EMA9 crosses below EMA21 on M5 before reaching SL/TP -> close position at market close price. If `openPosition.side === 'sell'` and EMA9 crosses above EMA21 -> close position at market close price.

---

## 3. AI Decision Layer — Configuration

| Parameter | Value | Notes |
|---|---|---|
| Confidence threshold (`MIN_CONFIDENCE`) | 0.70 | Below this threshold → automatically `skip` even if AI proposes buy/sell |
| Default SL ATR multiplier | 1.5 | AI agent can propose a tailored value in response |
| Default TP ATR multiplier | 1.1 | AI agent can propose a tailored value in response |
| AI Provider | Configured via `.env` (`AI_PROVIDER`) | Default: `qwen` (Alibaba DashScope). Set `AI_PROVIDER=gemini` to switch to Google Gemini. |
| AI Model | Configured via `.env` (`DASHSCOPE_MODEL` or `GEMINI_MODEL`) | Depends on active provider. Do not hardcode. |

---

## 4. Prompt Template (shared by all AI providers)

> The template below is stored in `src/ai/promptTemplate.js` and used by **all** AI agents (`QwenAgent`, `GeminiAgent`, etc.) via `BaseAIAgent`. Do not hardcode this in any `*Agent.js` file.

```
You are an expert Gold (XAU/USD) quantitative analyst and execution engine for a Multi-Timeframe M5/H1 trading strategy.
Your primary mission is HIGH-PRECISION SIGNAL FILTERING — eliminating false breakouts, chop, and counter-trend traps.

### Strategy Rules & Multi-Factor Confluence:

1. Macro Trend Confluence (H1 Timeframe):
   - UPTREND: Price > EMA200(H1) AND EMA50(H1) > EMA200(H1) -> ONLY consider BUY setups.
   - DOWNTREND: Price < EMA200(H1) AND EMA50(H1) < EMA200(H1) -> ONLY consider SELL setups.
   - SIDEWAY / CONFLICT: If H1 trend is mixed or unclear -> MUST return "action": "skip".

2. Entry Trigger & Momentum (M5 Timeframe):
   - BUY SETUP:
     * Trigger: EMA9 crosses above EMA21 (ma_cross === 'bullish_cross').
     * Candle Confirmation: Latest M5 candle close MUST be ABOVE EMA21 with bullish body or bottom wick (buying pressure).
     * RSI(9) Health: Within sweet-spot [40, 65]. Reject if RSI > 68 (overbought exhaustion).
     * Trend Strength: ADX(14) > 20 (market in active expansion, not chop).
   - SELL SETUP:
     * Trigger: EMA9 crosses below EMA21 (ma_cross === 'bearish_cross').
     * Candle Confirmation: Latest M5 candle close MUST be BELOW EMA21 with bearish body or top wick (selling pressure).
     * RSI(9) Health: Within sweet-spot [35, 60]. Reject if RSI < 32 (oversold exhaustion).
     * Trend Strength: ADX(14) > 20 (market in active expansion, not chop).

3. Mandatory SKIP Conditions (Filter Out Noise):
   - Any counter-trend setup (e.g., BUY when H1 is downtrend, or SELL when H1 is uptrend).
   - ADX <= 20 (sideways consolidation / ranging market).
   - Conflicted price action: Large opposing wick on trigger candle or price trapped between EMA9 and EMA21.
   - Neutral MA cross: If ma_cross === 'neutral' -> ALWAYS "skip".

4. Risk Parameters & Confidence Calibration:
   - sl_atr_multiplier: 1.5 (default; range 1.2 to 1.6 based on distance to swing structural level).
   - tp_atr_multiplier: 1.1 (default; range 1.0 to 1.5 based on momentum).
   - Confidence scoring:
     * 0.80 - 1.00: Perfect alignment (H1 clear trend + fresh M5 cross + RSI in sweet spot + ADX > 22 + strong candle confirmation).
     * 0.70 - 0.79: Solid setup meeting all mandatory rules.
     * Below 0.70: Any minor doubt, weak volume/momentum, or extended move -> output "skip" or confidence < 0.70.

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
| Max Trades per Day | 5 (`MAX_TRADES_PER_DAY`) |
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

---

## 7. Link to trade log

Every record in `logs/trade_log.jsonl` and every `backtest_result.json` has a `strategy_version` field that matches the version at the time of the run, to know which parameter set was used for that trade/result (see `DATA-SCHEMA.md`).
