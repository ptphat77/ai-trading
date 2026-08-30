# STRATEGY.md — XAU/USD Trading Strategy (EMA + RSI + ATR + AI)

> ⚠️ This document changes frequently during strategy optimization.
> Do not modify `ARCHITECTURE.md` when only changing parameters here — the code should only read parameters from here via config, without hardcoding.

**Current version**: v1.2
**Last updated**: 2026-08-30

---

## 1. Indicator Parameters (current)

| Parameter | Value | Notes |
|---|---|---|
| MA fast | 9 | EMA (Exponential Moving Average) |
| MA slow | 21 | EMA (Exponential Moving Average) |
| RSI period | 14 | |
| RSI Oversold | 30 | Below this threshold is considered oversold |
| RSI Overbought | 70 | Above this threshold is considered overbought |
| RSI Lookback | 20 | Number of candles to remember RSI extreme touch setup |
| EMA Confirmation Window | 5 | Number of candles to wait for candle close across EMA21 |
| ATR period | 14 | Used to calculate dynamic SL/TP |

## 2. Entry Logic — Rule-based (used for fast Backtest, without calling AI)

Used when running `BacktestEngine` in Rule-based mode for fast testing without consuming Gemini quota:

- **Bullish signal (consider buying)**:
  1. RSI touched oversold (`RSI <= 30`) within the last 20 candles AND EMA9 crosses above EMA21 (`bullish_cross`) — in any order.
  2. Candle close confirms above EMA21 (`Close > EMA21`) within 5 candles.
- **Bearish signal (consider selling)**:
  1. RSI touched overbought (`RSI >= 70`) within the last 20 candles AND EMA9 crosses below EMA21 (`bearish_cross`) — in any order.
  2. Candle close confirms below EMA21 (`Close < EMA21`) within 5 candles.
- Outside these conditions: `skip`

## 3. AI Decision Layer — Configuration

| Parameter | Value | Notes |
|---|---|---|
| Confidence threshold (`MIN_CONFIDENCE`) | 0.70 | Below this threshold → automatically `skip` even if AI proposes buy/sell |
| Default SL ATR multiplier | 1.5 | Gemini can propose a different value in the response |
| Default TP ATR multiplier | 2.5 | Gemini can propose a different value in the response |
| Gemini model | Configured via `.env` (`GEMINI_MODEL`) | Do not hardcode the model name in prompt/code |

## 4. Prompt Template for Gemini

```
You are an expert Forex technical analyst.
Analyze the following signal and make a trading decision for XAU/USD:
[context: symbol, timeframe, currentPrice, indicators{ma9, ma21, rsi, atr, ma_cross, rsi_zone, rsi_touched_oversold, rsi_touched_overbought, candle_close_vs_ma21}, recentCandles]

Requirement: Return JSON with the format:
{
  "action": "buy" | "sell" | "skip",
  "confidence": 0.0-1.0,
  "sl_atr_multiplier": number,
  "tp_atr_multiplier": number,
  "reason": "Brief explanation"
}
```

Full schema for input/output: see `DATA-SCHEMA.md`. Technical contracts (validation, retry, format errors): see `API-CONTRACTS.md`.

## 5. Risk Rules applied to this strategy

| Parameter | Value |
|---|---|
| Risk per trade | 1% account (`RISK_PER_TRADE`) |
| Leverage | 1:50 |

(Strict safety rules — never enter a trade blindly — are in `PROJECT-RULES.md`, and are not repeated here.)

## 6. Strategy Changelog (parameters + backtest results)

> This table is different from the `CHANGELOG.md` in the project root: `CHANGELOG.md` logs **code** changes, this table logs **strategy parameter** changes along with corresponding backtest results — for reference during optimization.

| Version | Date | Changes | Reason | Backtest Results |
|---|---|---|---|---|
| v1.0 | 2026-08-29 | Baseline: MA9/21, RSI 30/70, confidence ≥ 0.70, Default SL/TP ATR 1.5/2.5 | Initialized based on the initial implementation plan | Not run yet |
| v1.1 | 2026-08-29 | Rule-based entry logic: RSI threshold 40/60 → 30/70 (matches Indicator Parameters) | Synchronized consistent oversold/overbought thresholds across all documents | Total Trades: 0 (Condition conflict: MA cross occurs at avg RSI 55.2/45.2, never <30 or >70) |
| v1.2 | 2026-08-30 | Switched MA to EMA9/21, added RSI extreme touch lookback (20 candles), and candle close confirmation across EMA21 (5 candles window) | Fixed logic contradiction in v1.1 where RSI 30/70 and MA cross were mutually exclusive | Total Trades: 550, Win Rate: 38.7%, Profit Factor: 1.04, Net Profit: +$14,246.69 (+14.25%), Max Drawdown: -23.33%, Sharpe: 0.02 |

> When adding a new row: increment the version, clearly state the changed parameters, the reason for the change, and the backtest results (Win rate, Profit Factor, Max Drawdown, Sharpe) to compare with the baseline.

## 7. Link to trade log

Every record in `logs/trade_log.jsonl` and every `backtest_result.json` should have a `strategy_version` field that matches the version at the time of the run, to know which parameter set was used for that trade/result (see `DATA-SCHEMA.md`).
