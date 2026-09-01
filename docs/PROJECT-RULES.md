# PROJECT-RULES.md — TradeBot_XAU

**Version**: v2.0
**Date**: 2026-09-01

This document finalizes the mandatory rules that must be followed throughout the bot's development and operation. Highest priority: **capital safety > speed > convenience**.

---

## 1. Safety Rules — HIGHEST PRIORITY

1. **Never trade blind**:
   - AI provider API timeout → `skip`
   - JSON response from AI agent fails to parse → log warning, `skip`
   - `confidence < MIN_CONFIDENCE` → `skip`
   - Incomplete candle data (missing candles, Broker API error) → `skip`, do not use old data to guess.

2. **Fully log all decisions**, including `skip`, to `logs/trade_log.jsonl`, including reasoning and context at the time of the decision (see `DATA-SCHEMA.md`).

3. **Do not switch to Live Trading** until Demo (Paper Trading) runs stably continuously for **≥ 1 week**, with no critical errors (crashes, wrong SL/TP placed, exceeding allowed risk).

4. **RiskManager must strictly enforce** risk limit per trade (`RISK_PER_TRADE`, default 1%). No code path is allowed to bypass this risk calculation step to place an order directly.

5. When a position is open, the bot **must not** open a new position on the same symbol until the old position is closed.

## 2. Security

- The `.env` file **must never** be committed to git — it must be in `.gitignore` from the very first commit of the repo.
- Do not log any API keys (Broker, AI provider) to the console or log files in any form.
- Do not hardcode API keys or secrets in source code.
- The `.env.example` file (containing no real values) can be committed for configuration guidance.

## 3. Coding Conventions

- **Language**: Node.js. Consistently choose CommonJS or ES Modules for the entire repo (do not mix).
- **Naming**:
  - Class/module file: PascalCase (`BrokerClient.js`, `RiskManager.js`)
  - Function/variable: camelCase (`calculateSMA`, `getCrossSignal`)
- **Single Responsibility**: each module in `src/` handles exactly 1 task, according to the directory structure defined in `ARCHITECTURE.md`.
- **Separate business logic from API calling layer**: `BrokerClient.js` only calls the API and returns raw data, no SL/TP or risk calculation inside it.
- Do not hardcode strategy logic (RSI thresholds, MA periods...) scattered throughout the code — must read via config, reference `STRATEGY.md`.

## 4. Configuration Management

- All **operational** parameters (risk %, confidence threshold, AI provider, AI model, symbol, timeframe, Broker base URL) are read from `.env` via `src/config.js` — not hardcoded in business logic.
- All **strategy** parameters (MA period, RSI oversold/overbought, default ATR multiplier, prompt template) are defined and versioned in `STRATEGY.md`, applied to code via config — when optimizing strategy, edit `STRATEGY.md` first, code only reads from it.

## 5. Testing / Verification

Must sequentially go through the 4 phases defined in `ARCHITECTURE.md` (Verification Plan), no phase can be skipped:

1. Manual unit test (indicator + AI agent with mock context)
2. Backtest on historical data
3. Paper Trading (Broker Demo account), monitor for at least 24-48h
4. Live Trading — only after Demo is stable for ≥ 1 week

## 5a. Testing Framework

**Framework**: [Jest](https://jestjs.io/) — chosen for good mock support (needed for `BrokerClient` and AI agents).

**Installation**:
```bash
npm install --save-dev jest
```

**Convention**:
- Test files located at: `tests/[ModuleName].test.js` (parallel to `src/`)
- Run all tests: `npx jest`
- Run one file: `npx jest tests/RSI.test.js --verbose`

**Mock strategy**:
- `BrokerClient` and AI agents (`QwenAgent`, `GeminiAgent`): use `jest.mock()` when testing `TradingBot` or any module depending on them.
- `AIAgentFactory`: test that correct agent type is returned for each `AI_PROVIDER` value.
- Indicators (`MA`, `RSI`, `ATR`): pure functions — test directly, no mock needed.
- HTTP (`axios`): mock using `jest.mock('axios')` when testing `BrokerClient` or agent HTTP calls.

**Minimum coverage required** (see `write-test` skill):
- All safety fallback paths of each AI agent (timeout, parse fail, low confidence) must have tests — these are in `BaseAIAgent` and verified at the concrete agent level.
- All new indicator modules must have tests before merging to `main`.
- Any new AI provider agent must include tests before merging to `main`.

## 6. Git Workflow (proposed)

- `main` branch: always in a runnable state with Demo, do not merge code without basic backtesting.
- `strategy/*` branches: used for experiments changing strategy parameters (e.g. `strategy/rsi-25-75`).
- Clearly separate 2 types of commits:
  - **Code/architecture** changes → log in `CHANGELOG.md`
  - **Strategy parameter** changes → log in the changelog table in `STRATEGY.md`, along with corresponding backtest results.

## 7. General Error Handling

- All external API calls (Broker, AI provider) must be wrapped in `try/catch`; errors must not crash the entire bot loop.
- Error logs must include: timestamp, module causing error, related context, and fallback action taken (usually `skip`).
- No infinite retries — set a reasonable retry limit for each API call, then `skip` the current cycle.

## 8. Review Principles before changing

Before modifying any strategy parameters for testing:
1. Record current strategy version and baseline backtest results.
2. Change parameters in `STRATEGY.md`, increment version.
3. Re-run backtest, compare with baseline.
4. Only apply to Demo if backtest results are better or equivalent, not significantly worse in Max Drawdown.
