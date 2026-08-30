# API-CONTRACTS.md — TradeBot_XAU_Gemini

**Version**: v1.0
**Date**: 2026-08-29

---

## 1. Broker REST API (external)

**Base URL**: `BROKER_BASE_URL` from `.env`
  - Demo example: `https://api-fxpractice.youbroker.com` — set to the actual demo URL of your chosen broker.
  - Live example: `https://api-fxtrade.yourbroker.com`

**Auth**: Header `Authorization: Bearer {BROKER_API_KEY}`

### 1.1 Fetch historical candles

```
GET /v3/accounts/{BROKER_ACCOUNT_ID}/instruments/{SYMBOL}/candles
```

Query params:
| Param | Value | Notes |
|---|---|---|
| `granularity` | `M5` | From `TIMEFRAME` in `.env` |
| `count` | `100` | Number of candles to fetch |
| `price` | `M` | Mid price |

Response (simplified) → map to Candle schema in `DATA-SCHEMA.md`.

### 1.2 Place order

```
POST /v3/accounts/{BROKER_ACCOUNT_ID}/orders
```

Body (Market Order with SL/TP):
```json
{
  "order": {
    "type": "MARKET",
    "instrument": "XAU_USD",
    "units": "12",
    "stopLossOnFill": { "price": "2347.68" },
    "takeProfitOnFill": { "price": "2355.99" }
  }
}
```
- `units`: positive = buy, negative = sell.
- `price` in SL/TP rounded to the precision required by your broker for XAU_USD (check `instrument` metadata when implementing).

### 1.3 Check open positions

```
GET /v3/accounts/{BROKER_ACCOUNT_ID}/openPositions
```
→ map to Position schema in `DATA-SCHEMA.md`.

### 1.4 Close position

```
PUT /v3/accounts/{BROKER_ACCOUNT_ID}/positions/{SYMBOL}/close
```

### 1.5 Get account balance

```
GET /v3/accounts/{BROKER_ACCOUNT_ID}/summary
```
→ get `account.balance` field.

### 1.6 Error handling contract

| Situation | Mandatory Action |
|---|---|
| HTTP 4xx (request error) | Log error with response body, `skip` current cycle |
| HTTP 5xx / timeout | Retry max N times (configurable), then `skip` |
| Rate limit (429) | Backoff, do not spam requests |

## 2. Gemini API Contract (external)

**Endpoint**: per official Gemini SDK/REST, model from `GEMINI_MODEL` in `.env`.

### 2.1 Request

- Input: context object per schema in section 4, `DATA-SCHEMA.md`.
- Prompt: per template defined in `STRATEGY.md` (section 4) — **do not** hardcode prompt in `GeminiAgent.js`, read from a centralized place for easy optimization.
- Require Gemini to return **pure JSON**, without explanatory text outside JSON (specify clearly in prompt).

### 2.2 Response contract

Must strictly follow schema (section 5, `DATA-SCHEMA.md`):
```json
{
  "action": "buy" | "sell" | "skip",
  "confidence": 0.0-1.0,
  "sl_atr_multiplier": number,
  "tp_atr_multiplier": number,
  "reason": string
}
```

### 2.3 Error handling (mandatory, per `PROJECT-RULES.md`)

| Situation | Action |
|---|---|
| Response is not valid JSON | `JSON.parse` fails → log warning + raw response, action = `skip` |
| Missing mandatory field | Treat as invalid → `skip` |
| `confidence` outside [0,1] | Treat as invalid → `skip` |
| `confidence < MIN_CONFIDENCE` | Format is valid but automatically `skip` |
| API timeout (exceeds X seconds) | `skip`, log reason `timeout` |

Do not retry calling Gemini in the same candle cycle — if missed, wait for the next cycle (avoid entering late trades based on old data).

## 3. Internal Module Interfaces

### `src/data/BrokerClient.js`
```js
getCandles(count: number, granularity: string): Promise<Candle[]>
getAccountBalance(): Promise<number>
createOrder(side: 'buy'|'sell', units: number, sl: number, tp: number): Promise<OrderResult>
getOpenPositions(): Promise<Position[]>
closePosition(symbol: string): Promise<void>
```

### `src/indicators/MA.js`
```js
calculateSMA(closePrices: number[], period: number): number[]
calculateEMA(closePrices: number[], period: number): number[]
getCrossSignal(maFast: number[], maSlow: number[]): 'bullish_cross'|'bearish_cross'|'neutral'
```

### `src/indicators/RSI.js`
```js
calculate(closePrices: number[], period?: number): number[]
getZone(rsiValue: number): 'oversold'|'overbought'|'neutral'
```

### `src/indicators/ATR.js`
```js
calculate(candles: Candle[], period?: number): number[]
```

### `src/ai/GeminiAgent.js`
```js
getDecision(context: GeminiContext): Promise<GeminiResponse>
// Internally validates + applies fallback skip per section 2.3
```

### `src/bot/SignalBuilder.js`
```js
buildContext(candles: Candle[], indicators: IndicatorOutput, currentPrice: number): GeminiContext
```

### `src/bot/RiskManager.js`
```js
calculateUnits(balance: number, riskPercent: number, slDistance: number, price: number): number
```

### `src/bot/TradingBot.js`
```js
runCycle(): Promise<void>  // 1 run of the main loop, called from scheduler every 5 mins
```

### `src/backtest/BacktestEngine.js`
```js
run(candles: Candle[], mode: 'rule-based'|'ai-simulated'): TradeLogEntry[]
```

### `src/backtest/ReportGenerator.js`
```js
generate(tradeLogs: TradeLogEntry[]): BacktestResult
```
