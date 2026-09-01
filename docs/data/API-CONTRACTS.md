# API-CONTRACTS.md — TradeBot_XAU

**Version**: v2.0
**Date**: 2026-09-01

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

## 2. AI Provider API Contract (external)

The system supports multiple AI providers via the `AI_PROVIDER` environment variable. All providers share the same **input/output contract** — only the underlying HTTP call differs (handled inside each `*Agent.js`).

> Current supported providers: `qwen` (default, Alibaba Cloud DashScope) | `gemini` (Google Gemini)

### 2.1 Request

- Input: context object per schema in section 4, `DATA-SCHEMA.md`.
- Prompt: per template defined in `STRATEGY.md` (section 4) and centralized in `src/ai/promptTemplate.js` — **do not** hardcode prompt in any `*Agent.js`, all agents read from the shared template.
- Require AI to return **pure JSON**, without explanatory text outside JSON (specify clearly in prompt).

### 2.2 Response contract

Must strictly follow schema (section 5, `DATA-SCHEMA.md`) — identical for all providers:
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

Do not retry calling the AI provider in the same candle cycle — if missed, wait for the next cycle (avoid entering late trades based on old data).

### 2.4 Provider-specific configuration

| Provider | Key env vars | Default model |
|---|---|---|
| `qwen` | `DASHSCOPE_API_KEY`, `DASHSCOPE_MODEL`, `DASHSCOPE_BASE_URL` | `qwen-plus` |
| `gemini` | `GEMINI_API_KEY`, `GEMINI_MODEL` | `gemini-2.5-flash` |

To add a new provider: (1) add env vars to `.env.example` + `DATA-SCHEMA.md §1`, (2) implement `src/ai/NewProviderAgent.js` extending `BaseAIAgent`, (3) register in `AIAgentFactory`.

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

### `src/ai/BaseAIAgent.js`
```js
// Abstract base class — do not instantiate directly
getDecision(context: AIContext): Promise<AIResponse>  // abstract, overridden by each provider
_validateAndFormatDecision(rawText: string): AIResponse  // shared JSON validation + skip fallback
_createSkipFallback(reason: string): AIResponse
```

### `src/ai/AIAgentFactory.js`
```js
static createAgent(options?: { provider?: string }): BaseAIAgent
// Reads AI_PROVIDER from config (default 'qwen'), returns QwenAgent or GeminiAgent
```

### `src/ai/QwenAgent.js` | `src/ai/GeminiAgent.js`
```js
getDecision(context: AIContext): Promise<AIResponse>
// Internally calls provider API, delegates validation to BaseAIAgent._validateAndFormatDecision()
```

### `src/bot/SignalBuilder.js`
```js
buildContext(candles: Candle[], indicators: IndicatorOutput, currentPrice: number): AIContext
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
