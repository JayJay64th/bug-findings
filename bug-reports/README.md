# Bug Reports & Writeups

Solidity findings from security research, sorted by project. Each folder contains one `report.md` per finding (plus PoC artifacts where available).

## Projects

### Beanstalk (Arbitrum L2 diamond)

| ID | Title | Severity | Status |
|---|---|---|---|
| [BS-018](beanstalk/BS-018-unripe-convert-dilution.md) | Unripe Convert (direction A) mints urBEAN claims above pool-fair | High | Confirmed, live path open |
| [BS-023](beanstalk/BS-023-stuck-eth-theft.md) | Payable-entry differential + full-balance `refundEth` sweep = stuck-ETH theft | Medium | Confirmed |
| [BS-030](beanstalk/BS-030-same-block-ema-frozen-bdv.md) | Same-block swap+convert: frozen EMA vs live LP mint → illegitimate Stalk | High | Confirmed |
| [BS-031](beanstalk/BS-031-convert-capacity-double-count.md) | Convert capacity double-count | High (mechanism) | **DO NOT REPORT** — DoS-class, no attacker gain; kept for reference |

### Nado (perp DEX core)

| ID | Title | Severity | Status |
|---|---|---|---|
| [N-006b](nado/N-006b-mint-burn-nlp-unsigned-price.md) | MintNlp/BurnNlp EIP-712 digests omit oracle price / rebalance | High | Confirmed |
| [N-007](nado/N-007-fast-withdrawal-nonce-void.md) | Fast withdrawal credits user, never debits; nonce void → double payout | High | Confirmed (PoC green) |
| [N-008](nado/N-008-verifier-fail-open-zero-signers.md) | `requireValidTxSignatures` fail-open at `nSigner==0` | High | Confirmed |
| [N-012](nado/N-012-withdraw-collateral-v2-unsigned-fee.md) | WithdrawCollateralV2 `feeX18` unsigned; user sets fee=0 | Medium | Confirmed |

### Surge (lending pool)

| ID | Title | Severity | Status |
|---|---|---|---|
| [F-01](surge/F-01-fee-recipient-zero.md) | Operator can set `feeRecipient` to `address(0)`, locking fee shares | Medium–High | Confirmed (PoC green) |

### Verwa (Canto — GaugeController / LendingLedger / VotingEscrow)

| ID | Title | Severity | Status |
|---|---|---|---|
| [H-0001](verwa/H-0001-remove-gauge-relative-weight-overpay.md) | remove_gauge leaves slope; relative weight > 1e18; claim overpay | Medium | Confirmed (static) |
| [H-0002](verwa/H-0002-zero-balance-claim-div-zero.md) | claim divides by zero after zero-balance epoch; default call reverts | Medium | Confirmed (static) |
| [H-0003](verwa/H-0003-zero-balance-epoch-forfeit.md) | Default claim(0,max) forfeits zero-weight epochs with no warning | Medium | Confirmed (static) |
| [H-0004](verwa/H-0004-withdraw-delegated-storage-residue.md) | withdraw leaves `delegated` residue; next createLock → phantom vote power | Medium | Confirmed (static) |
| [H-0005](verwa/H-0005-expired-delegated-lock-frozen.md) | Expired lock delegated away can never recover; delegatee keeps power | High | Confirmed (static) |
| [H-0006](verwa/H-0006-governance-no-transfer.md) | Governance keys have no transfer/rotation | Low / QA | Confirmed (static) |
| [H-0010](verwa/H-0010-delegate-vote-power-duplication.md) | Vote-then-delegate duplicates ve power across locks | High | Confirmed (static) |
| [H-0011](verwa/H-0011-expired-principal-vote-resurrection.md) | Expired principal re-delegated to fresh lock = perpetual vote power | High | Confirmed (static) |

### Cooler / Clearinghouse (Olympus update)

| ID | Title | Severity | Status |
|---|---|---|---|
| [H-0001](cooler-update/H-0001-claimdefaulted-destroys-unclaimed.md) | claimDefaulted destroys `loan.unclaimed` (partial repayments lost) | Medium–High | Confirmed (static) |
| [H-0002](cooler-update/H-0002-direct-claimdefaulted-freezes-ch-accounting.md) | Direct claimDefaulted on CH loans freezes gOHM, corrupts receivables/TRSRY | High | Confirmed (static) |
| [H-0003](cooler-update/H-0003-ch-claimdefaulted-foreign-loan-theft.md) | CH.claimDefaulted on foreign loans steals gOHM, zeroes TRSRY debt | High | Confirmed (static + PoC artifact) |
| [H-0004](cooler-update/H-0004-malicious-callback-forces-default.md) | Malicious `onRepay` reverts block repay → forced default + seize | High | Confirmed (static) |
| [H-0005](cooler-update/H-0005-emergencyshutdown-role-brick.md) | emergencyShutdown reverts unless caller also holds cooler_overseer | Low / QA | Confirmed (static) |
| [H-0006](cooler-update/H-0006-transferownership-callback-not-cleared.md) | transferOwnership leaves `callback=true` → new lender bricks loan | Medium | Confirmed (static) |
| [H-0007](cooler-update/H-0007-providenewterms-frontend-hostile-roll.md) | provideNewTermsForRoll front-runnable → hostile roll terms | Medium | Confirmed (static) |
| [H-0009](cooler-update/H-0009-interestfromdebt-mis-split-rolled-loans.md) | interestFromDebt mis-splits principal/interest on rolled loans | Medium | Confirmed (static) |

### Firelight (Vault / CoverOrderAllocator) — NOT SUBMITTABLE

Hunt ran Oct 15 2026, after the Sep 30 2026 contest results published. Independent hypothesis work (H-0018, H-0019, H-0020/H-0014) matched the two largest paid High clusters and the Medium share-price-collapse cluster in the contest report ([full list](https://reports.immunefi.com/firelight-sep.2026-or-audit-competition)). Already found and paid — logged here only as a learning artifact / independent-confirmation record, not as reportable findings.

| Hypothesis (from hunt ledger) | Matches contest cluster | Paid severity | Verdict |
|---|---|---|---|
| H-0018 — boundary-checkpoint overwrite of payout exposure cap | ~50+ Highs (period-boundary withdrawal rewrites exposure checkpoint / mutates committed collateral) | High | Already found |
| H-0019 — sticky `isWithdrawClaimed` on open bucket | ~45+ Highs (`rescueWithdrawFromBlocklisted` poisons (period, account) flag / tombstone) | High | Already found |
| H-0020 / H-0014 — post-payout share-price collapse, dust deposit captures vault | ~12 Mediums (payout() drives totalAssets()~0, 1-wei deposit captures ~99% future yield) | Medium | Already found |
| H-0004 — commit snapshots capacity, settle uses stored value | ~15 Highs (stale period-start capacity snapshot / COA reuses collateral backing previous-period claims) | High | Already found |

No files added under `firelight/` — nothing here is original relative to the public contest results.

## PoC artifacts

- `nado/poc/N-007-F1-NonceVoid.js` — Hardhat test, green (`1 passing`)
- `surge/poc/SurgeProbes.t.sol` — Foundry probes, all pass
- `cooler-update/poc/H-0003.t.sol` — Foundry artifact (not executed; forge unavailable in analysis environment)

## Notes on evidence class

- **Confirmed (PoC green / on-chain):** runtime proof executed (test or live eth_call).
- **Confirmed (static):** full static proof with file:line; runtime PoC either not required for the mechanism or pending.
- **DO NOT REPORT:** mechanism proven but judged non-reportable under impact-bar rules (see BS-031 note).

---

*Research output — not affiliated with the audited protocols. For educational / portfolio use. Verify all claims against current deployments before relying on them.*
