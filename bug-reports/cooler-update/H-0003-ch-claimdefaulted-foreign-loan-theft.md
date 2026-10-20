# H-0003 — `Clearinghouse.claimDefaulted` can be invoked on any factory-created Cooler loan, stealing CH gOHM as keeper rewards and zeroing TRSRY debt / receivables

- **Finding ID:** H-0003
- **Severity:** High (theft of CH gOHM + accounting zeroing)
- **Class:** missing origin check on default claim
- **Target:** Olympus Cooler (update) — `Clearinghouse.sol`
- **Evidence class:** STATIC_PROOF
- **Status:** Confirmed (static proof; Foundry PoC artifact `H-0003/poc/H-0003.t.sol` written but not executed — forge unavailable)

## Summary

`Clearinghouse.claimDefaulted` ( Clearinghouse.sol:191) validates only that the Cooler was deployed by the trusted factory (`factory.created(coolers_[i])`, :201). It does **not** check that the loan was originated by **this** Clearinghouse (i.e. `loan.lender == address(this)`).

An attacker who creates their own Cooler + loan (zero or low collateral, large debt) and lets it default can pass that loan into `Clearinghouse.claimDefaulted`. The function then:

1. Calls `Cooler.claimDefaulted` on the foreign loan (collateral goes to CH as "lender" of record only if CH is lender — for a foreign loan the collateral goes to the **attacker's** address as real lender; but the CH still processes the debt/collateral amounts).
2. Pays **keeper rewards in gOHM from the Clearinghouse's own balance** to `msg.sender` ( Clearinghouse.sol:241) — up to `MAX_REWARD` per loan, capped at 5% of collateral.
3. Decrements `receivables` by the foreign loan's full debt ( Clearinghouse.sol:228) — potentially zeroing legitimate receivables.
4. Calls `TRSRY.setDebt` to reduce CH's DAI debt by `(totalDebt - totalInterest)` ( Clearinghouse.sol:232-238) — potentially zeroing legitimate TRSRY debt.

## Root cause

```solidity
// Clearinghouse.sol:200-201
// Validate that cooler was deployed by the trusted factory.
if (!factory.created(coolers_[i])) revert OnlyFromFactory();
// MISSING: if (Cooler(coolers_[i]).lender(loans_[i]) != address(this)) revert NotOurLoan();
```

Factory-created ≠ Clearinghouse-originated. Any user can `factory.generateCooler` and open a loan with themselves as lender.

## Impact

- Direct theft of CH gOHM (keeper rewards).
- Legitimate `receivables` and TRSRY DAI debt can be zeroed or reduced by attacker-controlled "debt" amounts.

## PoC (artifact, not executed)

See `H-0003/poc/H-0003.t.sol`. Steps:

1. Deploy `CoolerFactory`.
2. Attacker: `factory.generateCooler(X, Y)` → own Cooler.
3. `cooler.requestLoan(1e30, 0, type(uint256).max, 1 days)` — collateralFor == 0.
4. Attacker `clearRequest` as lender with Y.minted amount.
5. `vm.warp(+2 days)`.
6. `Clearinghouse.claimDefaulted([cooler],[loanID])`.
7. Assert `clearinghouse.receivables() == 0`.
8. Assert `TRSRY.reserveDebt(DAI, CH) == 0`.

## Recommendation

Before processing each loan, require the loan's `lender` to be `address(this)` (the Clearinghouse). Reject foreign loans.
