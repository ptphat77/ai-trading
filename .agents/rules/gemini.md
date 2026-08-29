---
trigger: always_on
---

# AI Agent — Router
# TradeBot_XAU_Gemini

You are the coding assistant for this trading bot project. Before responding to any request, route yourself to the appropriate context below based on the task type.

---

## Routing Rules

### When writing or reviewing code
→ Read `@docs/PROJECT-RULES.md` first.
Apply all coding conventions, layer responsibilities, naming rules, and architectural constraints. Do not deviate.

### When making architectural decisions
→ Read `@docs/ARCHITECTURE.md` first.
Understand the layer-based folder structure, module boundaries (Data / Indicator / AI / Bot / Backtest / Utils), and design principles before proposing solutions.

### When working with indicators, bot logic, or backtests
→ Read `@docs/ARCHITECTURE.md` + `@docs/STRATEGY.md`.
All parameters (MA period, RSI threshold, ATR multiplier, prompt template) are defined in `STRATEGY.md`. Do not hardcode parameters in the code.

### When working with OANDA API or Gemini API
→ Read `@docs/data/API-CONTRACTS.md` first.
All endpoint paths, request/response shapes, error handling contracts, and internal module interfaces are defined there.

### When working with data schemas or logs
→ Read `@docs/data/DATA-SCHEMA.md` first.
All schemas (Candle, Indicator Output, GeminiContext, GeminiResponse, TradeLogEntry, BacktestResult, Position) are defined there.

### When making feature scope decisions
→ Read `@docs/PRD.md` first.
Check the In Scope / Out of Scope list before implementing anything. Do not build out-of-scope features.

### When changing strategy parameters
→ Read `@docs/STRATEGY.md` first.
Record the current version and baseline backtest. All parameter changes must update the changelog table in `STRATEGY.md` (new version + reason + backtest results) — do not just modify the code.

---

## How to Apply

1. Identify the task type — use the routing table above, not intuition.
2. Load all relevant docs (a task often spans multiple areas).
3. Respond or generate code exactly according to those docs.
4. If the docs do not cover the situation → **stop and ask** — do not invent a pattern.

---

## Document Authority (when docs conflict, this priority wins)

1. `PROJECT-RULES.md` — all behaviors, patterns, constraints
2. `ARCHITECTURE.md` — structure, file locations, system boundaries
3. `API-CONTRACTS.md` — all API request/response shapes and internal interfaces
4. `DATA-SCHEMA.md` — all data and log schemas
5. `STRATEGY.md` — strategy parameters, prompt templates, changelog
6. `PRD.md` — feature scope and product decisions

---

## Hard Constraints (never violate, regardless of the task)

- **Never trade blind.** Gemini timeout / parse fail / `confidence < MIN_CONFIDENCE` → always `skip`, never enter a trade.
- **Never bypass RiskManager.** No code path should place an order without going through `RiskManager.calculateUnits()`.
- **Never invent module structure.** Do not create files or folders outside the structure defined in `ARCHITECTURE.md`.
- **Never hardcode config.** API keys, model names, symbols, thresholds, risk %, URLs... must all be read from `.env` via `src/config.js`.
- **Never hardcode strategy params in code.** MA period, RSI threshold, ATR multiplier, prompts → read from config, reference `STRATEGY.md`.
- **Never commit `.env`.** The `.env` file must be in `.gitignore` from the first commit.
- **Never log API keys.** OANDA_API_KEY or GEMINI_API_KEY must not be logged to the console or log files.
- **Never let a single API error crash the bot loop.** All external API calls must have `try/catch`; errors should only `skip` that cycle, not crash the entire loop.
- **Never change strategy params without updating `STRATEGY.md`.** Bump the version, state the reason, and include the backtest result — this is a mandatory requirement before merging.
- **Never go Live without Demo ≥ 1 week.** Only switch to live trading after the Demo has run stably and continuously for ≥ 1 week (per `PROJECT-RULES.md §1.3`).
- **Never open a new position while one is already open** on the same symbol.
- **Never write business logic inside `OandaClient.js`.** This module only calls the API and returns raw data.
- **Never implement out-of-scope features.** Check `PRD.md §4` before building anything new.
