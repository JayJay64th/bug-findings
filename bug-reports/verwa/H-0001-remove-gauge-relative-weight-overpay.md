# DRAFT — H-0001
status: DRAFT
poc: pending-human
evidence_class: STATIC_PROOF
exploitability_tier: NORMAL
contest_severity: Medium (proposed)

## 1. TITLE
Missing slope/changes_* cancellation in remove_gauge allows relative weight > 1e18 and claim overpay beyond epoch reward budget

## 2. SUMMARY
remove_gauge adjusts points_weight/points_sum biases only (GaugeController.sol:188-199) while points_sum slope retains the removed gauge's vote-slope until its recorded vote end. _gauge_relative_weight has no 1e18 clamp (sol:152-161). In any decay week after removing a voted gauge, remaining gauges' relative weight exceeds 1e18. LendingLedger.claim (sol:174) then pays more than rewardInformation[e].amount for those epochs, over-drawing the fixed pot so later claimers revert. Loss is borne by other lenders whose reward entitlements freeze when the pot exhausts.

## 3. ROOT CAUSE
_change_gauge_weight (sol:188-199) writes only bias at next_time; it never adjusts points_weight slope or changes_weight/changes_sum schedules. The vote path (sol:247-270) correctly maintains both. Parity gap: admin removal is an economic unwinding of a vote-weight contribution but skips the slope-side bookkeeping the vote path maintains.

## 4. PROTOCOL'S OWN DESIGN / INTENDED INVARIANT
_gauge_relative_weight comment: "Get Gauge relative weight (not more than 1.0)" (sol:146) — the protocol intends weight <= 1e18. I-004 states the sum-aggregate identity. The vote path's matched bias+slope writes (sol:252-262) establish the intended invariant; remove breaks it.

## 5. IMPACT
Overpay per epoch = (relative_weight/1e18 - 1) * userShare * ri.amount. Window = [remove_week, vote_end_week). Pot exhaustion freezes remaining claimers (require success at sol:180).

## 6. PRECONDITIONS / ATTACKER MODEL
Governance remove of a voted gauge with active votes (correct-parameter op — rebalancing). Any lender in remaining markets profits; no special role.

## 7. RECOMMENDATION
On remove/change, also cancel residual slope contributions: schedule changes_weight[g][next_time] -= current_slope and changes_sum similarly, or clamp relative weight at 1e18 in _gauge_relative_weight.

## 8. SEVERITY MODEL
class: fund_loss · recoverability: irreversible once claimed under inflated weight · rationale: overpay of matured rewards = loss of capital for pot/other claimers; privileged trigger priced Medium via C4 centralization clause (reasonable-assumption admin ops).
