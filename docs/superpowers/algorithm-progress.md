# Ledger — 2026-11-17 algorithm improvements

User approved direct implementation of the four deliverables. Base is uploaded GitHub main ZIP, commit 92b6481382cd3a289133a437d8ae61586c61dcf0.

Pre-flight: settings coverage feeds monthly projection and backtesting; scenario constraints feed simulation and UI. All new response fields require defaults for old saved results.

Ruling: use an independently extracted source tree and local feature branch because the input is a ZIP, not an existing checkout.
Ruling: no external Harness invocation was requested; report Judge not run.
Ruling: use optional owner Settings coverage ranges and scenario-scoped balance/events/preferences; reuse existing JSON storage, no migration.
Ruling: scope excludes second-stage anomaly detection, classification, deduplication and AI model deployment.


Implementation record (2026-11-17):
- Foundation regressions were observed failing before changes; focused foundation suite then passed 11 tests.
- Added chronological evaluation tests; observed missing-module failure, implemented evaluation, verified owner isolation and frozen selection.
- Added integration checks for snapshot date, future events, owner isolation, old settings/results and adjusted cashflow reconciliation.
- Additional failing regressions exposed daily remainder oversaving and disjoint-coverage denominators; both corrected and included in the passing suite.
- Current service suite: 37 passed, 2 deselected (TestClient-dependent); no AI calls.
- TypeScript, ESLint and an initial production build passed. OpenAPI regenerated offline from app.openapi().
- Playwright collects three focused flows; browser execution is unverified.

Ruling: keep the supplied ZIP as read-only base and deliver a fresh full source archive plus patch; no push/deploy.
Ruling: without a dated snapshot, cashflow starts at zero change rather than presenting ledger difference as a verified account balance; callers needing balance must supply the new snapshot pair.
Ruling: keep the legacy model only for reproducible offline comparison. Decomposed default is not claimed to improve real-user accuracy without real-data holdout evidence.
Ruling: an infeasible optimization returns no executable cuts plus capacity/shortfall; it does not prescribe a partial plan that still fails the target.
Ruling: no new database migration or production dependency; existing per-owner Setting and Scenario JSON store additions.
Ruling: do not substitute a GPT review verdict for the user's required DeepSeek Judge. Judge was not run and no independent approval is claimed.
Verification limitation: full API run needs local sockets blocked in sandbox; escalation was not executed because the automatic approval service returned HTTP 403. Do not bypass that failure. Complete unaffected checks and report the limit explicitly.


CHECKPOINT 1 — user requested saving before shutdown and continuing in the afternoon.
- Focused backend suite: 37 passed, 2 TestClient-dependent tests deselected.
- Final Ruff: 45 files formatted; lint passed. Final Mypy: 26 files passed.
- Final TypeScript and ESLint passed; Vite production build passed (2897 modules).
- Three Playwright tests collected, not browser-executed.
- Synthetic backtest selected fixed-variable on validation; holdout MAE 0 on deliberately simple synthetic fixture; no real-world accuracy claim.
- Source diff whitespace check passed after matching LF line endings. Generated Vite bundle retains tool-produced whitespace inside bundled code; not manually edited. Build completed before content-neutral source line-ending normalization.
- Full implementation is saved as checkpoint, not claimed independently reviewed or fully integration-tested.
- Next: resolve test environment/approval service availability; run full API and focused Playwright suite, inspect runtime UI; fix findings; complete independent review according to the user's Harness role boundary.
- No servers, deployment jobs or real-model requests were started.


RESUMED CHECKPOINT 2 — 2026-11-17
- User explicitly resumed work. Kept original implementation scope and reused isolated branch.
- Escalated test execution was approved: initial full backend suite 74 passed; added real HTTP roundtrip/owner-isolation test; final full backend suite 75 passed, 0 skipped, 70.69s. XML retained outside source tree.
- API roundtrip checks: coverage persistence/legacy omissions, owner separation, scenario snapshot/events/constraints persistence, invalid dates/pairs return 422.
- Core browser suite expanded to four flows. A broad status locator matched multiple elements; narrowed to the exact saved-message text. Four tests passed in 1.2m with screenshots (before the final display tweak).
- Viewed desktop and 390px mobile screenshots. Changed chart legend to scroll to avoid wrapping into the axis; close existing Agent popup before evidence screenshots. Final TypeScript, ESLint and Vite build passed after this small change.
- Final browser rerun was NOT executed: automatic approval service HTTP 403. Previous browser reports must be described as preceding the final legend/screenshot-only changes. No bypass attempted.
- Backend Ruff 46 files and Mypy 26 files passed. No new production dependency/schema migration.
- Existing large-bundle warning remains. No true-model API used, no production ledger accessed, no deployment or push.
- Independent DeepSeek Judge and teammate merge review remain outside this local implementation result; no approval claimed.
- Next: rerun four focused browser flows to check the final mobile legend when approval service is available; then use real anonymized history for accuracy evaluation and arrange teammate review before merge.
