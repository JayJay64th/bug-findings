# N-012 — `WithdrawCollateralV2` EIP-712 typehash omits `feeX18`; user sets fee to 0 and withdraws free

- **Finding ID:** N-012
- **Severity:** Medium
- **Class:** unsigned fee field / signature coverage gap
- **Target:** Nado Core — `github.com/nadohq/nado-contracts`
- **Component:** `Verifier`, `EndpointTx`, `SpotEngine`
- **Status:** Confirmed (static proof with file:line; no runtime PoC in this environment)

## Summary

The V2 withdraw path charges a fee that the **user's signature does not cover**. The assembler (or any party that can set fields on the signed struct after signing) sets `feeX18 = 0`, and both bounds checks accept it:

```solidity
// EndpointTx.sol:465-466
require(feeX18 >= 0);
require(feeX18 <= currentFeeX18);
```

`0` passes both. `chargeFee` then debits `signedTx.feeX18` (zero). The QUOTE withdraw fee is `1e18` ($1) per `SpotEngine.sol:30`, so any user with a valid V2 signature can withdraw collateral with no fee.

The V1 path does this correctly: `EndpointTx.sol:438-441` charges the config `withdrawFeeX18` directly, independent of any user-supplied field.

## Root cause

```solidity
// Verifier.sol:33-34 — WITHDRAW_COLLATERAL_V2_SIGNATURE omits feeX18
// IEndpoint.sol:106-110 — SignedWithdrawCollateralV2 has feeX18 outside the signed tx struct
```

The EIP-712 digest covers `(sender, …)` transaction fields but not `feeX18`, so the fee is assembler-controlled, not signer-controlled.

## Impact

Any user with a valid V2 withdraw signature sets `feeX18 = 0` and pays zero withdraw fee. Repeated across users: protocol fee revenue on V2 withdrawals is fully bypassable.

## Remediation

Either:

1. Add `feeX18` to the `WITHDRAW_COLLATERAL_V2_SIGNATURE` typehash and include it in the digest encode, **or**
2. Charge `currentFeeX18` from config on the V2 path (same as V1) and remove the user-supplied fee field.
