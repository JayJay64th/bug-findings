// SPDX-License-Identifier: MIT
pragma solidity ^0.8.15;

// PoC artifact for H-0003 — NOT executed in this environment (forge not installed; Law 10).
// Demonstrates: Clearinghouse.claimDefaulted on a foreign zero-collateral factory loan
// zeroes receivables and TRSRY DAI debt.

import {Test} from "forge-std/Test.sol";
import {Clearinghouse} from "src/Coolinghouse.sol"; // NOTE: fix path to Clearinghouse.sol when running
import {Cooler, CoolerFactory} from "src/CoolerFactory.sol";
import {ERC20} from "solmate/tokens/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s, 18) {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

/// @notice Minimal TRSRY/MINTR/Kernel/Staking mocks omitted for brevity in artifact;
/// full run needs olympus-v3 module mocks (see Cooler/src/test/mocks).
contract H0003_ZeroCollateralForeignClaim {
    // Steps (foundry):
    // 1. Deploy CoolerFactory.
    // 2. Deploy MockERC20 X, Y. factory.generateCooler(X, Y) from attacker.
    // 3. cooler.requestLoan(1e30, 0, type(uint256).max, 1 days) — collateralFor == 0.
    // 4. Attacker clearRequest as lender with Y.minted amount.
    // 5. vm.warp(+2 days).
    // 6. Clearinghouse.claimDefaulted([cooler],[loanID]) — needs CH deployed with mocks.
    // 7. assert clearinghouse.receivables() == 0
    // 8. assert TRSRY.reserveDebt(DAI, CH) == 0
}
