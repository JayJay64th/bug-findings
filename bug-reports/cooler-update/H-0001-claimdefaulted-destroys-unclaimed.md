# H-0001 — `Cooler.claimDefaulted` destroys `loan.unclaimed`, losing lender funds when `repayDirect=false` and partial repayments exist

- **Finding ID:** H-0001
- **Severity:** Medium–High (fund loss to lender)
- **Class:** fund loss on default claim
- **Target:** Olympus Cooler (update) — `Cooler.sol`
- **Evidence class:** STATIC_PROOF
- **Status:** Confirmed (static proof; PoC pending)

## Summary

When a loan is created with `repayDirect=false`, partial repayments accrue in `loan.unclaimed` ( Cooler.sol:170-171) and are meant to be collected later via `claimRepaid` ( Cooler.sol:304-313). If the loan defaults and anyone calls `claimDefaulted`, the function does `delete loans[loanID_]` ( Cooler.sol:320) **before** transferring collateral — permanently destroying any accumulated `unclaimed` debt tokens held by the Cooler on behalf of the lender.

## Root cause

```solidity
// Cooler.sol:318-333
function claimDefaulted(uint256 loanID_) external returns (uint256, uint256, uint256) {
    Loan memory loan = loans[loanID_];
    delete loans[loanID_];          // destroys loan.unclaimed
    ...
    collateral().safeTransfer(loan.lender, loan.collateral);
    ...
}
```

`claimRepaid` is the only path that pays out `unclaimed`, but after `delete` the storage field is zero and the debt tokens sit idle in the Cooler contract with no claim path.

## Impact

Lender loses all partial repayments made before default. The tokens remain stuck in the Cooler clone.

## Preconditions

- Loan created with `repayDirect=false`.
- Borrower makes one or more partial repayments (funds go to `unclaimed`).
- Loan defaults (past expiry).
- Anyone calls `claimDefaulted`.

## Recommendation

Pay out `loan.unclaimed` to `loan.lender` inside `claimDefaulted` before deleting the loan, or forbid default-claim while `unclaimed > 0` until `claimRepaid` is called.
