# SpendWise Algorithm Improvements Implementation Plan

> Execute inline with superpowers:executing-plans and test-driven-development. The user approved the four deliverables in chat and requested direct implementation.

**Goal:** Improve calculation reliability, monthly evaluation, decomposed forecasts and actionable budget constraints on supplied main `92b6481382cd3a289133a437d8ae61586c61dcf0`.

**Architecture:** Keep financial logic in services and retain existing API fields. Add optional coverage, confirmed cash events, dated balance inputs and category constraints. Use existing NumPy/SciPy/Pydantic; no new production dependencies. Store coverage in existing owner-scoped Settings and scenario inputs in existing JSON; no schema migration needed.

**Spec:** The four-deliverable plan approved in this chat: reliable calculation foundations; owner-isolated rolling monthly backtests; fixed/variable expense decomposition; personalized, time-feasible budget cuts.

## Constraints and decisions

- Work in a fresh ZIP extraction, local feature branch; preserve the uploaded archive and original local application.
- Do not deploy, push, call real AI or read users' production ledgers.
- Unknown coverage is not zero spending. Explicit complete ranges can include zero months. Inferred coverage must carry a warning.
- Dated balances are end-of-day snapshots. Future cash events are user-confirmed additional amounts, not inferred income; no past events or dates beyond the next month.
- Existing clients and saved results must parse with defaulted new fields. Legacy ledger balances are labelled estimates, not verified balances.
- Keep AI adjustment opt-in and report its contribution separately; evaluating pure algorithms never calls AI.
- Full API tests previously blocked in Windows socketpair initialization. Recheck the environment; record actual limitations without claiming passes.
- GPT performs implementation and verification, not independent Harness approval; DeepSeek Judge is not active.

## Review focus

- Missing months versus confirmed zero months; short or disjoint coverage and future data leakage.
- Month-end recurring charges, stale subscriptions, refunds, fixed costs counted twice.
- Integer-cent feasibility and daily deficits before income arrives.
- Old clients omitting new settings; saved old scenarios; crossed-user backtests.
- Repeated validation selection and final chronological holdout separation.

## Tasks

### 1. Forecast foundations and decomposition
- [x] Add failing regression tests for coverage denominators, confirmed-zero months, future-row exclusion, month-end recurring charges, inactive subscriptions and no double counting.
- [x] Extend settings/schema contracts and monthly forecast services with explicit coverage and quality metadata.
- [x] Separate identified active fixed bills from variable monthly history; normalize variable monthly rates by covered days. Preserve conservative fallbacks.
- [x] Verify focused tests and existing core tests.

### 2. Cashflow and constrained saving
- [x] Add failing tests for integer cuts, floors/preference weights, insufficient capacity, early cash deficits, end-of-day balance snapshots and month bridging.
- [x] Add optional category constraints, balance snapshot and confirmed cash events to ScenarioIn.
- [x] Solve integer-cent cuts with existing SciPy MILP, enforce cumulative daily constraints and expose adjusted timeline and shortfall.
- [x] Verify input validation and backward-compatible defaults.

### 3. Rolling monthly evaluation
- [x] Add failing tests for owner isolation, future exclusion, zero months, insufficient history and validation/test split.
- [x] Implement pure monthly evaluation service plus CLI with owner selection, as-of date, JSON output and explicit coverage input.
- [x] Compare last-month, three-month mean, historical ensemble and decomposed forecasts; select on validation months only and report frozen final holdout results.
- [x] Run reproducible synthetic evaluation, explicitly distinguish it from real-world accuracy evidence.

### 4. Integration and delivery
- [x] Regenerate OpenAPI TypeScript client from the actual app schema.
- [x] Add compact controls for coverage, balance, additional cash events and category minimum/preference constraints; display forecast quality, decomposition and feasibility evidence.
- [x] Complete full API and four core browser flows (75 backend, 4 browser tests passed).
- [ ] Recheck the final mobile legend/screenshot-only tweak in browser; final rerun not executed due approval-service HTTP 403.
- [x] Prepare updated source, patch, verification report and checkpoint handoff.
- [ ] Teammate/independent Judge review before merge, outside this local implementation handoff; no approval claimed.

Verification qualification: full backend and core browser flows passed; final small mobile chart display tweak is build-checked but its browser rerun was blocked by approval service. No independent Judge verdict.
