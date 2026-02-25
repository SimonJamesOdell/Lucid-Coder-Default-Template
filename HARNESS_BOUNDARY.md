# Harness Boundary and Capability-Gated Execution

## Purpose
This template separates **LLM-editable app intent** from **harness-enforced correctness and safety**.

This is designed for users who may know nothing about programming or security. Safety and reliability guarantees are applied automatically by harness policy, not by user expertise.

## LLM-editable surface
- `llm_src/**`
- `llm_src_backend/**`

These files describe product intent (components, routes, endpoint schemas, contracts, logic metadata, invariants metadata).

## Harness-owned surface
- `harness/**`
- `validate_llm_invariants.cjs`
- `build_llm_bundle.cjs`
- `build_llm_backend.cjs`
- `validate_backend_runtime.cjs`
- `test_backend_smoke.cjs`
- `test_backend_security.cjs`

These files execute policy, generation, and verification. They are the source of truth for runtime enforcement.

## Plugin packs for agentic customization
- Plugin registry: `harness/plugins/registry.json`
- Active plugin state: `harness/active_plugins.json`
- Plugin manager CLI: `harness/plugin_manager.cjs`
- Plugin pack roots: `harness/plugin_packs/<pluginId>/`

Available scaffold plugin packs:
- `core`
- `backend_api`
- `auth_api`
- `storage_api`
- `upload_media`
- `realtime_events`
- `payments_checkout`
- `admin_policy`

Each plugin pack provides:
- files to copy into project on enable
- files to remove on disable
- manifest mutations to apply/revert
- dependency metadata

CLI commands:
- `npm run plugin:list`
- `npm run plugin:status`
- `node harness/plugin_manager.cjs plan <pluginId> [enable|disable]`
- `node harness/plugin_manager.cjs apply-plan <planPath> [--dry-run]`
- `node harness/plugin_manager.cjs enable <pluginId> [--dry-run]`
- `node harness/plugin_manager.cjs disable <pluginId> [--dry-run]`

Planning output is machine-readable JSON (copy/remove operations + manifest mutations) so agent systems can reason about exact effects before apply.
`apply-plan` enforces plan preconditions (manifest `before` arrays) to avoid silent drift.

## Conditional gate model
The harness reads `harness/capability_matrix.json` and auto-detects capabilities from LLM manifests.

Current capability:
- `backend_api`: enabled when `llm_src_backend/manifest.json` exists and has a non-empty `endpoints` array.
- `auth_api`: enabled when `llm_src/contracts/auth.json` declares required auth operations.

### Phase: `build_llm`
Always:
1. `node validate_llm_invariants.cjs`
2. `node build_llm_bundle.cjs`

Only when `backend_api` is enabled:
1. `node build_llm_backend.cjs`

### Phase: `dev`
Default (fast, fail-fast, selective):
1. `node validate_llm_invariants.cjs`
2. Runs `node build_llm_bundle.cjs` for frontend/backend changes
3. Runs `node build_llm_backend.cjs` only when backend capability exists and backend files changed

Optional strict mode:
1. `node validate_backend_runtime.cjs`
2. `node test_backend_smoke.cjs`
3. `node test_backend_security.cjs` when auth capability exists

Dirty-step cache:
- Dev phase stores scoped input fingerprints in `harness/.dev_cache.json`.
- Cacheable dev steps are skipped when their relevant LLM inputs are unchanged.
- Strict mode bypasses cache and always runs selected deep checks.

CLI:
- Fast mode: `npm run dev:check`
- Strict mode: `npm run dev:check:strict`
- Change-aware mode: `node harness/run_harness_gates.cjs dev --changed <filePath>`

### Phase: `test`
Always:
1. `node validate_llm_invariants.cjs`

Only when `backend_api` is enabled:
1. `node validate_backend_runtime.cjs`
2. `node test_backend_smoke.cjs`

Only when `auth_api` is enabled:
1. `node test_backend_security.cjs`

### Phase: `release`
Always:
1. `node harness/run_harness_gates.cjs build_llm`
2. `node harness/run_harness_gates.cjs test`
3. `npm run build`
4. `npm audit --omit=dev`

This phase is the template's deployment-readiness gate.

## Non-negotiable assurances
- **Secure by default**: backend security policy, production JWT secret requirement, CORS allowlist, rate limiting, and auth smoke/security tests when relevant capabilities exist.
- **Performance baseline**: production build and dependency audit gates run in release assurance phase.
- **Accuracy and robustness**: invariant validation, generated-runtime drift checks, and runtime smoke tests are required.
- **Capability awareness**: irrelevant checks are skipped for apps that do not define those capabilities (for example frontend-only apps).

## Why this matters
- Frontend-only projects do not pay backend test/build cost.
- Projects that add backend/API features automatically receive security/runtime gates.
- Safety-critical checks are enforced by harness logic, not user prompt quality.
