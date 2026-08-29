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
   - Layer 1 → `src/data/OandaClient.js`
   - Layer 2 → `src/indicators/*.js`
   - Layer 3 → `src/ai/GeminiAgent.js`
   - Layer 4 → `src/bot/*.js`
   - Layer 5 → `src/backtest/*.js`
   - Layer 6 → `src/utils/logger.js`
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
- **OandaClient (Layer 1):** Only calls the API + maps response — does not calculate SL/TP, does not calculate risk.
- **GeminiAgent (Layer 3):** Validate response per `API-CONTRACTS.md §2.3`; fallback `skip` on parse fail / timeout / low confidence.
- **Bot logic (Layer 4):** All orders must pass through `RiskManager.calculateUnits()` — no exceptions.
- **Backtest (Layer 5):** Do not call the real OANDA API when in `rule-based` mode.

---

### Step 4: ✅ Verification
**Action:**
1. Review the newly created code against the checklist:
   - [ ] No hardcoded API keys, URLs, model names, thresholds
   - [ ] Correct file location and naming convention
   - [ ] Module has Single Responsibility (SRP)
   - [ ] Every API call has `try/catch` + logging
   - [ ] No business logic inside `OandaClient.js`
   - [ ] If new strategy parameters exist → `STRATEGY.md` is updated
2. Propose writing tests: suggest the user run the `write-test` skill for the newly created module.

---

## Hard Constraints
- **Never create files outside the structure in `ARCHITECTURE.md`.**
- **Never hardcode config values** — always use `src/config.js`.
- **Never put business logic in `OandaClient.js`.**
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
