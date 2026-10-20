# DRAFT — H-0003 (scope_ambiguous — human decides)
status: DRAFT
poc: pending-human
evidence_class: STATIC_PROOF
exploitability_tier: PLAUSIBLE
contest_severity: Medium (proposed if in-scope vs user-skip fence)

## 1. TITLE
Documented default claim(0,max) permanently forfeits zero-weight epochs with no warning — distinct from user-skipped forfeit fence

## 2. SUMMARY
claim advances userClaimedEpoch unconditionally (sol:176) after a loop whose per-epoch payout can be 0 (gauge relative weight 0: market not yet gauge, no votes, or removed). add_gauge does not backfill historical weights. Users following the documented claim(market,0,max) pattern forfeit those epochs' allocations irreversibly.

## 3. ROOT CAUSE
Unconditional advance + no backfill + no weight precheck in claim.

## 4. PROTOCOL'S OWN DESIGN / INTENDED INVARIANT
Docstring admits skip-parameter forfeit (sol:148-151) as user choice; does NOT document that default path also forfeits zero-weight epochs automatically.

## 5. IMPACT
Irreversible loss of matured reward allocations.

## 6. PRECONDITIONS
Market zero-weight during funded epochs; user follows docs without inspecting gauge_relative_weight first.

## 7. SCOPE NOTE (Pass B)
Known issue fences: "Users can forfeit the rewards for some epochs by skipping them when calling claim" — PARAMETER-based skip. This finding is automatic forfeit on the documented DEFAULT (no skip parameter used). Borderline; surface to human with both clauses quoted.

## 8. SEVERITY MODEL
class: fund_loss · recoverability: irreversible · rationale: loss of matured yield = loss of capital if in-scope.
