# H-0006 — Governance keys in `GaugeController` and `LendingLedger` have no transfer/rotation; lost key permanently freezes core operations

- **Finding ID:** H-0006
- **Severity:** Low / QA (centralization; privileged)
- **Class:** governance / liveness
- **Target:** Verwa — `GaugeController.sol`, `LendingLedger.sol`
- **Evidence class:** STATIC_PROOF
- **Status:** Confirmed (static proof)

## Summary

Governance in both `GaugeController` and `LendingLedger` is set once in the constructors and has **no** transfer or rotation function. A lost or burned governance key permanently freezes:

- Gauge whitelist operations (`add_gauge`, `remove_gauge`, `change_gauge_weight`)
- Reward setting
- Market whitelisting

This is a protocol liveness death for the admin surface.

## Root cause

No `setGovernance` / `transferGovernance` / two-step ownership pattern. Single immutable `governance` address set at construction.

## Impact

- Operational: permanent inability to manage gauges or markets.
- Severity class: centralization / governance per impact bar = QA report item (privileged trigger).

## Recommendation

Add a two-step governance transfer (propose + accept) or a timelocked rotation path, consistent with the rest of the protocol's admin patterns.
