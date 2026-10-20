# H-0002 — `LendingLedger.claim` divides by zero after a zero-balance epoch; documented default call permanently reverts

- **Finding ID:** H-0002
- **Severity:** Medium (proposed)
- **Class:** fund-loss / liveness (unprivileged)
- **Target:** Verwa — `LendingLedger.sol`
- **Evidence class:** STATIC_PROOF
- **Status:** Confirmed (static proof; PoC pending human decision)

## Summary

`LendingLedger.claim` divides by `(1e18 * marketBalance)` with no zero guard (sol:174). After any epoch in which a market's total balance is 0 (all lenders fully withdrew), the documented default call `claim(market, 0, max)` permanently reverts with panic `0x12` for every later claim whose range spans that empty epoch. Claims only succeed with manually segmented `_claimFromTimestamp` / `_claimUpToTimestamp` ranges.

## Root cause

The claim loop divides by market balance for each epoch in range. A funded epoch with zero lenders produces a zero denominator. There is no `if (marketBalance == 0) continue;` (or equivalent) short-circuit.

## Impact

- Users following the documented `claim(market, 0, max)` pattern cannot claim any rewards once any historical epoch in their range had zero market balance.
- Matured reward allocations for those epochs are effectively stranded until the user manually segments ranges (undocumented workaround).
- Unprivileged: any lender (or claimer) hits this after a full-withdrawal epoch.

## Preconditions

- A market reaches total balance 0 for at least one full epoch (all lenders withdrawn).
- A later claim spans that epoch.

## Recommendation

Skip zero-balance epochs in the claim loop (do not divide by zero; treat that epoch's share as 0 and continue), or pre-check `marketBalance > 0` before dividing.
