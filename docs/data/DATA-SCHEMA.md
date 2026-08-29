# DATA-SCHEMA.md — TradeBot_XAU_Gemini

**Version**: v1.0
**Date**: 2026-08-29

This document defines the data structures (schema) exchanged between components in the system.

---

## 1. Environment Variables (`.env`)

| Variable | Type | Default | Description |
|---|---|---|---|
| `OANDA_API_KEY` | string | — | OANDA API key |
| `OANDA_ACCOUNT_ID` | string | — | OANDA Account ID |
| `OANDA_BASE_URL` | string | `https://api-fxpractice.oanda.com` | Demo URL; change to live URL when going live |
| `GEMINI_API_KEY` | string | — | Gemini API key |
| `GEMINI_MODEL` | string | — | Gemini model name, e.g. `gemini-2.5-flash` |
| `SYMBOL` | string | `XAU_USD` | Trading symbol |
| `TIMEFRAME` | string | `M5` | Candle timeframe |
| `RISK_PER_TRADE` | float | `0.01` | Risk % of account per trade |
| `MIN_CONFIDENCE` | float | `0.70` | Minimum confidence threshold to enter a trade |

## 2. Candle (OHLCV) — from OANDA

```json
{
  "time": "2026-08-29T10:00:00Z",
  "open": 2350.10,
  "high": 2351.20,
  "low": 2349.80,
  "close": 2350.45,
  "volume": 1523
}
```

## 3. Indicator Output (aggregated by `SignalBuilder` from indicators layer)

```json
{
  "ma9": 2348.20,
  "ma21": 2345.80,
  "rsi": 32.5,
  "atr": 1.85,
  "ma_cross": "bullish_cross"
}
```

- `ma_cross`: `"bullish_cross"` | `"bearish_cross"` | `"neutral"`
- corresponding `rsi` zone (via `RSI.getZone()`): `"oversold"` | `"overbought"` | `"neutral"`

## 4. Gemini Context — Input sent to AI

```json
{
  "symbol": "XAU/USD",
  "timeframe": "5m",
  "currentPrice": 2350.45,
  "indicators": {
    "ma9": 2348.20,
    "ma21": 2345.80,
    "rsi": 32.5,
    "atr": 1.85,
    "ma_cross": "bullish_cross"
  },
  "recentCandles": [
    { "time": "...", "open": 0, "high": 0, "low": 0, "close": 0, "volume": 0 }
  ]
}
```

`recentCandles`: array of 5 most recent candles (OHLCV).

## 5. Gemini Response — Output from AI

```json
{
  "action": "buy",
  "confidence": 0.82,
  "sl_atr_multiplier": 1.5,
  "tp_atr_multiplier": 3.0,
  "reason": "RSI oversold at 32.5, MA9 bullish cross MA21, momentum is increasing"
}
```

**Validation rules** (mandatory before use, see also `API-CONTRACTS.md`):
- `action` ∈ `{"buy", "sell", "skip"}`
- `confidence` ∈ `[0, 1]`
- `sl_atr_multiplier`, `tp_atr_multiplier` > 0
- If any field is missing/wrong type/parse error → consider response invalid, fallback `skip` (per `PROJECT-RULES.md`)

## 6. Trade Log Entry (`logs/trade_log.jsonl`)

Each line is 1 JSON object, logged for **every** decision including `skip`:

```json
{
  "timestamp": "2026-08-29T10:05:00Z",
  "symbol": "XAU_USD",
  "action": "buy",
  "reason": "RSI oversold at 32.5, MA9 bullish cross MA21",
  "confidence": 0.82,
  "strategy_version": "v1.0",
  "price": 2350.45,
  "sl": 2347.68,
  "tp": 2355.99,
  "units": 12,
  "gemini_raw_response": {
    "action": "buy",
    "confidence": 0.82,
    "sl_atr_multiplier": 1.5,
    "tp_atr_multiplier": 3.0,
    "reason": "..."
  },
  "error": null
}
```

- `strategy_version`: matches the version in `STRATEGY.md` at the time of execution — for later cross-reference.
- `error`: `null` if normal; if there's an error (timeout, parse fail...) log a brief description, `action` will always be `"skip"`.

## 7. Backtest Result (`backtest_result.json`)

```json
{
  "period": { "from": "2024-01-01", "to": "2024-08-01" },
  "symbol": "XAU_USD",
  "timeframe": "M5",
  "strategy_version": "v1.0",
  "mode": "rule-based",
  "totalTrades": 142,
  "winRate": 0.585,
  "profitFactor": 1.72,
  "netProfit": 1840.50,
  "netProfitPercent": 0.184,
  "maxDrawdown": -0.082,
  "sharpeRatio": 1.34,
  "avgWin": 28.50,
  "avgLoss": -16.20
}
```

- `mode`: `"rule-based"` | `"ai-simulated"` — the backtest mode that was run (see `ARCHITECTURE.md` / `STRATEGY.md`).

## 8. OANDA Position (simplified, from `getOpenPositions()`)

```json
{
  "instrument": "XAU_USD",
  "long": { "units": "12", "averagePrice": "2350.45" },
  "short": { "units": "0", "averagePrice": "0" },
  "unrealizedPL": "15.20"
}
```
