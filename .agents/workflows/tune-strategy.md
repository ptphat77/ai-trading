---
name: tune-strategy
description: >
  Guides the AI to optimize strategy parameters (MA/RSI/ATR/confidence) following the correct process:
  record baseline → create branch → propose new parameters → await approval → update STRATEGY.md → backtest → compare.
  Use when user says "tune strategy", "change parameters", "try new RSI", "change MA period".
---

# 🎛️ Tune Strategy Workflow
> **Purpose:** Ensure all strategy parameter changes are versioned, confirmed by backtests, and recorded in `STRATEGY.md` — never change blindly.
> **Philosophy:** A good strategy comes from data, not intuition. Every change is a hypothesis that needs to be tested.

## Trigger
When the user wants to change strategy parameters: MA period, RSI threshold, ATR multiplier, confidence threshold, prompt template.

---

## Workflow Steps

### Step 1: 📚 Record Current Baseline
1. Read `@docs/STRATEGY.md`:
   - Note the **current version** (e.g., `v1.1`)
   - Copy all current parameters to an artifact to serve as a baseline reference
   - Note the baseline backtest result (if available in the changelog)
2. If there are no backtest results for the current version → **suggest running the `run-backtest` workflow first** to establish a baseline.

### Step 2: 🌿 Create Strategy Branch
```bash
git checkout -b strategy/[change-description]
```
Example: `strategy/rsi-threshold-25-75`, `strategy/higher-confidence-0.80`

**Branch naming convention:** `strategy/[param-name]-[new-value]`

### Step 3: 💡 Propose New Parameters
1. The user describes the parameter they want to change (or the AI proposes based on backtest results).
2. Create an `implementation_plan.md` with:
   - **Hypothesis:** Why might this change improve results?
   - **Parameter changes:** Comparison table of old vs new parameters
   - **Expected impact:** Expected effect on Win Rate / Drawdown
   - **Risk:** Potential weaknesses of the new parameters
3. **STOP** — wait for user approval.

### Step 4: ✏️ Update STRATEGY.md
After user approval:
1. Update `@docs/STRATEGY.md`:
   - Modify the parameters in table §1 (Indicator Parameters) and/or §3 (AI Decision Layer)
   - **Increment version** (e.g., `v1.1` → `v1.2`)
   - Add a new row to the **Changelog §6**:
     ```
     | v1.2 | [today's date] | [What changed] | [Reason] | Not backtested yet |
     ```
2. Commit `STRATEGY.md` separately with type `strategy:`:
   - Use the `git-commit` skill, commit type `strategy:`

### Step 5: 📊 Run Backtest & Compare
1. Run the `run-backtest` workflow.
2. Compare results with the baseline.
3. Update the changelog row in `STRATEGY.md` with the real results (replacing `Not backtested yet`).

### Step 6: ✅ Decision & Next Steps
- **Results are better or equal to the baseline** (Max Drawdown is not significantly worse):
  → Merge branch into `main`, suggest running Demo with new parameters.
  ```bash
  git checkout main && git merge strategy/[branch-name]
  ```
- **Results are worse:**
  → Discard branch, revert to `main`. Record the failed hypothesis in the changelog.
  ```bash
  git checkout main && git branch -d strategy/[branch-name]
  ```

---

## 🚫 Constraints
- **Never change strategy params without updating `STRATEGY.md` first** — update docs first, code only reads from it.
- **Never merge to main without a backtest** — every `strategy/*` branch must have backtest results before merging.
- **Never recommend Live** even if backtest results are good — it must pass Demo for ≥ 1 week.
- **Always use a strategy branch** — do not change parameters directly on `main`.

---

## Example
**User:** "Let's try increasing the confidence threshold to 0.80 and see how it goes."
**Action:**
1. Record baseline: `v1.1`, confidence 0.70, Profit Factor 1.72.
2. Branch: `git checkout -b strategy/confidence-0.80`
3. Plan: hypothesis is that higher threshold → fewer but higher quality trades → Win Rate might increase.
4. User approve → update `STRATEGY.md`: confidence 0.80, version `v1.2`, changelog `Not backtested yet`.
5. Run backtest → Profit Factor 1.85, Max Drawdown -7.2% (better).
6. Update changelog with real results.
7. Merge into main.
**Result:** New parameters applied with full evidence and audit trail.
