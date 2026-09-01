---
name: run-backtest
description: >
  Run backtest and evaluate results against the baseline in STRATEGY.md.
  Supports both modes: rule-based (fast, uses no Gemini quota) and ai-simulated (real Gemini calls).
  Provides a conclusion on whether to apply the parameters to Demo.
  Use when user says "run backtest", "test strategy".
---

# 📊 Run Backtest Workflow
> **Purpose:** Run backtests following the standard process, compare with the baseline, and draw reasoned conclusions before changing parameters on Demo/Live.
> **Philosophy:** All strategy changes must be confirmed by backtests — do not apply changes based on intuition.

## Trigger
When the user asks to run a backtest, test a strategy, or evaluate strategy results.

---

## Workflow Steps

### Step 1: 📚 Read Current Strategy State
1. Read `@docs/STRATEGY.md`:
   - Note the **current version** (e.g., `v1.1`)
   - Note baseline parameters: MA period, RSI threshold, ATR multiplier, confidence threshold
   - Note the **baseline backtest results** (if present in the changelog)
2. Verify `src/config.js` and `.env` are loading the correct current strategy parameters.

### Step 2: 🎛️ Choose Backtest Mode
Ask the user (or infer from context):

| Mode | When to use | Command |
|--------|-------------|------|
| **Rule-based** | Fast testing, optimizing params, no Gemini quota used | `node scripts/run_backtest.js` (default) |
| **AI-simulated** | Testing real prompt quality with Gemini | `node scripts/run_backtest.js --mode=ai` |

> ⚠️ Prioritize **rule-based** when only changing indicator params. Only use **ai-simulated** when changing the prompt template.

### Step 3: ▶️ Run Backtest
```bash
node scripts/run_backtest.js
```
Monitor the console output. If errors occur → analyze the cause before reading the results.

### Step 4: 📈 Read & Present Results
Read `backtest_result.json` and present the results in the standard format:

| Metric | Current Result | Baseline | Δ (Change) | Target (PRD §3) |
|--------|-----------------|----------|--------------|-----------------|
| Win Rate | X% | Y% | ±Z% | — |
| Profit Factor | X | Y | ±Z | ≥ 1.5 |
| Net Profit | $X | $Y | ±$Z | — |
| Max Drawdown | X% | Y% | ±Z% | ≤ 15% |
| Sharpe Ratio | X | Y | ±Z | ≥ 1.0 |

**If mode is `ai-simulated`:**
1. Locate the newly generated detailed log in the `logs/` directory (e.g., `logs/backtest_trade_log_YYYYMMDD_HHmmss.json`).
2. Read the `summary` section of this JSON file.
3. Present an additional "AI Filter Quality" report highlighting:
   - **AI Acceptance Rate**: X% (Accepted / Total Rule Signals)
   - **Losses Avoided (True Negatives)**: X
   - **Wins Missed (False Negatives)**: Y
   - **AI Ruined Wins (AI SL/TP caused loss)**: Z
   - **AI Saved Losses (AI SL/TP caused win)**: W
   - **Verdict**: (e.g., `effective_loss_prevention` or `opportunity_cost_high`)
4. Compare the Net Profit of `ai_accepted_actual` vs `ai_accepted_rule_simulated` to evaluate if the AI's dynamic SL/TP outperformed the rule-based SL/TP.

Confirm the `strategy_version` in `backtest_result.json` matches the version in `STRATEGY.md`.

### Step 5: 🎯 Verdict & Recommendation
Provide a clear conclusion based on the comparison with the baseline and success metrics from `PRD.md §3`:

**✅ Recommend apply to Demo if:**
- Profit Factor ≥ 1.5
- Max Drawdown ≤ 15%
- Sharpe Ratio ≥ 1.0
- Not significantly worse than the baseline (per `PROJECT-RULES.md §8.4`)

**❌ Do NOT apply if:**
- Any metric is below the target
- Max Drawdown is significantly worse than the baseline

**⚠️ Hard reminder:** No matter how good the backtest is, **never recommend switching to Live** unless the Demo has run stably for ≥ 1 week (per `PROJECT-RULES.md §1.3`).

---

## 🚫 Constraints
- **Never recommend Live** without ≥ 1 week of Demo — regardless of how good the backtest is.
- **Do not modify strategy parameters** in this workflow — that's the job of the `tune-strategy` workflow.
- **Must confirm strategy_version** in the output file matches `STRATEGY.md` before reading the results.
