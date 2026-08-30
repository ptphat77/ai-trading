# CHANGELOG

All notable changes to the project's **code/architecture** will be documented here.

> Note: Changes to **strategy parameters** (MA/RSI/ATR/prompt/threshold) are not recorded here — they are recorded in a separate changelog table in `STRATEGY.md`, along with the corresponding backtest results.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Planned
- Setup project structure, `MT5Client`, test fetching candles
- Indicators: MA, RSI, ATR
- `GeminiAgent` + prompt engineering
- Main `TradingBot` logic
- `BacktestEngine` + `ReportGenerator`
- Overall testing + debugging

---

## [0.1.0] — 2026-08-29

### Added
- Initialized project documentation: `PRD.md`, `PROJECT-RULES.md`, `ARCHITECTURE.md`, `STRATEGY.md`, `DATA-SCHEMA.md`, `API-CONTRACTS.md`, `CHANGELOG.md`.
- Finalized initial implementation plan: Node.js, MT5 (Demo), Gemini AI, indicators MA9/MA21/RSI14/ATR14.
