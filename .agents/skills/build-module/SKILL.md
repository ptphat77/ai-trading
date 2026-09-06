---
name: build-module
description: >
  Guides the AI in building a new module (indicator, AI agent, bot logic, backtest)
  in strict adherence to the layer architecture, coding conventions, and safety rules of the project.
  Use when user says "build module", "add indicator", "create module", "implement [module name]", or "add feature".
---

# 🏗️ Build Module
> **Purpose:** Orchestrates the implementation of a new module from design to verification, strictly following all project rules.
> **Version:** 1.0
> **Tags:** workflow, module, coding, architecture

## Trigger
When the user requests to build, implement, create anew, or add a module/feature to the project.

## Prerequisites
- The user must describe the module to build.
- The module must fall within the In Scope section of `@docs/PRD.md`.

---

## Workflow Steps

### Step 1: 📚 Context Gathering & Validation
**Action:**
1. Read `@docs/PRD.md` §3-4 — confirm the feature is in-scope.
2. Read `@docs/ARCHITECTURE.md` — identify which **layer** this module belongs to and in which **file** it should reside:
   - Layer 1 → `src/data/CsvDataClient.js` (Phase 1 & 2: Backtest/Test) or `src/data/BrokerClient.js` (Phase 3 & 4: Paper/Live)
   - Layer 2 → `src/indicators/*.js`
   - Layer 3 → `src/ai/` (AIAgentFactory, BaseAIAgent, *Agent.js)
   - Layer 3.5 → `src/strategy/` (RuleEngine.js, SlTpCalculator.js, NoiseFilter.js)
   - Layer 4 → `src/bot/` (TradingBot.js, SignalBuilder.js, RiskManager.js)
   - Layer 5 → `src/backtest/` (BacktestEngine.js, ReportGenerator.js, TradeLogExporter.js)
   - Layer 6 → `src/utils/` (logger.js, notifier.js, resample.js)
   - Chart → `scripts/chart_viewer/routes/` (live.routes.js, backtest.routes.js, shared.routes.js)
   - Chart helpers → `scripts/chart_viewer/helpers/` (bridgeClient.js, csvParser.js, sanitize.js)
3. Read `@docs/PROJECT-RULES.md` — grasp coding constraints, naming, error handling.
4. If the module involves indicator params or AI prompts → read `@docs/STRATEGY.md` as well.
5. If the module involves API or schemas → read `@docs/data/API-CONTRACTS.md` + `@docs/data/DATA-SCHEMA.md`.

**Output:** AI clearly confirms the feature is in-scope, its layer, and the file(s) to create/edit.

---

### Step 2: 📐 Design & Planning
**Action:**
1. Design the function interface (input/output types) according to the convention in `API-CONTRACTS.md §3`.
2. If a new schema is needed → propose adding it to `DATA-SCHEMA.md`.
3. Identify dependencies: what this module needs to import, and who will import it.
4. Create an `implementation_plan.md` artifact with:
   - Files to create/edit
   - Function signatures
   - Any necessary documentation updates
5. **STOP** — wait for user approval of the plan.

**Success criteria:** User agrees to the implementation plan before coding begins.

---

### Step 3: ⚙️ Implementation
**Action:**
1. Create/edit the file in the exact location specified by `ARCHITECTURE.md`.
2. Apply naming conventions:
   - File: `PascalCase.js` (e.g., `BollingerBands.js`)
   - Function/variable: `camelCase` (e.g., `calculateBands`, `getUpperBand`)
3. Read config via `src/config.js` — do not hardcode any parameters.
4. Error handling: every API call gets a `try/catch`; log errors with timestamp + module + context + fallback action.
5. Single Responsibility: the module must do exactly 1 thing according to its layer.

**Layer-specific constraints:**
- **Indicator (Layer 2):** Pure function, no side-effects, no I/O, do not import from `src/bot/` or `src/data/`.
- **Strategy (Layer 3.5):** Pure functions + config reads only. May import from `src/indicators/` and `src/config.js`. Must NOT import from `src/bot/`, `src/backtest/`, or `src/data/`. This ensures the strategy can be reused by both Live and Backtest without circular deps.
- **BrokerClient (Layer 1):** Only calls the Broker REST API + maps response — does not calculate SL/TP, does not calculate risk. No business logic.
- **CsvDataClient (Layer 1):** Reads local CSV file only — mocks order/balance methods. Used for Phase 1 & 2 (no network calls).
- **GeminiAgent (Layer 3):** Validate response per `API-CONTRACTS.md §2.3`; fallback `skip` on parse fail / timeout / low confidence.
- **Bot logic (Layer 4):** All orders must pass through `RiskManager.calculateUnits()` — no exceptions.
- **Backtest (Layer 5):** Use `CsvDataClient` (not `BrokerClient`) — do not make real broker API calls in `rule-based` mode.
- **Chart routes (live.routes.js):** Only handles Live-specific API endpoints. Must NOT import BacktestEngine or access CSV files.
- **Chart routes (backtest.routes.js):** Only handles Backtest-specific API endpoints. May use BacktestEngine and read local files. Must NOT call MT5 Bridge.
- **Chart helpers:** Pure utility functions with no side effects on application state.

---

### Step 4: ✅ Verification
**Action:**
1. Review the newly created code against the checklist:
   - [ ] No hardcoded API keys, URLs, model names, thresholds
   - [ ] Correct file location and naming convention
   - [ ] Module has Single Responsibility (SRP)
   - [ ] Every API call has `try/catch` + logging
   - [ ] No business logic inside `BrokerClient.js`
   - [ ] If new strategy parameters exist → `STRATEGY.md` is updated
2. Propose writing tests: suggest the user run the `write-test` skill for the newly created module.

---

## Hard Constraints
- **Never create files outside the structure in `ARCHITECTURE.md`.**
- **Never hardcode config values** — always use `src/config.js`.
- **Never put business logic in `BrokerClient.js`.**
- **Never bypass `RiskManager`** when placing orders.
- **Never implement out-of-scope features** — check `PRD.md §4` first.

---

## Example
**User:** "Add Bollinger Bands indicator."
**Action:**
1. Confirm: PRD does not exclude new indicators, layer → `src/indicators/BollingerBands.js`.
2. Design interface: `calculateBands(closePrices, period, stdDev)` → `{upper, middle, lower}[]`.
3. Create plan, await approval.
4. Implement `BollingerBands.js` as a pure function, no hardcoded period.
5. Suggestion: update `STRATEGY.md` with default parameters + run `write-test`.
**Result:** New module is in the right layer, follows conventions, and is easy to test independently.

---

**User:** "Add a volume filter to the BUY rule."
**Action:**
1. Confirm: In scope (filtering false signals). Layer → `src/strategy/RuleEngine.js`.
2. Design: Add `volume_filter` check in `evaluateRule()` — requires `indicators.volume_ratio` in context.
3. Check: `SignalBuilder.js` must also add `volume_ratio` to context output.
4. Plan, await approval → implement both files.
5. Note: Because `RuleEngine.js` is shared, this filter automatically applies to both Live (TradingBot) and Backtest (BacktestEngine).
