---
name: catchup
description: >
  Summarize the project state to resume work after an interruption.
  Analyze git history, artifacts, and STRATEGY.md changelog.
  Use when user says "catchup", "where were we", "recap", or "what's next".
---

# 🔄 Catchup Workflow
> **Purpose:** Quickly bring the AI and user back into context after an interruption by analyzing git, artifacts, and the current strategy state.
> **Philosophy:** Don't ask the user what to do if it can be found from the environment (git, artifacts, docs).

## Trigger
When the user wants to resume work, asks about the current state, or uses keywords like "catchup", "where were we", "recap", "what's next".

---

## Workflow Steps

### Step 1: 🔍 Analyze Git State
1. Run `git status` — check uncommitted changes, staged files, active branch.
2. Run `git log -5 --oneline` — check the last 5 commits to understand recently completed work.
3. Pay special attention to the **`strategy/*` branch**: if on this branch, the context is experimenting with strategy parameters.

### Step 2: 📄 Analyze Active Artifacts
1. Check the artifact directory of the current conversation.
2. Read `task.md` (if available) — see which tasks are `[x]` done, `[/]` in progress, `[ ]` pending.
3. Read `implementation_plan.md` (if available) — understand the architectural goals being pursued.

### Step 3: 📊 Check Strategy State
1. Read `@docs/STRATEGY.md`:
   - What is the current version?
   - Does the latest backtest have results? If not → that's a task to do.
   - Are there any parameter changes not confirmed by backtests?
2. Check `logs/trade_log.jsonl` (if available) — has the bot run? Any recent errors?

### Step 4: 🧠 Analyze Conversation History (If needed)
If the context is still unclear after git + artifacts:
1. Grep the transcript to view recent interactions.
2. Look for patterns: what feature is being built? What bug is being fixed?

### Step 5: 🗣️ Present Summary & Next Steps
Generate a Markdown response for the user including:

- **📌 Last Known State:** Summary of recently completed work (from git log or `task.md`).
- **🔄 Current Status:** Uncommitted files, tasks in progress, strategy version.
- **⚠️ Attention Items:** Any warnings — e.g., parameters changed but not backtested, is the bot on Demo or Live?
- **➡️ Next Recommended Action:** The logical next step based on pending tasks and the verification plan (`ARCHITECTURE.md §6`).
- **Call to action:** End with a clear question: "Continue with [Next Action]?"

---

## 🚫 Constraints
- **Do not invent tasks:** Only propose next steps based on existing artifacts, git, or documentation.
- **Do not ignore strategy state:** Always check `STRATEGY.md` — a trading bot needs to know which strategy is active.
- **Keep it concise:** The user wants to get back to work quickly — use bullet points, avoid long text.
