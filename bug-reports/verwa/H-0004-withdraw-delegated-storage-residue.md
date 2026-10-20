# H-0004 — `VotingEscrow.withdraw` leaves `delegated` residue in storage; next `createLock` builds phantom voting power on top of it

- **Finding ID:** H-0004
- **Severity:** Medium (proposed)
- **Class:** accounting / vote-power inflation (unprivileged)
- **Target:** Verwa — `VotingEscrow.sol`
- **Evidence class:** STATIC_PROOF
- **Status:** Confirmed (static proof; PoC pending human decision)

## Summary

`VotingEscrow.withdraw` writes updated lock state from `newLocked` into storage (sol:339) and then zeroes the `delegated` field **only on the memory copy** (sol:340) — the storage `delegated` value is never cleared. Storage keeps:

```
delegated = (amounts delegated TO this lock) − ownAmount
```

which is nonzero exactly when the user had received delegations. A subsequent `createLock` (sol:276-279) **adds** on top of that residue (`delegated += value`), so the new lock's ve slope becomes:

```
(residue + value) / LOCKTIME
```

This gives phantom voting power proportional to others' frozen delegated amounts, while the I-002 conservation invariant (`sum(delegated) == sum(locked)`) breaks.

## Root cause

Order-of-operations bug: storage write of `newLocked` happens before the delegated-zeroing, and the zeroing targets the wrong (memory) reference.

## Impact

- A user who withdraws after receiving delegations and then creates a new lock carries a stale `delegated` residue into the new lock.
- Vote weight / relative weight computed from the inflated slope is higher than the economic position warrants.
- Conservation invariant across all locks is broken.

## Preconditions

- User received delegations while their lock was active.
- User withdraws (lock ends or early exit path).
- User calls `createLock` again.

## Recommendation

Zero `delegated` in storage (not memory) as part of withdraw, before any subsequent createLock can read it. Audit all other writers of `delegated` for the same memory-vs-storage pattern.
