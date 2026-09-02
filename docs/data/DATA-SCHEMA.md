# DATA-SCHEMA.md — TradeBot_XAU

**Version**: v2.0
**Date**: 2026-09-01

This document defines the data structures (schema) exchanged between components in the system.

---

## 1. Environment Variables (`.env`)

| Variable | Type | Default | Description |
|---|---|---|---|
| `BROKER_API_KEY` | string | — | Broker API key (depends on broker) |
| `BROKER_ACCOUNT_ID` | string | — | Broker Account ID |
| `BROKER_BASE_URL` | string | — | Broker REST API base URL (Demo or Live, set per broker docs) |
| `CSV_DATA_PATH` | string | `./data/candles.csv` | Path to local source-agnostic CSV file, used by `CsvDataClient` for backtest |
| `AI_PROVIDER` | string | `qwen` | Active AI provider: `qwen` \| `gemini`. Determines which agent `AIAgentFactory` creates. |
| `AI_RATE_LIMIT_DELAY_MS` | number | `300` | Delay between AI API calls in backtest AI-simulated mode (ms) |
| `DASHSCOPE_API_KEY` | string | — | Alibaba Cloud DashScope API key (used when `AI_PROVIDER=qwen`) |
| `DASHSCOPE_MODEL` | string | `qwen-plus` | Qwen model name (used when `AI_PROVIDER=qwen`) |
| `DASHSCOPE_BASE_URL` | string | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | DashScope API base URL |
| `GEMINI_API_KEY` | string | — | Google Gemini API key (used when `AI_PROVIDER=gemini`) |
| `GEMINI_MODEL` | string | `gemini-2.5-flash` | Gemini model name (used when `AI_PROVIDER=gemini`) |
| `SYMBOL` | string | `XAU_USD` | Trading symbol |
| `TIMEFRAME` | string | `M5` | Candle timeframe |
| `RISK_PER_TRADE` | float | `0.015` | Risk % of account per trade |
| `MIN_CONFIDENCE` | float | `0.70` | Minimum confidence threshold to enter a trade |

## 2. Candle (OHLCV) — from Broker API

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

## 4. AI Context — Input sent to AI agent

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

## 5. AI Response — Output from AI agent

```json
{
  "action": "buy",
  "confidence": 0.85,
  "sl_atr_multiplier": 1.0,
  "tp_atr_multiplier": 1.5,
  "reason": "RSI oversold at 32.5, MA9 bullish cross MA21, momentum is increasing"
}
```

**Validation rules** (mandatory before use, see also `API-CONTRACTS.md`) — enforced in `BaseAIAgent._validateAndFormatDecision()`:
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
  "ai_provider": "qwen",
  "action": "buy",
  "reason": "RSI oversold at 32.5, MA9 bullish cross MA21",
  "confidence": 0.85,
  "strategy_version": "v2.0",
  "price": 2350.45,
  "sl": 2347.68,
  "tp": 2355.99,
  "units": 12,
  "ai_raw_response": {
    "action": "buy",
    "confidence": 0.85,
    "sl_atr_multiplier": 1.0,
    "tp_atr_multiplier": 1.5,
    "reason": "..."
  },
  "error": null
}
```

- `ai_provider`: which provider generated the decision (e.g. `"qwen"`, `"gemini"`). Allows cross-referencing provider performance from logs.
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

## 8. Broker Position (simplified, from `getOpenPositions()`)

```json
{
  "instrument": "XAU_USD",
  "long": { "units": "12", "averagePrice": "2350.45" },
  "short": { "units": "0", "averagePrice": "0" },
  "unrealizedPL": "15.20"
}
```
