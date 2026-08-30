---
name: write-test
description: >
  Write Jest unit tests for modules: indicators (pure functions), GeminiAgent (mock API),
  and TradingBot (mock dependencies). Read the source file and generate comprehensive test cases
  covering success paths, edge cases, and safety fallback behavior.
  Use when user says "write test", "test for [module]", or "add unit test".
---

# 🧪 Write Test
> **Purpose:** Create high-quality unit tests tailored to each module type, ensuring correct behavior and enforcement of safety rules.
> **Version:** 1.0
> **Tags:** testing, jest, unit-test, indicator, agent

## Trigger
When the user asks to write a test, add a test, or verify the behavior of a module.

## Framework
**Jest** — see `docs/PROJECT-RULES.md §5` for the testing process.

---

## Workflow Steps

### Step 1: 🔍 Identify Module & Type
1. Read the source file to be tested.
2. Determine the **test type** based on its layer (`ARCHITECTURE.md`):

   | Module | Test type | Approach |
   |--------|-----------|----------|
   | `src/indicators/*.js` | Pure function test | Real input → assert output |
   | `src/ai/GeminiAgent.js` | Mock API test | Mock Gemini response → assert decision + fallback |
   | `src/bot/RiskManager.js` | Pure calculation test | Known inputs → assert units |
   | `src/bot/SignalBuilder.js` | Integration-lite | Mock candles + indicators → assert context |
   | `src/bot/TradingBot.js` | Integration test | Mock BrokerClient + GeminiAgent → assert flow |
   | `src/data/BrokerClient.js` | Mock HTTP test | Mock axios → assert request format + error handling |
   | `src/data/CsvDataClient.js` | File read test | Mock fs/CSV parsing → assert Candle[] output |
   | `src/backtest/BacktestEngine.js` | Simulation test | Feed candle fixture → assert trade log |
   | `src/backtest/ReportGenerator.js` | Calculation test | Mock trade log → assert metrics |

3. Read `@docs/data/DATA-SCHEMA.md` to get schemas for test fixtures.

---

### Step 2: 🏗️ Design Test Cases
Design test cases for each type:

#### Indicator Tests (Layer 2)
- **Happy path**: Feed 20–50 real candles (hardcoded fixture), assert MA/RSI/ATR output matches the expected value (calculated manually or referenced against TradingView).
- **Edge cases**: Input array too short (< period), empty array.
- **Cross signal**: Test `getCrossSignal` with bullish/bearish/neutral combinations.

#### GeminiAgent Tests (Layer 3) — **MOST IMPORTANT**
Tests must cover all safety paths from `API-CONTRACTS.md §2.3`:
- ✅ Valid response `buy/sell` with confidence ≥ threshold → returns decision
- ✅ Valid response `skip` → returns skip
- ❌ `confidence < MIN_CONFIDENCE` → action = `skip` (even if response is valid)
- ❌ JSON parse fail → action = `skip`, logs warning
- ❌ Missing field in response → action = `skip`
- ❌ `confidence` out of bounds [0,1] → action = `skip`
- ❌ API timeout / throw error → action = `skip`, do not throw outside
- ❌ Invalid `action` (e.g., `"hold"`) → action = `skip`

#### RiskManager Tests (Layer 4)
- Assert unit calculation formula against known values.
- Edge case: SL distance = 0 (avoid division by zero).

#### TradingBot Tests (Layer 4)
- Mock `BrokerClient` to return candles + positions.
- Mock `GeminiAgent` to return various decisions.
- Assert: when there's an open position → skip, do not call `createOrder`.
- Assert: when GeminiAgent returns `buy` with sufficient confidence → call `createOrder` with correct params.
- Assert: logger writes log for every decision.

---

### Step 3: 📝 Generate Test File
1. Create file at: `tests/[ModuleName].test.js`
2. Standard structure:
   ```js
   const { functionName } = require('../src/layer/ModuleName');

   describe('ModuleName', () => {
     describe('functionName', () => {
       it('should [expected behavior] when [condition]', () => {
         // arrange
         // act
         // assert
       });
     });
   });
   ```
3. Use `jest.mock()` to mock external dependencies (axios, Gemini SDK).
4. Fixtures: keep them small and hardcoded, just enough to test — refer to schema from `DATA-SCHEMA.md`.

---

### Step 4: ▶️ Run & Report
1. Run test:
   ```bash
   npx jest tests/[ModuleName].test.js --verbose
   ```
2. If fails → analyze error, fix test or fix code.
3. Report results: total tests, pass/fail, coverage if requested.

---

## Constraints
- **Tests must cover all safety fallback paths** of GeminiAgent — this is a non-negotiable requirement.
- **Do not call the real API** in unit tests (mock all external calls).
- **Test fixtures must follow schemas** in `DATA-SCHEMA.md`.
- Test files are placed in `tests/` at the root (or `src/__tests__/` if the project has a different convention).

---

## Example
**User:** "Write a test for RSI.js"
**Action:**
1. Read `src/indicators/RSI.js` — observe `calculate()` and `getZone()`.
2. Determine: Layer 2, pure function test.
3. Design cases: 15 close values → RSI expected ≈ 65.3 (manual calc), `getZone(32)` → `"oversold"`, `getZone(75)` → `"overbought"`, `getZone(50)` → `"neutral"`.
4. Generate `tests/RSI.test.js` with 6 test cases.
5. Run `npx jest tests/RSI.test.js --verbose` → all pass.
**Result:** RSI module has enough test coverage to catch regressions during refactoring.
