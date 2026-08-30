# PRD — XAU/USD AI Trading Bot

**Project**: TradeBot_XAU_Gemini
**Document Version**: v1.0
**Date**: 2026-08-29

---

## 1. Overview

Automated Gold (XAU/USD) trading bot: uses technical indicators (MA, RSI, ATR) to collect market signals, then relies on **Gemini AI** to make the final decision on whether to enter a trade and where to set SL/TP. Trades via a **configurable broker REST API**, starting with a Demo account.

## 2. Goals

- Build a complete automated trading pipeline: fetch data → calculate indicators → AI decision making → place orders → log.
- Prioritize **capital safety** over implementation speed: never enter a trade when clear signals are missing or when AI encounters an error.
- Be capable of backtesting on historical data before trading live, to quantitatively evaluate the strategy.
- Only switch to live trading after verification through backtesting and demo.

## 3. Success Metrics

**From Backtest** (minimum conditions to consider switching to Demo/Live — can be adjusted based on actual data):
- Win rate: monitor and optimize across strategy versions (see `STRATEGY.md`)
- Profit Factor ≥ 1.5
- Max Drawdown ≤ 15%
- Sharpe Ratio ≥ 1.0

**From operations**:
- 0% "blind trade" — no orders placed when Gemini times out or response parsing fails
- 100% of decisions (including `skip`) are fully logged to `trade_log.jsonl`
- Risk per trade never exceeds configured `RISK_PER_TRADE`

## 4. Scope

### In scope — Phase 1
- Backtest engine (Rule-based and AI-simulated modes)
- Paper trading on a Broker Demo account (configured via `BROKER_BASE_URL` in `.env`)
- 1 symbol: XAU_USD, 1 timeframe: M5
- Risk management by fixed account %

### Out of scope — Phase 1
- Live trading with real money (only deploy after Demo runs stably for ≥ 1 continuous week — see Phase 4 in Verification Plan, `ARCHITECTURE.md`)
- Multi-symbol / multi-timeframe
- User Interface (monitoring dashboard) — can be added in a later phase, which will require `UI-DESIGN.md`

## 5. Target Audience

Individual running the bot (dev and trader). No requirement for multi-user or permissions.

## 6. Functional Requirements

| # | Requirement |
|---|---|
| F1 | Fetch the last 100 M5 candles of XAU_USD via Broker REST API |
| F2 | Calculate MA9, MA21, RSI(14), ATR(14) correctly matching reference (TradingView) |
| F3 | Aggregate indicators into context and send to Gemini for a decision |
| F4 | Receive and validate JSON response from Gemini (action/confidence/sl/tp/reason) |
| F5 | Automatically `skip` if confidence is below threshold, JSON error, or API timeout |
| F6 | Calculate SL/TP based on ATR × multiplier proposed by Gemini |
| F7 | Calculate trade volume (units) based on account risk % |
| F8 | Place Market Order with SL/TP via Broker REST API |
| F9 | Fully log every decision (buy/sell/skip) with reasoning |
| F10 | Run backtest on historical data and export metrics report |

## 7. Non-functional Requirements

- **Security**: API keys (Broker, Gemini) are never committed to git.
- **Configurability**: All operational parameters (risk %, threshold, Gemini model...) are read from `.env`, not hardcoded.
- **Audibility**: Can trace back why the bot made a decision at any given time, based on logs.
- **Reliability**: The bot must not crash the entire loop when a single API call fails.

## 8. Decisions & Open Questions Resolved

| Item | Default Value | Notes |
|---|---|---|
| Leverage | Depends on broker (e.g. 1:50) | Can be changed via broker account settings |
| Risk per trade | 1% of account | Via `RISK_PER_TRADE` in `.env` |
| Gemini model | Configured via `.env` | Do not hardcode model name |
| Confidence threshold | ≥ 0.70 to enter trade | Via `MIN_CONFIDENCE` in `.env` |

## 9. Milestones (Estimated Timeline)

| Step | Content | Time |
|---|---|---|
| 1 | Setup project, BrokerClient, test fetching candles | ~1h |
| 2 | Indicators (MA, RSI, ATR) | ~30m |
| 3 | Gemini Agent + prompt engineering | ~1h |
| 4 | Main TradingBot logic | ~1h |
| 5 | Backtest Engine + Report | ~1.5h |
| 6 | Overall testing + debug | ~1h |
| **Total** | | **~6h** |

## 10. Project Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Gemini returns malformed JSON | Bot might place wrong trade/crash | Strict validation + fallback `skip` (see `PROJECT-RULES.md`) |
| Broker API rate limit / downtime | Missed candles, failed order placement | Limited retries, log errors, don't hang state |
| Overfitting in backtest | Good past strategy but bad live | Monitor across multiple versions in `STRATEGY.md`, run demo long enough before live |
| Actual slippage / spread differs from backtest | Live results lower than expected | Paper Trading (Demo) phase for minimum 24-48h before evaluation |

## 11. Related Documents

- `PROJECT-RULES.md` — safety rules & coding convention
- `ARCHITECTURE.md` — system architecture
- `STRATEGY.md` — strategy parameters (MA/RSI/ATR/AI), continuously updated
- `DATA-SCHEMA.md` — data structures
- `API-CONTRACTS.md` — API contracts (Broker REST API, Gemini, internal)
- `CHANGELOG.md` — code change history
