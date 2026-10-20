# DRAFT — H-0010
status: DRAFT
poc: pending-human
evidence_class: STATIC_PROOF
exploitability_tier: NORMAL
contest_severity: High (proposed)

## 1. TITLE
Vote snapshot taken once at vote time allows vote-then-delegate to double-count the same ve power across two users in gauge weights

## 2. SUMMARY
vote_for_gauge_weights snapshots the voter's ve slope once (sol:220-236) and schedules it until lock_end (sol:269-270). VE.delegate moves the underlying delegated CANTO to another lock and re-checkpoints VE only — zero GC references. Sequence: A locks, votes G with slope s, delegates to B (B.end>=A.end): A's ve slope -> 0, B's slope += s from the delegated field (sol:133-135). B votes the same (or another) gauge with slope covering the SAME principal. points_weight/points_sum carry 2x economic power from 1x locked CANTO until A's recorded end. Per-user budget power_used (sol:239-242) cannot see cross-user duplication. Colluding gauge weight inflates toward 1e18 (no clamp), starving other gauges of every epoch's rewardInformation.amount — irreversible misallocation of matured rewards.

## 3. ROOT CAUSE
No live recheck of ve power after vote; no GC hook on delegation. The economic operation "vote with ve power" is bound to a one-time snapshot while the underlying power remains mutable via delegation.

## 4. PROTOCOL'S OWN DESIGN / INTENDED INVARIANT
I-005 vote power cap and economic-power uniqueness; vote path assumes snapshot == live power until lock_end (implicit in schedule-until-end design sol:269-270).

## 5. IMPACT
Directional weight inflation; other markets under-claim relative to fair share; claimed under wrong weights is irreversible.

## 6. PRECONDITIONS / ATTACKER MODEL
Fully unprivileged; second unexpired locker B with end>=A.end (common); no governance action; cost low.

## 7. RECOMMENDATION
Re-read live ve slope at vote time is insufficient alone — need either: (a) GC callback/hook on VE.delegate to adjust outstanding vote slopes, or (b) derive vote weight from live balanceOf at claim/weight_write time rather than frozen schedule, or (c) forbid delegation of voting power after vote (lock vote to delegation state).

## 8. SEVERITY MODEL
class: accounting_corruption · recoverability: irreversible weight misallocation for affected epochs · rationale: unprivileged direct distortion of reward allocation = loss of matured yield for starved gauges lenders (High per loss-of-capital; floor Medium if judges weigh practical scale).
