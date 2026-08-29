---
name: git-commit
description: >
  Automates analyzing staged/unstaged changes, proposing a commit message via an Implementation Plan,
  and executing the commit after user approval. Supports a special "strategy" commit type for STRATEGY.md changes.
  Use when user says "commit", "git commit", "save changes", or "create commit".
---

# 📦 Git Commit with Plan
> **Purpose:** Ensure code changes are reviewed and the commit message is approved by the user before executing any git command.
> **Version:** 1.0
> **Tags:** workflow, git, version-control

## Trigger
When the user requests to commit changes, save to git, or create a commit.

---

## Instructions

### Step 1: 🔍 Analyze Changes
1. Run `git status` to see modified, untracked, and staged files.
2. Run `git diff` and `git diff --cached` to understand line-by-line changes.
3. **Immediate safety check:**
   - Ensure `.env` is not staged (`git status` will show this) — if it is, **STOP** and warn the user immediately.
   - Ensure no API keys appear in the diff.

### Step 2: 📝 Determine Commit Type
Choose the appropriate **commit type**:

| Type | When to use |
|------|-------------|
| `feat:` | Adding a new feature (module, function) |
| `fix:` | Fixing a bug |
| `chore:` | Config, dependencies, gitignore, package.json |
| `docs:` | Editing documentation (ARCHITECTURE.md, PRD.md, etc.) |
| `test:` | Adding or modifying tests |
| `refactor:` | Refactoring code without changing behavior |
| `strategy:` | **Special** — exclusively for changing parameters in `STRATEGY.md` with backtest results |

### Step 3: 📋 Create Implementation Plan (MANDATORY)
1. Do **NOT** run `git add` or `git commit` at this time.
2. Create or update `implementation_plan.md` with:
   - **Files to be staged:** List of files to add
   - **Proposed Commit Message:** Title + Body (if necessary)
   - **Summary of Changes:** Brief explanation of what changed and why
   - **Strategy changelog update** (if it's a `strategy:` commit): confirm `STRATEGY.md` has a new changelog entry
3. Set `RequestFeedback: true` in the artifact metadata.

### Step 4: 🛑 Wait for User Approval
1. Stop and wait for the user to approve the plan.
2. If the user requests edits to the message or file list → update the plan and wait again.

### Step 5: 🚀 Execute Commit
1. **Only after user approval**, execute:
   ```bash
   git add [files]
   git commit -m "[approved message]"
   ```
2. Verify using `git log -1` and report success.

---

## Constraints
- **MANDATORY BLOCKER:** Never run `git commit` without explicit user approval.
- **SAFETY BLOCKER:** If `.env` is staged → STOP immediately, do not proceed.
- Commit messages must follow Conventional Commits format.
- `strategy:` commits must confirm that `STRATEGY.md` has a new changelog entry.

---

## Example
**User:** "Commit recent changes."
**Action:**
1. `git status` → sees `src/indicators/ATR.js` modified, `tests/ATR.test.js` is new.
2. Propose type: `feat:` (adding tests for an existing module).
3. Create `implementation_plan.md`: stage both files, message `feat: add unit tests for ATR indicator`.
4. User approve.
5. `git add src/indicators/ATR.js tests/ATR.test.js` → `git commit -m "feat: add unit tests for ATR indicator"`.
6. `git log -1` → confirm success.
