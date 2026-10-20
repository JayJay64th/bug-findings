# H-0007 — `provideNewTermsForRoll` is front-runnable; lender can set hostile terms before borrower's `rollLoan`, inflating interest or forcing bad LTC

- **Finding ID:** H-0007
- **Severity:** Medium (economic griefing on roll)
- **Class:** front-running / terms manipulation
- **Target:** Olympus Cooler (update) — `Cooler.sol`
- **Evidence class:** STATIC_PROOF
- **Status:** Confirmed (static proof)

## Summary

`provideNewTermsForRoll` ( Cooler.sol:282-300) lets the lender overwrite `loan.request` with new interest, loan-to-collateral, and duration at any time before the borrower calls `rollLoan`. The borrower's `rollLoan` ( Cooler.sol:192) then consumes whatever terms are currently set:

```solidity
uint256 newCollateral = newCollateralFor(loanID_);
uint256 newDebt = interestFor(loan.amount, loan.request.interest, loan.request.duration);
loan.amount += newDebt;
loan.collateral += newCollateral;
loan.expiry += loan.request.duration;
```

There is no borrower-side confirmation of terms, no terms hash the borrower signed, and no window during which terms are locked. The lender can:

1. Set reasonable terms to get the borrower to prepare a roll.
2. In the same block (or later), overwrite with maximum interest / unfavorable LTC / long duration.
3. Let `rollLoan` execute against the hostile terms.

For Clearinghouse-originated loans, `provideNewTermsForRoll` is called by the CH itself ( Clearinghouse.sol:165) with fixed constants, so the griefing applies primarily to **direct Cooler-to Cooler** loans where the counterparty is an EOA or untrusted contract.

## Root cause

Terms are lender-set with no borrower acknowledgment binding. Standard pattern is: lender proposes → borrower accepts a specific terms hash, or terms are set once and immutable.

## Impact

Borrower rolls into inflated debt and/or unfavorable collateral ratio without consenting to the new terms. Economic loss equal to the interest/LTC delta.

## Preconditions

- Direct (non-CH) loan with an untrusted lender.
- Borrower intends to roll.
- Lender front-runs `rollLoan` with `provideNewTermsForRoll`.

## Recommendation

Require the borrower to pass expected terms (or a terms hash) to `rollLoan` and revert on mismatch. Or add a minimum delay + event between provide and roll so the borrower can rescind.
