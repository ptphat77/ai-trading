---
name: pre-commit-check
description: >
  Check code quality and project rules compliance before committing.
  Run safety checklist specific to trading bots: no hardcoded secrets, no bypassing RiskManager,
  no missing try/catch, STRATEGY.md updated if strategy parameters changed.
  Use when user says "pre-commit", "check code".
---

# ✅ Pre-Commit Check Workflow
> **Purpose:** Ensure code meets the quality gate before committing — especially critical safety rules for the trading bot.
> **Philosophy:** A bug in a trading bot can lead to incorrect orders; the pre-commit check is the last line of defense.

## Trigger
When the user requests to check code before a commit, or uses keywords like "pre-commit", "check code".

---

## Workflow Steps

### Step 1: 🔍 Review Changes
1. Run `git diff` and `git diff --cached` to see all changes.
2. Run `git status` to see the list of files to be committed.

### Step 2: 🛡️ Safety Checklist

Check each item below and report **PASS / FAIL / N/A** for each:

#### 🔐 Security
- [ ] **No .env staged**: `.env` does not appear in `git status --short` under staged.
- [ ] **No secrets in code**: No API keys, tokens, or account IDs are hardcoded in the diff.
- [ ] **No secrets in logs**: `OANDA_API_KEY` or `GEMINI_API_KEY` are not in any `console.log` or logger calls.

#### 🏗️ Architecture & Config
- [ ] **No hardcoded config**: No URLs, model names, thresholds, or risk % hardcoded in business logic — everything read from `src/config.js`.
- [ ] **No hardcoded strategy params**: MA period, RSI threshold, ATR multiplier not hardcoded in code — reference `STRATEGY.md` and read via config.
- [ ] **Correct file location**: Newly created files are in the correct location by layer according to `ARCHITECTURE.md`.
- [ ] **Naming convention**: PascalCase for files, camelCase for functions/variables.

#### ⚠️ Safety Rules (Trading-specific)
- [ ] **No blind trades**: All code paths leading to `createOrder` go through validation (confidence check, JSON parse check).
- [ ] **RiskManager not bypassed**: No code path calls `createOrder` without going through `RiskManager.calculateUnits()`.
- [ ] **No new position while open**: Logic to check `getOpenPositions()` before opening a new position remains intact.
- [ ] **All API calls have try/catch**: Every `await oandaClient.*` and `await geminiAgent.*` is inside a `try/catch`.

#### 📝 Code Quality
- [ ] **No stray debug logs**: No `console.log('debug...')` or temp logs bypassing `logger.js`.
- [ ] **Single Responsibility**: New modules only do one thing, no importing from inappropriate layers.
- [ ] **STRATEGY.md updated**: If the diff contains strategy parameter changes → `STRATEGY.md` has a new changelog line with an incremented version.

#### 🧪 Testing
- [ ] **Tests exist for new modules**: If a new indicator or logic module is created → a corresponding test file exists in `tests/`.

---

### Step 3: 📊 Report Results

Present the results in standard format:

```
✅ PASS — No .env staged
✅ PASS — No secrets in code
❌ FAIL — Hardcoded URL found in OandaClient.js line 12
⚠️  N/A  — STRATEGY.md update (no strategy param changes)
```

### Step 4: 🎯 Recommendation

- **If all PASS (or N/A):** → Suggest running the `git-commit` skill.
- **If there are any FAILs:** → Clearly list each fail item, explain the issue, and suggest fixes before committing.

---

## 🚫 Constraints
- **No auto-fix:** This workflow only reports — it does not fix the code itself. Fix it, then commit.
- **Do not ignore Security items:** Any fail in the Security section is a hard blocker — do not suggest committing while security checks fail.
- **Do not ignore RiskManager check:** This is the most important safety rule of the project.
