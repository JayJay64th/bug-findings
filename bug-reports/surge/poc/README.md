# Surge PoC — run instructions

Harness: Foundry. The probe file must live inside the project to compile.

    cd repo/surge-protocol-v1
    export PATH="$PATH:$HOME/.foundry/bin"          # Windows: /c/Users/<you>/.foundry/bin
    forge build                                     # pulls solc 0.8.17 automatically
    cp ../../poc/SurgeProbes.t.sol test/            # or use the copy already in test/
    forge test --match-path test/SurgeProbes.t.sol -vv

Expected: 6 passed, exit 0.
 - test_PA_feeRecipientZero_locksFeeShares  -> F-01 (fee shares minted to address(0))
 - test_PB_scripted_accounting              -> accounting invariants hold
 - testFuzz_PC_sequence                     -> invariant fuzz (INV1..INV7) holds
 - test_PD_totalSupplyZero_isUnreachable    -> DL-02 (protection demonstrated)
 - test_PE_feeSharesOverMint                -> F-02 (fee over-mint measured: 0.4e18 vs 0.4063e18 realised)
 - test_PF_decimalMismatch_overBorrow       -> F-03 (1 collateral token backs 1e12 loan tokens)

Dependency note: lib/forge-std was copied in (repo ships no submodule) and solc 0.8.17 was
auto-installed by forge. Neither changes src/.
