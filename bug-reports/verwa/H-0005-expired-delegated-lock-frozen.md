# DRAFT — H-0005
status: DRAFT
poc: pending-human
evidence_class: STATIC_PROOF
exploitability_tier: PLAUSIBLE
contest_severity: Medium (proposed; scope_ambiguous vs careless-user clause)

## 1. TITLE
Lock expiry while delegated permanently freezes principal — no recovery path returns the lock to the owner

## 2. SUMMARY
An owner who lets their lock expire while delegated away can never recover: withdraw requires delegatee==self (sol:331), undelegate-to-self requires own end>now (sol:383), increaseAmount requires end>now (sol:294), createLock requires amount==0 (sol:274). Re-delegate to a third party is allowed (from end unchecked) but cannot return to self. Principal is permanently frozen; delegatee keeps voting power from the expired owner's amount and can extend it via increaseAmount (sol:301).

## 3. ROOT CAUSE
Recovery paths all gate on the owner's own expired end or self-delegation; no path restores delegatee==self after expiry.

## 4. PROTOCOL'S OWN DESIGN / INTENDED INVARIANT
I-001 withdrawal-guarantee clause; withdraw/increase/create all treat expiry as unlocking owner control — delegation breaks that.

## 5. IMPACT
Permanent freeze of locked CANTO principal; parallel power persistence.

## 6. PRECONDITIONS / ATTACKER MODEL
Owner negligence (no undelegate before expiry); no warning mechanism; delegatee cannot push back.

## 7. RECOMMENDATION
Allow undelegate-to-self (or withdraw) when own lock is expired regardless of current delegatee; or force undelegate on expiry in _checkpoint.

## 8. SEVERITY MODEL
class: freeze · recoverability: irreversible · rationale: principal freeze; scope_ambiguous vs careless-user clause — human decides submission.
