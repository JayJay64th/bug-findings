# [F-01] Operator can point the fee recipient at `address(0)`, permanently locking accrued fee shares and diluting lenders

- **Asset:** `Factory.sol` (operator setter) + `Pool.sol` (fee-share mint) — `surge-protocol-v1 @ b7cb1dc`
- **Type:** broken invariant / privileged-role loss of user funds
- **Severity (suggested):** High per the program's own rule ("unexpected loss of funds due to the operator
  role should be considered high severity"); Medium if scope is read narrowly. Privileged trigger,
  bounded (≤ 20% of interest), irreversible.

## Summary

`Factory.setFeeMantissa` enforces the invariant *"a nonzero fee requires a nonzero fee recipient"*:

```solidity
// Factory.sol:60
function setFeeMantissa(uint _feeMantissa) external {
    require(msg.sender == operator, "Factory: not operator");
    require(_feeMantissa <= MAX_FEE_MANTISSA, "Factory: fee too high");
    if(_feeMantissa > 0) require(feeRecipient != address(0), "Factory: fee recipient is zero address");
    feeMantissa = _feeMantissa;
}
```

`Factory.setFeeRecipient` (`Factory.sol:52`) has **no** such guard, so the invariant can be broken after
the fact (`setFeeMantissa(0.2e18)` then `setFeeRecipient(address(0))`). `Factory.getFee` then returns
`(address(0), 0.2e18)`:

```solidity
// Factory.sol:86
function getFee() external view returns (address, uint) {
    uint _feeMantissa = feeMantissa;
    if(_feeMantissa == 0) return (address(0), 0);
    return (feeRecipient, _feeMantissa);   // feeRecipient may be address(0)
}
```

Every state-changing `Pool` function mints accrued fee shares to that address:

```solidity
// Pool.sol:163 (getCurrentState)
_accruedFeeShares = fee * _totalSupply / _supplied;
...
// e.g. Pool.sol:336 (deposit)
if(_accruedFeeShares > 0) {
    balanceOf[_feeRecipient] += _accruedFeeShares;
    emit Transfer(address(0), _feeRecipient, _accruedFeeShares);
}
```

Shares held by `address(0)` are counted in `totalSupply` (so they dilute every lender's redemption) but can
never be redeemed or transferred — the value backing them is permanently stranded.

## Steps to reproduce

1. Deploy `Factory`. Call `setFeeRecipient(0xBEEF)`, then `setFeeMantissa(0.2e18)`.
2. Call `setFeeRecipient(address(0))` — **succeeds** (no guard).
3. Deploy a pool; deposit `100e18`; `addCollateral(100e18)`; `borrow(20e18)`.
4. `vm.warp(+365 days)` and trigger accrual (e.g. `withdraw(0)`).

Observed (`forge test --match-test test_PA -vv`):

```
fee shares minted to address(0): 400000000000000000
totalSupply: 100400000000000000000
```

`0.4e18` of the `100e18` pool is now owned by an address that can never move it.

## Root cause

Asymmetric validation: the "nonzero recipient" invariant is enforced only in `setFeeMantissa`, not in
`setFeeRecipient`, and `Pool` does not guard against a zero recipient.

## Impact

Permanent dilution of lender redemption value and irretrievable stranding of the fee portion of pool
value. With a 20% fee and high interest, the stranded amount grows without bound. It is also reachable
by an accidental `setFeeRecipient(address(0))`, making it a plain robustness bug.

## Remediation

- Add `require(_feeRecipient != address(0))` to `Factory.setFeeRecipient` (and/or clear/zero `feeMantissa`
  if the recipient is ever set to zero).
- Defence in depth: `Pool` should skip the fee-share mint (or revert) when `_feeRecipient == address(0)`.

## Dedupe note

No prior audits (README). Distinct from any "admin can set the fee" observation: the fee amount stays
within `MAX_FEE_MANTISSA`; the bug is the *recipient* invariant break and the resulting permanent lock.
