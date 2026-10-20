# H-0009 — `interestFromDebt(debt)` mis-splits principal vs interest for `TRSRY.setDebt` when loans were rolled (debt includes compounded interest)

- **Finding ID:** H-0009
- **Severity:** Medium (TRSRY debt accounting drift)
- **Class:** arithmetic / accounting on default claim
- **Target:** Olympus Cooler (update) — `Clearinghouse.sol`
- **Evidence class:** STATIC_PROOF
- **Status:** Confirmed (static proof)

## Summary

On default, `Clearinghouse.claimDefaulted` computes interest as a fixed percentage of the **full returned debt**:

```solidity
// Clearinghouse.sol:205
uint256 interest = interestFromDebt(debt);

// Clearinghouse.sol:395-398
function interestFromDebt(uint256 debt_) public pure returns (uint256) {
    uint256 interestPercent = (INTEREST_RATE * DURATION) / 365 days;
    return debt_ * interestPercent / 1e18;
}
```

But when a loan has been **rolled**, `Cooler` stores the compounded amount:

```solidity
// Cooler.sol:203 (rollLoan)
loan.amount += newDebt;  // newDebt = interestFor(original_amount, ...)
```

so the `debt` returned by `Cooler.claimDefaulted` ( Cooler.sol:332, `loan.amount`) already includes prior interest. Applying `interestFromDebt` to the compounded total **over-estimates** the interest component and **under-estimates** the principal component that should reduce TRSRY debt:

```solidity
// Clearinghouse.sol:232-238
TRSRY.setDebt({
    debtor_: address(this),
    token_: dai,
    amount_: (outstandingDebt > (totalDebt - totalInterest))
        ? outstandingDebt - (totalDebt - totalInterest)
        : 0
});
```

`totalDebt - totalInterest` is treated as "principal to forgive," but with rolled loans it is too small (interest was double-counted in the split). TRSRY debt is reduced by less than it should be — or, with multiple rolls and high interest, the split can drift enough to leave residual debt that no live loan backs.

## Root cause

`interestFromDebt` assumes debt = principal * (1 + single-period interest%). That identity only holds for unrolled loans. Rolled loans have debt = principal * Π(1 + interest_i), which is not linear in the same way.

## Impact

TRSRY debt accounting drift on defaulted rolled loans. Direction: residual TRSRY debt (over-stated debt) after defaults of rolled loans, or incorrect interest recognition.

## Preconditions

- Loan is rolled at least once (debt includes compounded interest).
- Loan defaults.
- `Clearinghouse.claimDefaulted` runs and calls `TRSRY.setDebt` with the mis-split.

## Recommendation

Track principal and accrued interest separately in the `Loan` struct (or recompute interest from `loan.request` history) so `claimDefaulted` can pass the true principal reduction to `TRSRY.setDebt`. Do not apply `interestFromDebt` to a compounded total.
