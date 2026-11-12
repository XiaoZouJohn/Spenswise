# Agent Reminders Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver personal financial briefings on app opening and meaningful ledger changes.
**Architecture:** Existing SQLAlchemy Setting rows hold user preferences and one cached briefing; shared financial services compute facts. React Query observes mutations and polls a lightweight status endpoint; the model is invoked only for opening, manual viewing or a new risk tier.
**Tech Stack:** Existing FastAPI, SQLAlchemy, React, TypeScript, Playwright; no new runtime dependencies.
**Spec:** ../specs/2026-10-29-agent-reminders-design.md

## Global Constraints
- Only current user's data; independent opt-in for external AI; integer cents; no live data in tests.
- Reuse settings table, no schema change. Existing account export/deletion covers new settings.
- Work in the isolated ZIP checkout; don't overwrite deployed source or migrate its database.

## Review Focus
- In-flight model result after opt-out/account switch must not show or persist.
- Import completion, refund, month rollover and edited categories invalidate correct facts.
- Model timeout/invalid JSON and simultaneous requests do not block normal accounting or leak keys.
- Session restore versus reload versus new opening behaves as agreed.
- Closing a popup, cooldown, threshold bouncing, manual reopening and disabling avoid spam.

### Task 1: Backend briefing service and API
Files: app/services/agent.py, app/routes_agent.py, app/schemas.py, app/main.py, tests/test_agent.py.
- [x] Write API tests using temporary SQLite: authentication, independent consent, exact net-spending facts, risk tiers, owner isolation, model caching/failure/revocation.
- [x] Run tests before implementation; observed missing API failure.
- [x] Implement GET/PUT /api/agent/preferences, GET /api/agent/status, POST /api/agent/brief. Return typed preferences, fingerprint, risks, facts and max three cards.
- [x] Run pytest and existing backend checks; 49 passed; Ruff and mypy passed.

### Task 2: Top briefing card and change detection
Files: frontend/src/components/AgentReminder.tsx, frontend/src/lib/agent.ts, App.tsx, BudgetWarning.tsx, Settings.tsx, styles.css, generated client, tests/agent-reminder.spec.ts.
- [x] Add browser tests for open/reload/reopen, silent small transaction and important change. Initial pre-UI run blocked at browser navigation rather than reaching a missing-UI assertion; recorded honestly. Later checkbox/multiwindow regression failures observed and repaired.
- [x] Generate typed API client from local OpenAPI and reuse transport.
- [x] Implement scoped session state, coalesced checks, consent controls, fallback labels, dismiss/reopen, keyboard and narrow screen layout; update old budget expectation.
- [x] Run frontend build/lint and browser regressions; 23 passed, build and lint passed.

### Task 3: Delivery and verification
Files: README.md, AGENT-README.md, FEATURE_PARITY.md, start-agent.cmd, stop-agent.cmd, packaging/run_agent.py, packaging/stop-agent.ps1, docs/superpowers/progress.md.
- [x] Make isolated local installation runnable with double-click using unused port 8766 and its own database.
- [x] Record verification and inspect desktop/mobile screenshots. Fresh read-only code review for concrete defects only (not a Harness pass/fail judgment); five issues fixed.
- [x] Prepare modified source, launcher and evidence; document real-model limitations and that DeepSeek Judge did not run.
