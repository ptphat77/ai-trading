# CHANGELOG

All notable changes to the project's **code/architecture** will be documented here.

> Note: Changes to **strategy parameters** (MA/RSI/ATR/prompt/threshold) are not recorded here — they are recorded in a separate changelog table in `STRATEGY.md`, along with the corresponding backtest results.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

---

## [Refactor] — 2026-09-06

### Architecture Changes
- Added `src/strategy/` layer: `RuleEngine.js`, `SlTpCalculator.js`, `NoiseFilter.js`
- Both `TradingBot` and `BacktestEngine` now use shared `RuleEngine.evaluateRule()`
- Chart server modularized: `serve.js` → `routes/` + `helpers/` structure
- `logger.js` now writes JSONL to `logs/trade_log.jsonl`

### Bug Fixes
- Fixed: `BrokerClient.js` importing `axios` inside method
- Fixed: `SignalBuilder.js` duplicate `ma9`/`ma21` keys
- Fixed: `config.js` `STRATEGY_VERSION` default out of sync with `STRATEGY.md`

### Technical Debt
- Removed: dead import `GeminiAgent` in `BacktestEngine`
- Removed: `geminiAgent` backward compat alias in `BacktestEngine`
- Removed: positional arg fallback in `notifier.sendSignalAlert()`
- Added: full unit tests for `TradingBot`, `RuleEngine`, `SlTpCalculator`

## [0.1.0] — 2026-08-29

### Added
- Initialized project documentation: `PRD.md`, `PROJECT-RULES.md`, `ARCHITECTURE.md`, `STRATEGY.md`, `DATA-SCHEMA.md`, `API-CONTRACTS.md`, `CHANGELOG.md`.
- Finalized initial implementation plan: Node.js, MT5 (Demo), Gemini AI, indicators MA9/MA21/RSI14/ATR14.
