# BS-023 — Payable-entry differential and full-balance `refundEth` sweep enable stuck-ETH theft and freeze

- **Asset:** Beanstalk L2 diamond `0xD1A0060ba708BC4BCD3DA6C37EFa8deDF015FB70` (Arbitrum) — `TractorFacet.tractor`, `FarmFacet`, `LibEth.refundEth`, `TokenFacet.wrapEth`
- **Type:** theft + freeze of misattached native ETH (standing diamond balance currently 0)
- **Severity (suggested):** Medium — theft/freeze of ETH stranded on the diamond; no standing balance at measurement time, but the mechanism is live
- **Status:** Confirmed — full proof chain, live L2 `eth_call` + `stateOverride`, 7/7 cases match, no fork/deploy required

## Summary

Two payable entry paths diverge in how they handle `msg.value` when the inner call cannot receive ETH:

1. **Farm path** (`FarmFacet.farm`, ~:35/:51) always runs `LibEth.refundEth()` after the inner call, which sweeps **the diamond's entire ETH balance** to `_user()` (the active publisher / caller in plain context). If `_user()` is a contract that rejects ETH, the whole farm reverts — the value is not lost, but the path is bricked for that user.
2. **Tractor path** (`TractorFacet.tractor`, ~:106-111) swallows value: there is **no** `refundEth` after the inner call. ETH attached to `tractor()` stays on the diamond permanently (no event, no claim path).

Separately, `TokenFacet.wrapEth(0, INTERNAL)` (~:222-228) is an unguarded entry that, when the diamond holds a standing ETH balance, transfers that **entire balance** to `_user()` — a third-party sweep primitive against any ETH stranded by the tractor path or by raw transfers.

`LibEth.refundEth` (~:16-21) is a whole-balance sweep (`address(this).balance`), not a `msg.value` remainder return. Any ETH sitting on the diamond — from any source — is swept to the current `_user()` on the next farm/relay that hits the refund branch.

## Root cause

- `LibEth.refundEth` pays `address(this).balance` (entire standing balance) to `_user()`, not the unsolicited remainder of the current call.
- `tractor()` accepts `payable` value but never refunds it, creating a permanent strand sink.
- `wrapEth(0, INTERNAL)` skips the wrap and falls through to the same full-balance transfer when amount is 0.
- No native-ETH invariant tracks diamond ETH against expected transient values.

## Proof (live L2 eth_call + stateOverride, 7/7 cases)

Differential (farm vs tractor, same revert-code receiver):

- **C4** `farm([zero-move transferToken])` value=1e18 from revert-code sender → REVERT `Error(20) "Eth transfer Failed."` — refund at FarmFacet:35 paid to sender; receiver rejected.
- **C5** same with value=0 → OK. C4's revert is specifically the refund leg.
- **C6** `tractor(signed blueprint, inner transferToken-0)` value=1e18 + stateOverride code=revert at PUBLISHER → **OK** — no refund to `_user()`=publisher (a refund would have reverted). ETH stranded.
- **C7** tractor value=0 → OK (sig+hash verified on-chain: EIP-712 domain v1.0.0 / 42161 / diamond, self-signed ECDSA).

Theft leg (wrapEth full-balance sweep):

- **C2** `wrapEth(0, INTERNAL)` + diamond balance override=1e18 + revert-code receiver → REVERT `"Eth transfer Failed."` — proves override active AND refund pays `_user()` the **entire** balance.
- **C3** same override + plain receiver → OK — 1 ETH would transfer to caller.
- **C1** no-balance control → OK (skip branch).

## Impact

- Any ETH stranded on the diamond (tractor attachments, raw transfers, future integrations) is stealable by any caller of `wrapEth(0, INTERNAL)` or by any farm/relay that hits the refund branch with themselves as `_user()`.
- Farm path freezes ETH for revert-code publishers (griefing; their own attached value).
- Tractor path permanently strands value with no on-chain recovery short of the sweep theft.

## Prior art / dedupe

Corpus grep (19 audit PDFs + prior-reports + BIP md): nearest prior = Cyfrin 09-12-23 [H-1]/[H-2] High/Open — `refundEth` whole-balance sweep drain **via in-flight reentrancy** during Depot/Pipeline/Farm handoff. Their mitigation ("add reentrancy guards") is still absent in current code (zero `nonReentrant` in DepotFacet/Pipeline.sol; farm has `nonReentrantFarm` only). Cyfrin did **not** cover: `tractor()` swallow entry (post-Cyfrin), `wrapEth(0)` third-party standing-balance sweep, native-ETH invariant blindness, `pipe`/`multiPipe` sinks (BS-023-A), declared-value vs `msg.value` at rest (BS-023-B, closed as dup of Cyfrin H-1).

## Remediation

- `refundEth` should return only the current call's unsolicited remainder, not `address(this).balance`.
- `tractor()` should refund attached value (or reject non-zero `msg.value`).
- `wrapEth(0, …)` must not transfer standing balance.
- Track expected transient ETH (invariant) or disallow bare-ETH holds on the diamond.
