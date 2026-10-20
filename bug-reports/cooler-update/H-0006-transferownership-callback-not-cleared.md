# H-0006 — `loan.callback` is not cleared on `transferOwnership`; new lender without CoolerCallback support bricks repay/roll/default callbacks

- **Finding ID:** H-0006
- **Severity:** Medium (loan lifecycle brick)
- **Class:** state not reset on ownership transfer
- **Target:** Olympus Cooler (update) — `Cooler.sol`
- **Evidence class:** STATIC_PROOF
- **Status:** Confirmed (static proof)

## Summary

`transferOwnership` ( Cooler.sol:347-354) updates `loans[loanID_].lender = msg.sender` and clears the transfer approval, but does **not** clear `loan.callback`:

```solidity
function transferOwnership(uint256 loanID_) external {
    if (msg.sender != approvals[loanID_]) revert OnlyApproved();
    loans[loanID_].lender = msg.sender;
    approvals[loanID_] = address(0);
    // loan.callback left unchanged
}
```

If the original lender had `callback=true` and the new lender does **not** implement `CoolerCallback`, every subsequent `repayLoan` / `rollLoan` / `claimDefaulted` that hits:

```solidity
if (loan.callback) CoolerCallback(loan.lender).onRepay/onRoll/onDefault(...)
```

will call a non-existent function on the new lender and revert. The loan is bricked for repay, roll, and default — borrower cannot repay, lender cannot claim via the callback path (though `claimDefaulted`'s collateral transfer happens before the callback, the callback revert rolls back the whole tx).

Note: `clearRequest` validates `isCoolerCallback()` when `isCallback_=true` ( Cooler.sol:241), but transfer does not re-validate.

## Root cause

Missing `loan.callback = false` (or re-validation against the new lender) in `transferOwnership`.

## Impact

- Borrower cannot repay (repayLoan reverts at callback).
- Lender cannot claimDefaulted (reverts at callback after collateral transfer attempt).
- Loan effectively frozen until governance/manual intervention (none exists in Cooler).

## Preconditions

- Loan created with `callback=true` by a callback-implementing lender.
- Ownership transferred to a non-callback address.

## Recommendation

In `transferOwnership`, either force `loan.callback = false`, or require the new lender to pass `isCoolerCallback()` if `callback` remains true (mirror the `clearRequest` check).
