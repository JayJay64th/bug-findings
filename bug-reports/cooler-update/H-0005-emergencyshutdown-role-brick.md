# H-0005 — `emergencyShutdown` reverts unless caller also holds `cooler_overseer`, because internal `defund` enforces `onlyRole(cooler_overseer)` against original `msg.sender`

- **Finding ID:** H-0005
- **Severity:** Low / QA (privileged operational footgun)
- **Class:** role-gating / emergency path broken
- **Target:** Olympus Cooler (update) — `Clearinghouse.sol`
- **Evidence class:** STATIC_PROOF
- **Status:** Confirmed (static proof)

## Summary

`emergencyShutdown` is gated by `onlyRole("emergency_shutdown")` ( Clearinghouse.sol:360). When the Clearinghouse holds any sDAI or DAI balance, it calls `defund(...)` ( Clearinghouse.sol:365, :369):

```solidity
function defund(ERC20 token_, uint256 amount_) public onlyRole("cooler_overseer") { ... }
```

`defund` is `public` with `onlyRole("cooler_overseer")`, and the internal call from `emergencyShutdown` preserves the original `msg.sender`. Unless the emergency-shutdown caller **also** holds the `cooler_overseer` role, `defund` reverts and the entire `emergencyShutdown` reverts — the emergency path is bricked precisely when the contract holds funds.

When balances are zero, the `if (balance != 0)` branches are skipped and shutdown succeeds.

## Root cause

Role check on a `public` function called internally with the external caller's identity, instead of a separate internal `_defund` without the role check (or checking `hasRole(msg.sender, emergency_shutdown) || hasRole(msg.sender, cooler_overseer)`).

## Impact

Operational: an emergency-shutdown key holder without the overseer role cannot shut down a funded Clearinghouse. Liveness of the emergency process.

## Recommendation

Extract an internal `_defund` without the role modifier; have both `defund` (external) and `emergencyShutdown` call it. Or document that emergency-shutdown callers must also be overseers and enforce that at role-grant time.
