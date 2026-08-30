# TradeBot_XAU_Gemini

AI-powered trading bot for XAU/USD using a configurable Broker REST API and Google Gemini.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in your API keys.

## Running

- Backtest (Phase 2): `npm run backtest` — reads from `data/candles.csv` via `CsvDataClient`, no broker API needed.
- Live / Paper Trading (Phase 3 & 4): `npm start` — connects to Broker REST API via `BrokerClient` (configure `BROKER_*` in `.env`).
- Run Tests: `npm test`

## Project Phases

| Phase | Mode | Data Source |
|---|---|---|
| 1 | Unit Test | `CsvDataClient` (local CSV) |
| 2 | Backtest | `CsvDataClient` (local CSV) |
| 3 | Paper Trading | `BrokerClient` (Broker Demo API) |
| 4 | Live Trading | `BrokerClient` (Broker Live API) |

See `docs/ARCHITECTURE.md` for full project structure.
