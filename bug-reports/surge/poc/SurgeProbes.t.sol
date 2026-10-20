// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.17;

import "forge-std/Test.sol";
import "../src/Pool.sol";
import "../src/Factory.sol";
import "./mocks/ERC20.sol";

/// Probe harness written for the Surge hunt (workflow stage 4).
/// Probes are labelled P-A, P-B, ... matching findings.md ledger rows.
contract SurgeProbes is Test {

    Factory factory;

    function setUp() public {
        factory = new Factory(address(this), "G");
    }

    function _mk(uint loanSupply, uint collSupply) internal returns (Pool pool, MockERC20 loan, MockERC20 coll) {
        coll = new MockERC20(collSupply, 18);
        loan = new MockERC20(loanSupply, 18);
        pool = factory.deploySurgePool(
            IERC20(address(coll)), IERC20(address(loan)),
            1e18,        // maxCollateralRatioMantissa 100%
            0.8e18,      // surge util 80%
            1 days,      // fall duration (fast enough to observe)
            1 days,      // recovery duration
            0,           // min rate
            0.4e18,      // surge rate
            0.6e18       // max rate
        );
    }

    // ------------------------------------------------------------------
    // P-A : Factory.setFeeRecipient(0) while feeMantissa > 0
    //       -> getFee() returns (address(0), fee>0) -> Pool mints accrued
    //          fee shares to address(0), permanently locked.
    // ------------------------------------------------------------------
    function test_PA_feeRecipientZero_locksFeeShares() external {
        (Pool pool, MockERC20 loan, MockERC20 coll) = _mk(1_000e18, 1_000e18);
        loan.approve(address(pool), type(uint).max);
        coll.approve(address(pool), type(uint).max);

        // operator sets a real recipient + a 20% fee, then zeroes the recipient
        factory.setFeeRecipient(address(0xBEEF));
        factory.setFeeMantissa(0.2e18);
        factory.setFeeRecipient(address(0)); // <-- no guard, allowed

        pool.deposit(100e18);
        pool.addCollateral(address(this), 20e18);
        pool.borrow(20e18); // util 20/100 = 20% (< surge)

        vm.warp(block.timestamp + 365 days);
        pool.withdraw(0); // just accrues

        emit log_named_uint("fee shares minted to address(0)", pool.balanceOf(address(0)));
        emit log_named_uint("totalSupply", pool.totalSupply());
        assertGt(pool.balanceOf(address(0)), 0, "expected locked fee shares at zero address");
    }

    // ------------------------------------------------------------------
    // P-B : accounting consistency after a scripted mixed sequence.
    //       Checks: sum(balanceOf)==totalSupply, sum(collateralBalanceOf)
    //       == collateral token balance, sum(debtSharesBalanceOf)==supply,
    //       debtSharesSupply <= lastTotalDebt (share price >= 1).
    // ------------------------------------------------------------------
    function test_PB_scripted_accounting() external {
        (Pool pool, MockERC20 loan, MockERC20 coll) = _mk(1_000e18, 1_000e18);
        address a = address(0xA11CE);
        address b = address(0xB0B);
        loan.transfer(a, 300e18);
        loan.transfer(b, 300e18);
        coll.transfer(a, 300e18);
        coll.transfer(b, 300e18);
        loan.approve(address(pool), type(uint).max);
        coll.approve(address(pool), type(uint).max);

        pool.deposit(200e18);
        vm.prank(a); loan.approve(address(pool), type(uint).max);
        vm.prank(b); loan.approve(address(pool), type(uint).max);
        vm.prank(a); coll.approve(address(pool), type(uint).max);
        vm.prank(b); coll.approve(address(pool), type(uint).max);

        vm.prank(a); pool.deposit(100e18);
        vm.prank(b); pool.deposit(100e18);
        pool.addCollateral(address(this), 100e18);
        vm.prank(a); pool.addCollateral(a, 150e18);
        vm.prank(b); pool.addCollateral(b, 150e18);

        pool.borrow(80e18);
        vm.prank(a); pool.borrow(60e18);
        vm.prank(b); pool.borrow(60e18);

        vm.warp(block.timestamp + 120 days);
        vm.prank(a); pool.repay(a, 30e18);

        vm.warp(block.timestamp + 120 days);
        vm.prank(b); pool.repay(b, type(uint).max);

        pool.withdraw(10e18);

        vm.warp(block.timestamp + 60 days);
        // push utilization above surge -> ratio starts falling
        pool.withdraw(50e18);
        pool.withdraw(50e18);

        _assertAccounting(pool, loan, coll, _actors([a, b, address(0xBEEF)]));
    }

    // ------------------------------------------------------------------
    // P-C : fuzzed operation sequence with invariant assertions.
    // ------------------------------------------------------------------
    function testFuzz_PC_sequence(uint256 seed) external {
        (Pool pool, MockERC20 loan, MockERC20 coll) = _mk(1_000e18, 1_000e18);
        address[3] memory acts = [address(0xA11CE), address(0xB0B), address(0xC0FFEE)];
        for (uint i; i < acts.length; i++) {
            loan.transfer(acts[i], 250e18);
            coll.transfer(acts[i], 250e18);
            vm.prank(acts[i]); loan.approve(address(pool), type(uint).max);
            vm.prank(acts[i]); coll.approve(address(pool), type(uint).max);
        }
        loan.approve(address(pool), type(uint).max);
        coll.approve(address(pool), type(uint).max);

        for (uint step; step < 24; step++) {
            seed = uint256(keccak256(abi.encodePacked(seed, step)));
            uint op = seed % 8;
            address actor = acts[(seed >> 8) % 3];
            uint amt = (seed >> 16) % 400e18;

            if (op == 0) { try pool.deposit(amt) {} catch {} }
            else if (op == 1) { try pool.withdraw(amt) {} catch {} }
            else if (op == 2) { try pool.addCollateral(actor, amt) {} catch {} }
            else if (op == 3) { try pool.removeCollateral(amt) {} catch {} }
            else if (op == 4) {
                vm.prank(actor); try pool.borrow(amt) {} catch {}
            }
            else if (op == 5) {
                vm.prank(actor); try pool.repay(actor, amt) {} catch {}
            }
            else if (op == 6) {
                vm.prank(actor); try pool.repay(actor, type(uint).max) {} catch {}
            }
            else {
                vm.prank(actor); try pool.liquidate(actor, amt) {} catch {}
            }

            if (op % 3 == 0) {
                vm.warp(block.timestamp + (1 + ((seed >> 32) % 30 days)));
            }
            _assertAccounting(pool, loan, coll, _actors(acts));
        }
    }

    // ------------------------------------------------------------------
    // P-D : probe whether totalSupply can be driven to 0 while debt > 0
    //       (state-corruption / free-withdraw surface).
    // ------------------------------------------------------------------
    // P-D (EXPECTED KILL): can a withdrawal drive totalSupply to 0 while
    // lastTotalDebt > 0 (which would make later withdraws burn 0 shares and
    // pay out tokens for free)?  shares burned = amount*T/S, so burning all
    // T shares needs amount = S (the full claim).  With D > 0, S = D+B > B,
    // so the transfer has no liquidity and the tx reverts.
    function test_PD_totalSupplyZero_isUnreachable() external {
        (Pool pool, MockERC20 loan, MockERC20 coll) = _mk(1_000e18, 1_000e18);
        loan.approve(address(pool), type(uint).max);
        coll.approve(address(pool), type(uint).max);

        pool.deposit(100e18);              // sole lender, T = 100e18 shares
        pool.addCollateral(address(this), 100e18);
        pool.borrow(50e18);                // borrow 50e18 -> D = 50e18, B = 50e18

        vm.warp(block.timestamp + 8 * 365 days); // accrue interest (D: 50e18 -> 150e18)
        pool.withdraw(0);                  // commit accrual

        uint T = pool.totalSupply();
        uint S = pool.lastTotalDebt() + loan.balanceOf(address(pool));
        uint B = loan.balanceOf(address(pool));
        emit log_named_uint("T shares", T);
        emit log_named_uint("S assets (full claim)", S);
        emit log_named_uint("B liquid", B);

        // The largest payable amount is B; it leaves > 0 shares
        // (shares burned = B*T/S < T because B < S).
        pool.withdraw(B - 1e18);
        emit log_named_uint("shares left after max payable withdraw", pool.totalSupply());
        assertGt(pool.totalSupply(), 0, "largest payable withdraw cannot zero totalSupply");

        // Amount == S would burn all shares but needs S > B liquidity.
        assertGt(S, B, "full claim exceeds liquid balance while debt is outstanding");
        vm.expectRevert();
        pool.withdraw(S);
        assertGt(pool.totalSupply(), 0, "totalSupply survives with debt outstanding");
    }

    // ------------------------------------------------------------------
    // P-E : fee-share mint denominator is pre-accrual `_supplied`, so the
    //       recipient is minted more shares than the intended fee is worth.
    // ------------------------------------------------------------------
    function test_PE_feeSharesOverMint() external {
        (Pool pool, MockERC20 loan, MockERC20 coll) = _mk(1_000e18, 1_000e18);
        loan.approve(address(pool), type(uint).max);
        coll.approve(address(pool), type(uint).max);
        factory.setFeeRecipient(address(0xBEEF));
        factory.setFeeMantissa(0.2e18);

        pool.deposit(100e18);
        pool.addCollateral(address(this), 20e18);
        pool.borrow(20e18);

        uint T = pool.totalSupply();          // 100e18
        vm.warp(block.timestamp + 365 days);
        pool.withdraw(0);                     // accrue

        uint interest = 2e18;                 // 20e18 debt * 10% * 1y
        uint fee = interest * 0.2e18 / 1e18;  // 0.4e18
        uint S = 20e18 + 80e18;               // PRE-accrual supplied
        uint fair = fee * T / (S + interest); // post-accrual NAV denominator
        uint got = pool.balanceOf(address(0xBEEF));

        uint nav = S + interest;
        uint realized = got * nav / (T + got);
        emit log_named_uint("fee shares (code)", got);
        emit log_named_uint("fee shares (post-accrual NAV)", fair);
        emit log_named_uint("fee value realized (tokens)", realized);
        emit log_named_uint("intended fee (tokens)", fee);
        assertGt(got, fair, "code mints more fee shares than post-accrual NAV implies");
        assertGt(realized, fee, "recipient realises more than the intended fee");
    }

    // ------------------------------------------------------------------
    // P-F : no check that collateral and loan tokens share decimals. The
    //       collateral-ratio math (userDebt*1e18/collateralBalance) assumes
    //       equal decimals; a mismatched pool is mis-scaled by 10**(dC-dL).
    // ------------------------------------------------------------------
    function test_PF_decimalMismatch_overBorrow() external {
        MockERC20 coll = new MockERC20(10e18, 18); // collateral, 18 decimals
        MockERC20 loan = new MockERC20(2e18, 6);   // loan token, 6 decimals
        Pool pool = factory.deploySurgePool(
            IERC20(address(coll)), IERC20(address(loan)),
            1e18, 0.8e18, 1 days, 1 days, 0, 0.4e18, 0.6e18);

        loan.approve(address(pool), type(uint).max);
        pool.deposit(1.25e18); // 1.25e12 loan tokens (6dp)
        address borrower = address(0xB0B);
        coll.transfer(borrower, 1e18); // 1 collateral token (18dp)
        vm.prank(borrower); coll.approve(address(pool), type(uint).max);
        vm.prank(borrower); pool.addCollateral(borrower, 1e18);

        // 1 collateral token "backs" a borrow of 1e18 loan units = 1e12 loan tokens.
        vm.prank(borrower); pool.borrow(1e18);

        emit log_named_uint("collateral units (18dp)", pool.collateralBalanceOf(borrower));
        emit log_named_uint("loan borrowed units (6dp)", pool.debtSharesBalanceOf(borrower));
        emit log_named_uint("implied ratio mantissa", pool.debtSharesBalanceOf(borrower) * 1e18 / pool.collateralBalanceOf(borrower));
        assertEq(pool.debtSharesBalanceOf(borrower), 1e18, "borrow of 1e12 loan tokens passed the ratio check");
    }

    function _actors(address[3] memory acts) internal view returns (address[6] memory) {
        return [acts[0], acts[1], acts[2], address(this), address(0), address(0xFEE)];
    }

    function _assertAccounting(Pool pool, MockERC20 loan, MockERC20 coll, address[6] memory accts) internal {
        uint sumBal;
        uint sumColl;
        uint sumShares;
        for (uint i; i < accts.length; i++) {
            sumBal += pool.balanceOf(accts[i]);
            sumColl += pool.collateralBalanceOf(accts[i]);
            sumShares += pool.debtSharesBalanceOf(accts[i]);
        }
        assertEq(sumBal, pool.totalSupply(), "INV1 sum(poolBalance)==totalSupply");
        assertEq(sumColl, coll.balanceOf(address(pool)), "INV2 sum(collateral)==collateral balance");
        assertEq(sumShares, pool.debtSharesSupply(), "INV3 sum(debtShares)==debtSharesSupply");
        assertLe(pool.debtSharesSupply(), pool.lastTotalDebt(), "INV4 debtSharesSupply <= lastTotalDebt");
        if (pool.debtSharesSupply() == 0) {
            assertEq(pool.lastTotalDebt(), 0, "INV5 zero shares => zero debt");
        }
        if (pool.lastTotalDebt() == 0) {
            assertEq(pool.debtSharesSupply(), 0, "INV7 zero debt => zero shares");
        }
        // sanity: loan balance is a real claim the pool holds
        assertLe(loan.balanceOf(address(pool)), loan.totalSupply(), "INV6 balance <= supply");
    }
}
