# H-0004 — Malicious lender with `callback=true` can revert `onRepay` to block all repayments and force loan default, seizing collateral

- **Finding ID:** H-0004
- **Severity:** High (forced default + collateral seizure)
- **Class:** callback griefing → forced default
- **Target:** Olympus Cooler (update) — `Cooler.sol`, `CoolerCallback.sol`
- **Evidence class:** STATIC_PROOF
- **Status:** Confirmed (static proof; repo already ships `MockMaliciousLender` in test mocks)

## Summary

When a loan is created with `callback=true` ( `clearRequest(..., isCallback_=true)`, Cooler.sol:233-264), every `repayLoan` ends with:

```solidity
// Cooler.sol:185
if (loan.callback) CoolerCallback(loan.lender).onRepay(loanID_, repaid_);
```

A malicious lender implements `onRepay` to **always revert**. Every repayment attempt by the borrower reverts. After expiry, the lender calls `claimDefaulted` and seizes the full collateral — even though the borrower was willing and able to repay.

The same pattern applies to `onRoll` ( Cooler.sol:216) and `onDefault` ( Cooler.sol:331), but the repay block is the fund-loss path.

## Root cause

Callback is invoked **after** the state update and token transfers in the same transaction with no try/catch or gas-stipend isolation. A revert in the callback reverts the entire `repayLoan`.

Note: the natspec at Cooler.sol:145-147 claims "a malicious lender could reenter with the callback, the usage of `msg.sender` prevents any economical benefit" — that addresses **reentrancy**, not **griefing via revert**. The repo's own `MockMaliciousLender` (test/mocks/MockMaliciousLender.sol) demonstrates the revert pattern.

## Impact

Borrower cannot repay. Loan defaults. Lender seizes 100% of collateral. Borrower loses collateral despite having funds to repay.

## Preconditions

- Lender sets `isCallback_=true` and implements a reverting `onRepay`.
- Borrower accepts the loan (or cannot verify callback behavior beforehand).
- Borrower attempts repay after terms are set.

## Recommendation

Wrap callback calls in try/catch (or a low-level call that ignores failure) so a malicious lender cannot block repayment. Alternatively, forbid `callback=true` for non-protocol lenders, or let the borrower opt out of the callback after inspecting the lender contract.
