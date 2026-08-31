# STRATEGY.md — XAU/USD Trading Strategy (EMA + RSI + ATR + AI)

> ⚠️ This document changes frequently during strategy optimization.
> Do not modify `ARCHITECTURE.md` when only changing parameters here — the code should only read parameters from here via config, without hardcoding.

**Current version**: v1.3
**Last updated**: 2026-08-31

---

## 1. Indicator Parameters (current)

| Parameter | Value | Notes |
|---|---|---|
| MA fast | 9 | EMA (Exponential Moving Average) |
| MA slow | 100 | EMA (Exponential Moving Average) |
| RSI period | 14 | |
| RSI Oversold | 36 | Below this threshold is considered oversold setup |
| RSI Overbought | 64 | Above this threshold is considered overbought setup |
| RSI Lookback | 18 | Number of candles to remember RSI extreme touch setup |
| EMA Confirmation Window | 5 | Number of candles to wait for candle close across EMA100 |
| ATR period | 14 | Used to calculate dynamic SL/TP |

## 2. Entry Logic — Rule-based (used for fast Backtest, without calling AI)

Used when running `BacktestEngine` in Rule-based mode for fast testing without consuming Gemini quota:

- **Bullish signal (consider buying)**:
  1. RSI touched oversold (`RSI <= 36`) within the last 18 candles AND EMA9 crosses above EMA100 (`bullish_cross`) — in any order.
  2. Candle close confirms above EMA100 (`Close > EMA100`) within 5 candles.
- **Bearish signal (consider selling)**:
  1. RSI touched overbought (`RSI >= 64`) within the last 18 candles AND EMA9 crosses below EMA100 (`bearish_cross`) — in any order.
  2. Candle close confirms below EMA100 (`Close < EMA100`) within 5 candles.
- Outside these conditions: `skip`

## 3. AI Decision Layer — Configuration

| Parameter | Value | Notes |
|---|---|---|
| Confidence threshold (`MIN_CONFIDENCE`) | 0.70 | Below this threshold → automatically `skip` even if AI proposes buy/sell |
| Default SL ATR multiplier | 1.5 | Gemini can propose a different value in the response |
| Default TP ATR multiplier | 1.1 | Gemini can propose a different value in the response |
| Gemini model | Configured via `.env` (`GEMINI_MODEL`) | Do not hardcode the model name in prompt/code |

## 4. Prompt Template for Gemini

```
You are an expert Forex technical analyst.
Analyze the following signal and make a trading decision for XAU/USD:
[context: symbol, timeframe, currentPrice, indicators{ma_fast, ma_slow, rsi, atr, ma_cross, rsi_zone, rsi_touched_oversold, rsi_touched_overbought, candle_close_vs_ma_slow}, recentCandles]

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
| Risk per trade | 1.75% account (`RISK_PER_TRADE`) |
| Leverage | 1:50 |

(Strict safety rules — never enter a trade blindly — are in `PROJECT-RULES.md`, and are not repeated here.)

## 6. Strategy Changelog (parameters + backtest results)

> This table is different from the `CHANGELOG.md` in the project root: `CHANGELOG.md` logs **code** changes, this table logs **strategy parameter** changes along with corresponding backtest results — for reference during optimization.

| Version | Date | Changes | Reason | Backtest Results |
|---|---|---|---|---|
| v1.0 | 2026-08-29 | Baseline: MA9/21, RSI 30/70, confidence ≥ 0.70, Default SL/TP ATR 1.5/2.5 | Initialized based on the initial implementation plan | Not run yet |
| v1.1 | 2026-08-29 | Rule-based entry logic: RSI threshold 40/60 → 30/70 (matches Indicator Parameters) | Synchronized consistent oversold/overbought thresholds across all documents | Total Trades: 0 (Condition conflict: MA cross occurs at avg RSI 55.2/45.2, never <30 or >70) |
| v1.2 | 2026-08-30 | Switched MA to EMA9/21, added RSI extreme touch lookback (20 candles), and candle close confirmation across EMA21 (5 candles window) | Fixed logic contradiction in v1.1 where RSI 30/70 and MA cross were mutually exclusive | Total Trades: 550, Win Rate: 38.7%, Profit Factor: 1.04, Net Profit: +$14,246.69 (+14.25%), Max Drawdown: -23.33%, Sharpe: 0.02 |
| v1.3 | 2026-08-31 | EMA9/100, RSI 36/64 (lookback 18), SL 1.5 ATR / TP 1.1 ATR, Risk 1.75% per trade | Parameter optimization targeting ~66% Win Rate and 100% Net Profit with strictly controlled Drawdown | Total Trades: 352, Win Rate: 64.8%, Profit Factor: 1.34, Net Profit: +$104,732.62 (+104.73%), Max Drawdown: -12.71%, Sharpe: 0.15 |

> When adding a new row: increment the version, clearly state the changed parameters, the reason for the change, and the backtest results (Win rate, Profit Factor, Max Drawdown, Sharpe) to compare with the baseline.

## 7. Link to trade log

Every record in `logs/trade_log.jsonl` and every `backtest_result.json` should have a `strategy_version` field that matches the version at the time of the run, to know which parameter set was used for that trade/result (see `DATA-SCHEMA.md`).
