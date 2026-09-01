# ADR 0001: Risk-Based QA

- Status: Accepted
- Date: 2026-09-01

## Context

The project needs fast feedback for everyday changes and stronger evidence for releases. A large test count does not provide that by itself: layout assertions cannot observe a rendered canvas, exact snapshots resist intentional balance changes, and duplicated gates increase maintenance without reducing risk.

## Decision

QA uses four layers with separate responsibilities:

1. `npm run qa` is the mandatory default gate: strict type checking, core behavior tests, and a production build.
2. Domain checks are change-scoped: simulations for combat balance, music audit for licensed assets, and foreground smoke checks for rendered UI and browser interaction.
3. `npm run release` is the distribution gate: version validation, automated QA, music audit, both build forms, external-resource inspection, and atomic packaging.
4. CI runs the same `npm run qa` command on pull requests and pushes to `main`.

Core tests are selected by player-facing risk, not code structure or coverage percentage. A test belongs in the default suite only when its failure maps to a concrete gameplay, persistence, interaction, or delivery failure.

## Alternatives

- Run every simulator and asset audit on every change: stronger on paper, but slow and unrelated failures dilute feedback.
- Maintain exhaustive unit and golden-snapshot coverage: fast to count, but tightly coupled to implementation and routine balancing.
- Rely only on end-to-end browser tests: realistic, but slower and less deterministic for the headless game core.

## Consequences

- The default gate stays fast enough to run before every delivery.
- Visual and balance quality remain explicit responsibilities rather than weak unit-test proxies.
- Changes must declare their affected domain and run the corresponding scoped gate.
- Test count may rise only when a new project risk is not protected by an existing scenario.
