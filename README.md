# Lucid Coder Default Template

This repository is the default project framework for **Lucid Coder**:
https://github.com/SimonJamesOdell/Lucid-Coder

It provides a structured template for building web applications with an AI-editable control surface and a deterministic JavaScript harness for build, validation, security checks, and release assurance.

## Important Disclaimer

- This repository is **100% AI generated**.
- It is provided **as-is**.
- There is **no implied or express warranty** for any purpose, including fitness, merchantability, correctness, security, reliability, or suitability for production use.
- You are responsible for reviewing, testing, and validating all outputs before use.

## What This Template Is

The template separates project concerns into two layers:

1. **LLM control surface** (`llm_src/**`, `llm_src_backend/**`)
   - Agent-editable project intent (components, routes, contracts, endpoint schemas, logic definitions, etc.)

2. **Harness layer** (`harness/**` + build/validation scripts)
   - Deterministic generation and enforcement
   - Capability/plugin management
   - Security/invariant checks
   - Release assurance gates

## Use With Any Agentic System

This repository can be used with any agentic coding system that can:

- Edit structured files in the LLM control surface
- Run project commands
- Read machine-readable planning outputs

Typical workflow:

1. Agent plans capability changes (plugin plan)
2. Agent applies approved plan deterministically
3. Agent edits LLM control-surface files
4. Agent runs fast checks during iteration
5. Agent runs release assurance before deployment

Useful commands:

- `npm run dev:check`
- `npm run dev:check:strict`
- `npm run build:llm`
- `npm test`
- `npm run release:assure`
- `npm run plugin:list`
- `npm run plugin:status`
- `npm run plugin:plan -- <pluginId> <enable|disable>`
- `npm run plugin:apply-plan -- <planPath>`
- `npm run template:doctor`
- `npm run template:doctor:deep`

## Intended Primary Use

Although compatible with other agentic systems, this template is intended to be the **default framework for Lucid Coder** projects:
https://github.com/SimonJamesOdell/Lucid-Coder

## Notes

- Keep app/domain edits inside the LLM control surface.
- Treat harness policies and assurance gates as authoritative safety controls.
- Use plugin packs to add/remove capabilities instead of ad-hoc structural edits.
