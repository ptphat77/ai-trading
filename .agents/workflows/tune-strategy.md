---
name: tune-strategy
description: >
  Guides the AI to optimize strategy parameters (MA/RSI/ATR/confidence) following the correct process:
  record baseline → propose new parameters → iterate (tune → backtest → compare) until satisfied →
  then update STRATEGY.md and commit once with the approved version.
  Use when user says "tune strategy", "change parameters", "try new RSI", "change MA period".
---

# 🎛️ Tune Strategy Workflow
> **Purpose:** Ensure all strategy parameter changes are versioned, confirmed by backtests, and recorded in `STRATEGY.md` — never change blindly.
> **Philosophy:** A good strategy comes from data, not intuition. Every change is a hypothesis that needs to be tested. Commit only what is proven better.

## Trigger
When the user wants to change strategy parameters: MA period, RSI threshold, ATR multiplier, confidence threshold, prompt template.

---

## Workflow Steps

### Step 1: 📚 Record Current Baseline
1. Read `@docs/STRATEGY.md`:
   - Note the **current version** (e.g., `v1.1`)
   - Copy all current parameters to the artifact to serve as a baseline reference
   - Note the baseline backtest result (if available in the changelog)
2. If there are no backtest results for the current version → **suggest running the `run-backtest` workflow first** to establish a baseline.

### Step 2: 💡 Propose New Parameters & Present Plan
1. The user describes the parameter they want to change (or the AI proposes based on backtest results).
2. Create an `implementation_plan.md` with:
   - **Hypothesis:** Why might this change improve results?
   - **Parameter changes:** Comparison table of old vs new parameters
   - **Expected impact:** Expected effect on Win Rate / Drawdown
   - **Risk:** Potential weaknesses of the new parameters
3. **STOP** — wait for user approval before touching any code or docs.

### Step 3: 🔄 Experimentation Loop (Iterate Until Satisfied)

> ⚠️ **This is a loop. Repeat as many times as needed.**
> Do NOT update `STRATEGY.md` or commit anything during this loop.
> Only code changes in `src/` are allowed here to try out variations.

#### 3a. Apply parameter changes to code (NO commit, NO STRATEGY.md update yet)
- Update `src/config.js` and any affected modules (e.g., `BacktestEngine.js`, `SignalBuilder.js`).

#### 3b. Run Backtest
```bash
node scripts/run_backtest.js
```
Read `backtest_result.json` and present results in the standard format:

| Metric | This Attempt | Baseline | Δ | Target (PRD §3) |
|--------|-------------|----------|---|-----------------|
| Win Rate | X% | Y% | ±Z% | — |
| Profit Factor | X | Y | ±Z | ≥ 1.5 |
| Net Profit | $X | $Y | ±$Z | — |
| Max Drawdown | X% | Y% | ±Z% | ≤ 15% |
| Sharpe Ratio | X | Y | ±Z | ≥ 1.0 |

#### 3c. Evaluate & Decide
- **Results are worse than baseline OR user is not satisfied:**
  → Propose a new variation. Go back to **Step 3a** with adjusted parameters.
  → Track what was tried and why it failed in the `implementation_plan.md` artifact (not in git).
- **Results beat the baseline AND user is satisfied:**
  → Exit the loop. Proceed to **Step 4**.

### Step 4: ✏️ Update STRATEGY.md (Only after user confirms satisfied)
1. Update `@docs/STRATEGY.md`:
   - Modify the parameters in table §1 (Indicator Parameters) and/or §3 (AI Decision Layer)
   - **Increment version** (e.g., `v1.1` → `v1.2`)
   - Add a new row to the **Changelog §6** with the actual backtest results (no placeholder):
     ```
     | v1.2 | [today's date] | [What changed] | [Reason] | Win Rate X%, PF Y, DD Z%, Sharpe W |
     ```

### Step 5: 🧪 Run Tests & Final Verification
1. Run all unit tests to ensure no regressions:
   ```bash
   npm test
   ```
2. Run final backtest to ensure `backtest_result.json` is perfectly synced with the updated `STRATEGY.md`:
   ```bash
   node scripts/run_backtest.js
   ```

### Step 6: 📦 Execute Commit via `git-commit` Skill
Trigger the `git-commit` skill (`.agents/skills/git-commit/SKILL.md`):
1. Skill analyzes changes and performs safety checks (ensures `.env` is never staged).
2. Skill creates an `implementation_plan.md` proposing the commit message with type `strategy:` (e.g., `strategy: v1.2 — EMA9/21 cross + RSI zone + candle close confirmation`).
3. Wait for user approval on the commit plan artifact.
4. Execute `git commit` only after explicit user approval.

> ✅ This ensures: no intermediate failed-attempt commits, and all commits strictly follow the safety checklist and approval flow of the `git-commit` skill.

---

## 🚫 Constraints
- **Never commit during the experimentation loop** — commits only happen once after user satisfaction.
- **Never update `STRATEGY.md` during the loop** — update docs only after the final approved result.
- **Never commit without real backtest numbers** — the changelog row must have actual metrics, not "Not backtested yet".
- **Never recommend Live** even if backtest results are good — it must pass Demo for ≥ 1 week.

---

## Example
**User:** "Let's try EMA cross + RSI zone + candle close above EMA21."
**Action:**
1. Baseline: `v1.1`, 0 trades (condition conflict). Record it.
2. Plan presented → user approves.
3. **Loop iteration 1:** Apply EMA logic only → Backtest → PF 1.03, WR 38% → User: "not good enough" → adjust.
4. **Loop iteration 2:** Add RSI zone filter → Backtest → PF 1.06 → User: "still not satisfied" → adjust.
5. **Loop iteration 3:** Refine RSI lookback window → Backtest → PF 1.35, WR 42% → User: "OK, this is good."
6. → Exit loop. Update `STRATEGY.md` to `v1.2` with final parameters + real backtest numbers.
7. → Run `npm test` — all pass.
8. → Single commit: `strategy: v1.2 — EMA cross + RSI zone + candle close confirmation`
**Result:** Git history is clean — only the approved, proven-better version is recorded.

