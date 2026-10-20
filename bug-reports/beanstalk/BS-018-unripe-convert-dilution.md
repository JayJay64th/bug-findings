# BS-018 — Unripe Convert (direction A) mints urBEAN claims above pool-fair (k = 1.15–1.76×), permanently reducing backing available to remaining unripe-BEAN claimants

## Title / Asset / Type

- **Title**: Directional tilt in `LibUnripeConvert.convertLPToBeans` mints urBEAN claims `pctB/pctL×` (1.15–1.76× observed) larger than the backing added; the excess claim count is redeemable via chop/ripen against shared reserves, permanently reducing backing available to all remaining (pre-existing and future) urBEAN claimants relative to the no-convert counterfactual.
- **Asset**: Beanstalk L2 diamond `0xD1A0060ba708BC4BCD3DA6C37EFa8deDF015FB70` (Arbitrum) — `LibUnripeConvert.sol`, `UnripeFacet` (convert/chop), `LibUnripe`.
- **Type**: Smart contract — value transfer / illegitimate mint of unripe claims (historically realized: 2,243,862 BEAN of backing permanently moved out of the standing urBEAN claimant pool over 139 events; live path still open).

## Steps (numbered, copy-pasteable, ≤3)

1. **Live state — the tilt is on-chain and open.** `eth_call` on `0xD1A0…FB70`: `percentBeansRecapped()` → `431609`, `percentLPRecapped()` → `245295` → k = pctB/pctL = **1.759551**; `getMaxAmountIn(urLP, urBEAN)` → `25297007430083` (49.2% of urLP supply; well-quotable ≤ 4e12 single-sided). Every A-convert today mints ~1.76× the pool-fair claim count.
2. **One historical convert, fully priced.** tx `0x4d6865afa3ad39bd055ab87d9ed26337254533935a007612f59b6ccc90f0bc66` (Arb block 456457970, 2026-04-26): pool leg q = 165,031.9 BEAN received; state replay at blk−1 gives fair = S_b·q/U_b = **165,031.9** claims; actual minted `ta` = **286,778.9** → actual/fair = **1.7377**; excess = 51,522 BEAN. Recipient later **chopped the full 286,778.9 BEAN**. (9 more full tx hashes in PoC below.)
3. **Full attribution.** Run `probe_attrib.py` (attached): eth_getLogs over the diamond → 139 A-events → per-event state reverse-replay from head (no archive node needed) → identity check + totals. Raw output included below.

## PoC (test file / tx / state query + raw output)

**A. Execute == model on-chain** (state read at the historical block): class-A Convert blk 498086630, in=99999999, out=243741220; fair=138734173, model=243736968, deployed `getAmountOut` view=24347800 → `out/model = 1.0000`, `out/fair = 1.7569`, view/execute ≈ 0.0999 (secondary view-divergence issue, not claimed here).

**B. Historical trail (10 of 139 events, `random.seed(20260929)`, latest→earliest)** — every event actual/fair > 1; none below fair:

| block | tx | date | urLP in | actual urBEAN out | fair | k=actual/fair | excess (BEAN) | fate |
|---|---|---|---|---|---|---|---|---|
| 456457970 | `0x4d6865af…0bc66` | 2026-04-26 | 118,928.7 | 286,778.9 | 165,031.9 | 1.7377 | 51,522 | chopped full 286,778.9 |
| 406988641 | `0x2a3b360a…de84cce` | 2025-12-04 | 2,000.0 | 4,690.4 | 2,825.2 | 1.6602 | 752 | ripened 880,877 BEAN total |
| 368464634 | `0x34833642…a516bb93` | 2025-08-14 | 5,283.1 | 12,330.0 | 7,439.2 | 1.6575 | 1,968 | ripened exact |
| 355821149 | `0x324b5aff…0df1ade2` | 2025-07-09 | 85,610.3 | 198,072.6 | 120,721.7 | 1.6407 | 30,753 | ripened exact |
| 311590749 | `0x44c71a11…b779c8` | 2025-03-02 | 73,951.2 | 166,803.1 | 102,817.8 | 1.6223 | 25,020 | ripened exact |
| 298963292 | `0x9d100a26…56f008fb` | 2025-01-25 | 13,773.9 | 30,461.6 | 19,213.3 | 1.5854 | 4,293 | ripened 33,602.6 |
| 281391045 | `0xefbc2399…7db9981a` | 2024-12-04 | 28,861.3 | 60,514.6 | 42,064.4 | 1.4386 | 6,386 | ripened exact |
| 279050050 | `0xe1e36fe5…a4e2333` | 2024-11-28 | 3,712.7 | 7,603.0 | 5,843.1 | 1.3012 | 548 | ripened exact |
| 274062006 | `0x920f15e0…3e297ed` | 2024-11-13 | 75,110.7 | 144,189.5 | 120,564.1 | 1.1960 | 6,738 | chopped full |
| 267110729 | `0x7e098aa8…63a972b5` | 2024-10-24 | 25,000.0 | 46,741.6 | 39,994.8 | 1.1687 | 1,878 | 20 chops, 467,550 BEAN |

All 139 events: actual/fair ∈ [1.1542, 1.7586], avg 1.4026, **zero below fair**; ratio grows monotonically with recap progress (1.17 → 1.74 over 18 months = the drifting denominator, not randomness). 10/10 sampled recipients later realized the output (chop or ripen, mostly exact-full-output). Only 1/10 received urLP externally — 9/10 originated from internal balances: this is ordinary protocol usage, not an attacker setup.

**B2. Reproducible worked example (full integers, one event)** — tx `0x7e098aa8f37b5e5f4bfb60ca8c4a7bc4fadb6972ea67345cb4976a4763a972b5`, Arb block 267110729 (2024-10-24):

```
q  = 11,130,642,422 wei         receipt: BEAN Transfer WELL 0xbea00bbe… → diamond 0xD1A0060b…
ta = 46,741,622,265 units        Convert event toAmount (fromAmount = 24,999,999,999 urLP units)
S_b @267110728 = 94,883,611,328,862     U_b @267110728 = 26,406,330,044,902
fair = S_b·q//U_b   = 39,994,787,144     k = ta/fair        = 1.168693
excess = ta·U_b//S_b − q = 1,877,659,929 (1,877.66 BEAN)
loss   = U_b − S_b·(U_b+q)//(S_b+ta)     = 1,876,735,411    (1,876.74 BEAN)
closed form = excess·S_b//(S_b+ta)       = 1,876,735,410    |err| = 1 wei
```

How to reproduce, both with and without an archive node:

- **Archive node**: `eth_call` at block 267110728 — `totalSupply()` on `0x1bea054d…7543` must return `94,883,611,328,862`; `getTotalUnderlying(0x1bea054d…7543)` on the diamond must return `26,406,330,044,902`. Receipt decode gives `q`/`ta` as above. Plug into the four lines of arithmetic — all integer floor-division, no floats.
- **No archive (public RPC)**: `probe_worked_example.py` reverse-replays: `state(N) = state(head) − deltas in blocks > N`, over (a) `Transfer` events minted/burned from/to `0x00…00` on `0x1bea054d…7543` (supply) and (b) `ChangeUnderlying(address,int256)` from the diamond with topic1 = `0x1bea054d…7543` (underlying; note: queried against the **diamond** address — querying it against the token address returns empty and silently yields `U_b = U_b(head)`). Head values via `totalSupply()`/`getTotalUnderlying()` at `latest`.
- Two independent implementations (`probe_attrib.py`, `probe_worked_example.py`) produce the integers above exactly (1-wei difference only between the two *evaluation orders* of the identity); the earlier `probe_tx10_v3.py` run agrees at its displayed precision (fair 39,994.8, k 1.1687, excess 1,878 — the same event as §C's seeded sample row).

**C. Source-of-value attribution (exact identity, verified per-event)** — at each convert the backing added is exactly `q` (LibUnripeConvert:48) while claims minted are `ta = fair×k` (:44-47), therefore:

```
loss_to_pre-existing = U_b − S_b·(U_b+q)/(S_b+ta) = excess · S_b/(S_b+ta)
```

Both sides are the same real quantity; they differ only in evaluation order under integer floor division (`U_b − ⌊S_b(U_b+q)/(S_b+ta)⌋` vs `⌊(⌊ta·U_b/S_b⌋ − q)·S_b/(S_b+ta)⌋`), so the per-event check differs by ≤2 wei (observed max **2 wei** over all 139 events; 1 wei in the worked example above). All totals are exact integer sums — no floating point anywhere in the aggregate.

`probe_attrib.py` raw output:

```
A events: 139
unique txs: 139  txs with >1 A-event: 0
ATTRIBUTION over 139 single-A-event txs (of 139):
  total excess (pre-rate claim value)  = 2271519900564 wei-BEAN = 2271520 BEAN
  total loss to pre-existing holders   = 2243861759612 wei-BEAN = 2243862 BEAN
  max |closed-form - state-form| err  = 2 wei (rounding only)
per-event identity (sample 10): ratio loss/excess = 0.9956 … 0.9999
```

Every other claim-mint path is neutral or beneficial to holders: FERT mint adds backing == claims minted (`LibFertilizer:123-126/163`); chop burns more claim-value than backing removed (penalty → remaining holders gain); B-convert's `amountIn` side is unmultiplied (`LibUnripeConvert:74`); `restoreProtected` shuffles within fixed total. **A-convert is the unique dilutive writer on urBEAN.**

**D. Spec-vs-code gap (intent bridge — full battery)**:

- **What the spec mandates** (whitepaper §14.4.4/§14.4.5, PDF pp. 43–44): the convert in both directions is scaled by the premium factor `7.7×10⁷·Z^Θ/(S·Z^Φ) = 𝔉/𝔖`, which must be ≥ 1 and converge **to 1× at completion**. `S` is the **static** sold-supply (monotonically non-increasing — `pop()` decrements, `S ≥ A`); the spec has no dynamic denominator.
- **What the code does**: `LibUnripe.percentBeansRecapped()` (`LibUnripe.sol:32–38`) = `U_b×10⁶/S_b` — the *live* per-unit backing (431,609 head) — and `percentLPRecapped()` (`:43–49`) = `unripeLPPerDollar × recapitalized / totalSupply(urLp)` (245,295 head); their ratio multiplies the mint (`LibUnripeConvert:46-47`). `recapitalized` scales with every `add/removeUnderlying` (`LibUnripe` bookkeeping, `LibChop:35`, A-convert `:41`) while the spec's `S` never grows.
- **H1 (denominator identity) solved**: spec and code denominators are dimensionally identical iff `Z^Φ = 145,113,584`, exactly `unripeLPPerDollar(1,884,592) × $77M` pool balance — so the divergence is *not* a notation mismatch.
- **Measured slot gap**: numerator slot uses dynamic `recapitalized/1e6 = 6,692,301` where the spec places static `S ≥ A = 17,216,958` → `X_code = 0.2453` vs `X_spec ≥ 0.631` = **2.573×** divergence at one observed state.
- **Chop cross-check** (independent, same-file): spec chop rate `X_spec = 0.631` vs code `X = 0.2453` — penalty 398,200 vs 60,169 BEAN ⇒ historical choppers received **6.6×** more than the spec's chop penalty.
- **Residual / charitable reading**: reading §14.4.5's convert factor literally, the spec convert itself would return 0.684× pool value (a LOSS vs today's code, which returns +76%); taking the charitable netting, spec 1.5846× vs code 1.7596× = **+11%**. The gross-slot deviation is 2.573× under both readings.
- **Origin**: multiplier introduced in commit `d999ce39da`/BIP-21 deliberately (multiplier and recap bookkeeping same commit, tested); BIP-21 delegates the formula to the whitepaper appendix — the **premium's existence** is documented intent, its **amplitude and drift** are not. The observed k-drift 1.17→1.74 is exactly the dynamic-denominator behavior the static spec forbids (audit trail: `hunt/findings-ledger.md` BS-018 row).

Fork-based PoC (single-tx convert+chop against local fork): **not yet run** — Law 10 gate, will run on approval.

**E. Victim model / sequencing rebuttal** (`probe_ratchet.py`, full event replay 394 urBEAN + 171 urLP deltas, first A-event blk 264813594 → head):

1. **Input side is exactly neutral** — urLP per-unit backing unchanged at every A-convert (max deviation 1.94e-14 = float noise). Non-converting **urLP holders lose nothing** from anyone's convert; the entire burden falls on **urBEAN holders** (Silo unripe-BEAN depositors, ripeners, B-converters). Self-insurance requires already holding urLP.
2. **No clawback mechanism exists** — 0 unpaired supply/backing deltas; **0** non-A events ever lower urBEAN per-unit: 139/139 lowers are A-converts; 255 P-up events (chop penalties, FERT inflows) and 32 exact-flat (B-converts). Recovery flows are holder-proportional — they refill *pre-existing* claims **and the converter's excess claims equally** (amplification, not restoration). Under the same subsequent event stream every transition is strictly increasing in per-unit P, so order-preservation keeps `P_actual < P_fair` (no-convert counterfactual) permanently — a later holder never "gets the excess too".
3. **Full-cycle test** (convert → chop/ripen exit, which 10/10 sampled converters performed): convert adds `+q` backing / `+ta` claims; exit burns `-ta` claims / `-redeem` backing. Claim count nets to **exactly zero change**, but backing nets `q − redeem_actual < q − redeem_fair` (redeem is linear in units at the same penalty → actual redeem = k× fair redeem). The excess does not survive as claims — it exits the reserves as beans in the converter's wallet, leaving every remaining holder with permanently lower per-unit backing. Concrete: sample blk 456457970 → pool loss **51,295 BEAN** at the instant (per-1%-of-supply holder: **512 BEAN**); blk 355821149 → 30,664 BEAN; blk 311590749 → 24,960 BEAN.
4. **Ordering is irrelevant to the bearer class**: each of the 139 converts extracts from the standing urBEAN pool in any order; converts never pay the pool back (only independent, holder-neutral inflows move P up, and those move everyone together). The "Bob can do the same" answer: yes — and each time he does, he extracts from the same standing pool; the pure-urBEAN holder who *cannot* do the same bears every one of the 139 events.

## Root cause (file, function, the exact check that fails)

`src/Beanstalk/protocol/contracts/libraries/Convert/LibUnripeConvert.sol`, `convertLPToBeans` (:22-50):

```solidity
amountOut = LibUnripe
    .underlyingToUnripe(tokenOut, outUnderlyingAmount)   // fair: claims worth exactly q
    .mul(LibUnripe.percentBeansRecapped())               // :46  ← dynamic ratio > spec's static 𝔖 allows
    .div(LibUnripe.percentLPRecapped());                 // :47
LibUnripe.addUnderlying(tokenOut, outUnderlyingAmount);  // :48  ← backing added = q, unmultiplied
IBean(tokenOut).mint(address(this), amountOut);          // :49  ← claims minted = fair × k  (k = 1.15–1.76 observed)
```

The mint at :49 is multiplied by `pctB/pctL` but the backing add at :48 is not. No check enforces `amountOut ≤ claim-value of backing added` (e.g. `underlyingToUnripe(outUnderlyingAmount)`), so every A-convert dilutes all other urBEAN claims by `excess · S_b/(S_b+ta)`.

## Impact scenario (whose money/keys/uptime, how many users, the attacker walks away with)

- **Affected**: every urBEAN claimant who does not convert in the same tx — the standing holders at convert time *and* everyone who enters afterwards — pro-rata: Silo unripe-BEAN depositors, users waiting to ripen, B-converters. Each A-convert permanently reduces the backing available to remaining unripe-BEAN claimants relative to the no-convert counterfactual (the excess claim count exits via chop/ripen against shared reserves). No victim action or misbehavior required; converting is the *intended* operation. **Not affected**: holders of urLP merely because someone else converts — their per-unit backing is exactly unchanged (PoC §E.1).
- **Attacker walk-away (live, first hour — program's Funds-at-Risk rule for upgradeable contracts)**: one convert of 4e12 urLP-units (49.2% supply cap, single-sided) → **284,743 BEAN** realized by immediate chop (= 1,160,818 BEAN at full ripen). Self-limiting/front-loaded: that convert moves k 1.7596→1.6919, pctB −3.85%; repeatable in tranches (no permission, no gate — 139 independent historical executions prove reachability).
- **Historically realized damage**: 139 converts → excess claims 2,271,520 BEAN; **exact permanent reduction in backing available to the standing urBEAN claimant pool vs the no-convert counterfactual: 2,243,862 BEAN**, of which the 10-tx sample shows direct realization (chop/ripen), including serial choppers (467,550 and 880,877 BEAN).
- **Not a theoretical revaluation**: value exits the protocol through the chop/ripen paths (`UnripeFacet.chop` / `ripenConvert`) against the diamond's reserves, which back all remaining holders.

## Cost to sustain (one-time trigger cost + cost to re-trigger indefinitely)

- **One-time**: acquire urLP (internal balance via ordinary Silo converts/wdrips — 9/10 historical recipients needed no external market) + 1 `Convert` call; no flash loan, no governance, no oracle input, no min-out griefing (slippage gate :29-32 scales with the same ratio).
- **Permissionless**: `ConvertFacet.convert` (`:55`) is `external payable` gated only by `fundsSafu`, `noSupplyChange`, `nonReentrant` — no owner/role/allowlist check. Reachability is proven, not assumed: 139 executions from 6 unrelated addresses, 9/10 starting from internal balances only.
- **Re-trigger**: indefinitely, once per state — k>1 continuously since at least Oct 2024 and rises as recap progresses; each convert self-limits (~−3.85% pctB per 4e12) but the drift refills it (monotone 1.17→1.74 across the full history). Cost = gas only.

## Suggested severity + BBP line (quote the program's impact category verbatim)

- **Suggested: Smart Contract — Critical**, category **"Direct theft of any user funds, whether at-rest or in-motion, other than unclaimed yield"** (scope.md Critical #1; #3 "Direct theft of user funds" equivalent). Dilution-then-realization is direct theft: 2.24M BEAN of holder value already realized historically; live first-hour extract ≈ 284,743 BEAN in one tx.
- **Fallback: High — "Illegitimate minting of protocol native assets"** (scope.md High #10). Precedent: BIR-13 classified a convert-path unripe mint under this category (High) — that instance was *unprofitable* (zero economic damage); this one is profitable and historically realized. BIR-14 family (value-not-delivered) also adjacent but weaker — here value actively leaves other holders.
- Dedupe: **cleared** — not in `BeanstalkFarms/Beanstalk-Audits`; Codehawks L-04 addressed in-battery; BIR-13/14 different issues (unprofitable mint / end-of-barn-raise haircut); BIP text does not document this multiplier's drift as intent (opposite: spec fixes static 𝔖).
- Reward note: upgradeable contract → program counts "Funds at Risk in initial attacks that can be executed within the first hour" → lead with the 284,743-BEAN first-hour sizing; historical 2.24M supports practicability/reach, not cap math.

## Remediation (1-2 lines, positive-check form)

In `convertLPToBeans`, mint only what the backing add supports: `amountOut = LibUnripe.underlyingToUnripe(tokenOut, outUnderlyingAmount)` (drop the `:46-47` ratio multiplier), so `amountOut` claim-value == `addUnderlying(outUnderlyingAmount)` at :48 — or equivalently enforce `require(amountOut.mul(s.urBEAN.supply) <= existingBacking.mul(...))`-style claim≤backing check across both convert directions; then re-derive the spec §14.4.5 premium (if still intended) from the static `𝔖` with an explicit cap.
