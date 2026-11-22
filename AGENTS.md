# Agent & Contributor Instructions (`0trust-lab-workforce-journey`)

## Two-Way Global <-> Local Architecture Diagram Sync

This repository is the standalone **Model 1** implementation of **Lab 1 (`Workforce Identity Lifecycle` / `/workforce-journey`)** in the `0trust.dev` ecosystem.

Whenever you modify code, edge functions, or infrastructure under `src/`, `functions/`, or `infra/`:

1. **Local Sync**: Update [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and/or the Lab 1 SVG diagrams in [`docs/diagrams/`](docs/diagrams/) in the **same Pull Request** (enforced by [`.github/workflows/diagram-check.yml`](.github/workflows/diagram-check.yml)).
2. **Global Sync**: If any public contract, seat topology, API endpoint, KV prefix, SCIM/SoD/JIT/CAEP flow, or Terraform boundary changes, also update:
   - `docs/diagrams/workforce_journey_blueprint_topdown.svg`
   - `docs/diagrams/workforce_journey_platform_capability_zoomin.svg`
   - `docs/ARCHITECTURE.md` and `src/contracts/labManifest.ts`
   in [`c2pig/0trust.dev`](https://github.com/c2pig/0trust.dev) and keep [`lab.manifest.json`](lab.manifest.json) in sync.

## Always Create PR & Merge

- Never commit directly to `main` or leave completed work unmerged on a local branch after initial bootstrap.
- Always create a Pull Request from a feature branch and merge it once local verification and required CI checks pass.
