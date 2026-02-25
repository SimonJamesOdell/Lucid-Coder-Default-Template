# Template Framework Spec (v1)

## Purpose
This repository is a template framework for an agentic in-browser IDE.

It separates:
- **LLM Control Surface**: app intent and domain changes in LLM-optimized files.
- **Harness Enforcement Layer**: deterministic generation, security policy, validation, and release assurance.

## Mutation Boundary
LLM agent edits are constrained to:
- `llm_src/**`
- `llm_src_backend/**`

Harness files are authoritative and not edited by app-level intent workflows.

## Capability Lifecycle
Capabilities are managed through plugin packs:
- Registry: `harness/plugins/registry.json`
- Active state: `harness/active_plugins.json`
- Manager: `harness/plugin_manager.cjs`

Current plugin catalog includes:
- `core`
- `backend_api`
- `auth_api`
- `storage_api`
- `upload_media`
- `realtime_events`
- `payments_checkout`
- `admin_policy`

Agent flow:
1. Plan: `node harness/plugin_manager.cjs plan <pluginId> [enable|disable]`
2. Review JSON plan output
3. Apply deterministically: `node harness/plugin_manager.cjs apply-plan <planPath>`

## Required Commands
- Dev fast checks: `npm run dev:check`
- Dev strict checks: `npm run dev:check:strict`
- LLM build: `npm run build:llm`
- Test gates: `npm test`
- Release assurance: `npm run release:assure`
- Template integrity: `npm run template:doctor`

## Release Contract
A deployment candidate must pass:
- `npm run release:assure`

This enforces capability-aware build, invariant checks, runtime/smoke/security tests, frontend compile, and dependency audit.

## Doctor Contract
`template:doctor` is a template integrity gate for onboarding and CI:
- Verifies core files and JSON manifest health
- Verifies plugin registry/state coherence
- Verifies required package scripts
- Optional deep mode validates harness detect + invariant checks

Run deep mode with:
- `npm run template:doctor:deep`
