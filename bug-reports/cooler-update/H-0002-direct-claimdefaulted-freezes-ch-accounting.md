# H-0002 — Direct `Cooler.claimDefaulted` on Clearinghouse-originated loans freezes gOHM in Clearinghouse and corrupts receivables/TRSRY debt

- **Finding ID:** H-0002
- **Severity:** High (accounting corruption + frozen collateral)
- **Class:** cross-contract accounting desync
- **Target:** Olympus Cooler (update) — `Cooler.sol` vs `Clearinghouse.sol`
- **Evidence class:** STATIC_PROOF
- **Status:** Confirmed (static proof; PoC pending)

## Summary

`Cooler.claimDefaulted` is permissionless (anyone can call it after expiry). When called directly on a loan **originated by the Clearinghouse** (lender = Clearinghouse), the collateral is transferred to `loan.lender` (the Clearinghouse address) but:

1. `Clearinghouse.receivables` is **not** decremented (that only happens in `Clearinghouse._onRepay` / `Clearinghouse.claimDefaulted`).
2. `TRSRY.reserveDebt` for the Clearinghouse is **not** adjusted.
3. The gOHM collateral lands on the Clearinghouse address with no bookkeeping entry tying it to a live loan — it is frozen (the CH has no path to recover gOHM sent outside its own `claimDefaulted` burn flow).

## Root cause

`Cooler.claimDefaulted` ( Cooler.sol:318) has no check that `msg.sender` is the loan's lender or the factory-originating Clearinghouse. Anyone can trigger it. The Clearinghouse's own `claimDefaulted` ( Clearinghouse.sol:191) is the **only** function that updates receivables + TRSRY debt + burns collateral — direct Cooler calls skip all of that.

## Impact

- `receivables` overstated (loan gone, receivable still counted).
- TRSRY debt overstated.
- gOHM collateral frozen at the Clearinghouse address (not burned, not tracked).

## Preconditions

- A Clearinghouse-originated loan exists and has passed expiry.
- Anyone calls `Cooler.claimDefaulted(loanID)` directly (not via `Clearinghouse.claimDefaulted`).

## Recommendation

Gate `Cooler.claimDefaulted` so only the loan's lender (or a factory-approved caller) can claim, **or** have the Cooler notify the originating Clearinghouse via callback so accounting stays in sync. Prefer both: lender-only claim + CH callback.
