---
name: setup-codebase
description: >
  Scaffolds the full project codebase for TradeBot_XAU_Gemini according to ARCHITECTURE.md and PROJECT-RULES.md.
  Use when the user asks to "setup project", "scaffold codebase", "khởi tạo project", or "dựng codebase".
---

# 🔄 Setup Codebase
> **Purpose:** Scaffolds the Node.js project structure for TradeBot_XAU_Gemini — all `src/` layers, `scripts/`, `logs/`, `tests/`, and configuration files.
> **Version:** 1.0
> **Tags:** workflow, automation, scaffolding, architecture

## Trigger
When the user asks to scaffold the codebase, setup the project structure, or initialize the repository.

## Workflow Steps

### Step 1: Read Project Rules
- **Action:** Read `@docs/ARCHITECTURE.md` and `@docs/PROJECT-RULES.md` to internalize the layer-based structure and all hard constraints.
- **Success criteria:** You understand the 6 layers (Data / Indicator / AI / Bot / Backtest / Utils), naming conventions (PascalCase for modules, camelCase for functions), and which files belong to each layer.

---

### Step 2: Initialize `package.json` and root config files
- **Action:** Create the following root-level files if they don't exist:
  - `package.json` — with `name`, `version`, `main` pointing to `scripts/run_live.js`, scripts for `start`, `backtest`, and `test` (via `npx jest`), and dependencies: `axios`, `dotenv`, `technicalindicators`, `better-sqlite3`; devDependencies: `jest`.
  - `.gitignore` — must include `.env`, `node_modules/`, `logs/`, `backtest_result.json`.
  - `.env.example` — environment variable template (see Step 5).
  - `README.md` — brief project overview, how to run demo, how to run backtest.
- **Success criteria:** Root config files are present and correct. `.env` itself is **never** created — only `.env.example`.

---

### Step 3: Scaffold `src/` — All 6 Layers
Create each file below with the correct boilerplate stub (module export + JSDoc comment describing its responsibility). **Never implement actual business logic in this skill.**

#### Layer 1 — Data (`src/data/`)
- `src/data/OandaClient.js`
  - Exports class `OandaClient` with stub methods: `getCandles()`, `getAccountBalance()`, `createOrder()`, `getOpenPositions()`, `closePosition()`.
  - JSDoc: _"Only calls OANDA REST API and returns raw data. No business logic."_

#### Layer 2 — Indicators (`src/indicators/`)
- `src/indicators/MA.js` — exports `calculateSMA()`, `calculateEMA()`, `getCrossSignal()`.
- `src/indicators/RSI.js` — exports `calculate()`, `getZone()`.
- `src/indicators/ATR.js` — exports `calculate()`.
- All are **pure functions** with no side-effects. JSDoc: _"Parameters read from config — never hardcoded here."_

#### Layer 3 — AI (`src/ai/`)
- `src/ai/GeminiAgent.js`
  - Exports class `GeminiAgent` with stub method `decide(context)`.
  - JSDoc: _"Builds prompt, calls Gemini API, validates and parses JSON response. Returns skip on any failure."_

#### Layer 4 — Bot Logic (`src/bot/`)
- `src/bot/SignalBuilder.js` — exports `buildSignal(candles, indicators)`.
- `src/bot/RiskManager.js` — exports `calculateUnits(balance, riskPercent, slDistance, price)`.
- `src/bot/TradingBot.js` — exports class `TradingBot` with stub method `run()`.

#### Layer 5 — Backtest (`src/backtest/`)
- `src/backtest/BacktestEngine.js` — exports class `BacktestEngine` with stub `runRuleBased()` and `runAISimulated()`.
- `src/backtest/ReportGenerator.js` — exports `generateReport(results)`.

#### Layer 6 — Utils (`src/utils/`)
- `src/utils/logger.js` — exports `log(level, message, context)`. Logs to both console and `logs/trade_log.jsonl`.

#### Config
- `src/config.js` — reads all values from `process.env` via `dotenv`. Exports a single frozen config object. JSDoc: _"Single source of truth for all runtime configuration. Never import .env directly elsewhere."_

- **Success criteria:** All 12 source files exist with correct stubs. No business logic. No hardcoded values.

---

### Step 4: Scaffold `scripts/` — Entry Points
- `scripts/run_live.js` — imports `TradingBot`, instantiates it, and calls `.run()`. Includes top-level `try/catch`.
- `scripts/run_backtest.js` — imports `BacktestEngine` and `ReportGenerator`, runs backtest, then generates report.
- **Success criteria:** Entry points exist and delegate correctly to `src/` modules.

---

### Step 5: Create `.env.example` — Environment Variable Template
Create `.env.example` with all required variables and placeholder values:

```
# OANDA
OANDA_API_KEY=your_oanda_api_key_here
OANDA_ACCOUNT_ID=your_account_id_here
OANDA_BASE_URL=https://api-fxpractice.oanda.com   # Demo URL

# Gemini
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-1.5-pro

# Strategy
SYMBOL=XAU_USD
GRANULARITY=M5
CANDLE_COUNT=100
RISK_PER_TRADE=0.01         # 1%
MIN_CONFIDENCE=0.7

# Bot
LOOP_INTERVAL_MS=300000     # 5 minutes
```

- **Success criteria:** `.env.example` exists and is committed. Real `.env` must NOT be created.

---

### Step 6: Scaffold `tests/` — Test Placeholders
Create placeholder test files following the convention in `PROJECT-RULES.md §5a`:

- `tests/MA.test.js`
- `tests/RSI.test.js`
- `tests/ATR.test.js`
- `tests/GeminiAgent.test.js`
- `tests/TradingBot.test.js`

Each file contains a single placeholder `describe` block with a `todo` test so Jest can discover and run them without errors.

- **Success criteria:** `npx jest` runs without errors (all tests marked as todo/pending).

---

### Step 7: Create `logs/` Directory
- Create `logs/.gitkeep` so the directory is tracked by git but log files themselves are excluded via `.gitignore`.
- **Success criteria:** `logs/` directory exists and is tracked.

---

## Error Handling
- If any file already exists: **skip** creation and proceed to the next file — never overwrite unless explicitly instructed by the user.
- After each step, inform the user of what was created and what was skipped.

## Constraints & Guardrails
- **Never invent structure:** Do not create files or folders outside the structure defined in `ARCHITECTURE.md`.
- **Never hardcode values:** All API keys, thresholds, model names must be in `.env` / read via `src/config.js`.
- **Never implement business logic:** This skill only creates stubs and boilerplate.
- **Never create `.env`:** Only `.env.example` is created. The actual `.env` must be created manually by the user.
- **Never bypass RiskManager:** Even stub code in `TradingBot.js` must show the call to `RiskManager.calculateUnits()` in comments.
- **Module style:** Be consistent — use CommonJS (`require/module.exports`) unless the user explicitly requests ES Modules.

## Progress Reporting
Report after each step:
- ✅ Step completed / ⏭️ Skipped (already exists) / ❌ Failed
- Summary of files created
- What comes next
