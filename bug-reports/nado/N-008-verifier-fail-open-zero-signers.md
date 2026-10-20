# N-008 — `Verifier.requireValidTxSignatures` fail-open at `nSigner == 0`; empty signatures pass and drain `WithdrawPool`

- **Finding ID:** N-008
- **Severity:** High (external attacker during key-removal window)
- **Class:** fail-open auth
- **Target:** Nado Core — `github.com/nadohq/nado-contracts`
- **Component:** `Verifier`, `BaseWithdrawPool`
- **Status:** Confirmed (static proof with file:line; no runtime PoC in this environment)

## Summary

`requireValidTxSignatures` validates `nSignatures == nSigner` but never requires `nSigner > 0`. When the owner deletes all verifier keys (a legitimate operational action — key rotation), `nSigner` becomes 0 and an empty signature array satisfies the check. Quorum-style checks elsewhere fail closed (`nSigned * 2 > nSigner` with `0 > 0` is false), but this path does not use them.

`submitFastWithdrawal` is public with no `msg.sender` check and feeds straight into `resolveFastWithdrawal` → `handleWithdrawTransfer`, which pays out pool liquidity.

## Root cause

```solidity
// Verifier.sol:342
require(nSignatures == nSigner);
```

With `nSigner == 0` and `nSignatures == 0`, the require passes. There is no companion `require(nSigner > 0)`.

Downstream (no inner sig, public entry):

- `BaseWithdrawPool.sol:93-127` — `submitFastWithdrawal` public, no caller check
- `resolveFastWithdrawal` (~:49-91) — no inner signature validation
- `handleWithdrawTransfer` (~:201-207) — drains pool to the signed recipient

## Impact

During the window in which all 8 verifier keys are deleted (key rotation, compromise response, shutdown), any external attacker can call `submitFastWithdrawal(crafted, [])` with an empty signature array and drain the `WithdrawPool`.

## Preconditions

- All verifier keys removed (`nSigner == 0`). This is a reachable operational state, not an admin privilege the attacker needs.

## Remediation

```solidity
require(nSigner > 0);
require(nSignatures == nSigner);
```
