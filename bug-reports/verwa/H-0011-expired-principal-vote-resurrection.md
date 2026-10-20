# DRAFT — H-0011
status: DRAFT
poc: pending-human
evidence_class: STATIC_PROOF
exploitability_tier: NORMAL
contest_severity: High (proposed)

## 1. TITLE
delegate() never checks owner lock end — expired delegated principal can hop to fresh wallets for perpetual ve voting power

## 2. SUMMARY
delegate() (sol:356-387) validates only toLocked (amount>0, end>now, end>=from.end). An owner whose lock expired while delegated away cannot recover (H-0005) but CAN re-delegate the principal to any fresh wallet C (C.end = floor(now+5y) always >= old end). _delegate restores C's slope from the delegated field (sol:133-135, no owner-end gate) and relocates the decay schedule from the old holder's end (sol:249) to C.end (sol:254). Expired principal becomes live voting power again; hopping before each holder end yields perpetual ve power from a lock that should have decayed to zero. Combined with vote snapshots this is unprivileged gauge-weight inflation.

## 3. ROOT CAUSE
Missing owner-unexpired check in delegate/_delegate; slope derived from delegated field gated only on the HOLDING lock's end.

## 4. PROTOCOL'S OWN DESIGN / INTENDED INVARIANT
I-003 ve decay bookkeeping — power should bound by lock end. createLock/increaseAmount/withdraw all gate on own end; delegate is the parity gap (Law 13 twin of those entry points).

## 5. IMPACT
Perpetual ve power; gauge weight inflation; distorts all downstream claim multipliers.

## 6. PRECONDITIONS / ATTACKER MODEL
Unprivileged; owner-expiry precondition (negligience or after H-0005); attacker completes hop.

## 7. RECOMMENDATION
Require fromLocked.end > block.timestamp in delegate() (and _delegate), matching the toLocked check at sol:383.

## 8. SEVERITY MODEL
class: accounting_corruption · recoverability: power misallocation irreversible for claimed epochs · rationale: unprivileged power resurrection past lock end; High/Medium per loss-of-capital framing.
