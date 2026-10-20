/**
 * N-007 / F1 — position-keyed markedIdxs lets one fast withdrawal void a nonce
 * without consuming it, so the same nonce settles a different withdrawal and the
 * fast payout is never debited from internal balance.
 *
 * Sequence:
 *  1. Deposit 100 USDC (slow-mode credit).
 *  2. Sign W1 (WithdrawCollateral, nonce 0, amount 50e6). Fast-exec at idx=100.
 *  3. Pool pays out; internal balance unchanged.
 *  4. Sign W2 (WithdrawCollateral, nonce 0, amount 30e6). Batch at idx=nSubmissions.
 *  5. W2 settles, nonce 0 consumed, balance debited.
 *  6. Attempt batch with W1 → ERR_WRONG_NONCE. Pool never refilled.
 */
const { expect } = require('chai');
const { ethers, network } = require('hardhat');

const ONE = 10n ** 18n;
const Q = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

const TX_WITHDRAW_COLLATERAL = 2; // IEndpoint.TransactionType.WithdrawCollateral
const SPOT = 0; // EngineType.SPOT
const QUOTE = 0; // QUOTE_PRODUCT_ID
const DECIMALS = 6;
const SCALE = 10n ** BigInt(18 - DECIMALS); // 1e12

const domainNado = (verifyingContract) => ({
  name: 'Nado',
  version: '0.0.1',
  chainId: 31337,
  verifyingContract,
});

const withdrawCollateralTypes = {
  WithdrawCollateral: [
    { name: 'sender', type: 'bytes32' },
    { name: 'productId', type: 'uint32' },
    { name: 'amount', type: 'uint128' },
    { name: 'nonce', type: 'uint64' },
  ],
};

const signedTransactionTypes = {
  SignedTransaction: [
    { name: 'idx', type: 'uint64' },
    { name: 'transaction', type: 'bytes' },
  ],
};

const submitTransactionsTypes = {
  SubmitTransactions: [
    { name: 'idx', type: 'uint64' },
    { name: 'transactionsHash', type: 'bytes32' },
  ],
};

function encodeSignedWithdrawCollateral(tx, signature) {
  const encoded = ethers.utils.defaultAbiCoder.encode(
    [
      'tuple(tuple(bytes32 sender,uint32 productId,uint128 amount,uint64 nonce) tx,bytes signature)',
    ],
    [[tx, signature]]
  );
  return ethers.utils.hexConcat([
    ethers.utils.arrayify(TX_WITHDRAW_COLLATERAL),
    encoded,
  ]);
}

async function signWithdrawCollateral(wallet, endpointAddr, tx) {
  return wallet._signTypedData(domainNado(endpointAddr), withdrawCollateralTypes, {
    sender: tx.sender,
    productId: tx.productId,
    amount: tx.amount,
    nonce: tx.nonce,
  });
}

/** ECDSA signature over Verifier EIP-712 SignedTransaction(idx, tx). */
async function signSignedTransaction(wallet, verifierAddr, idx, transaction) {
  return wallet._signTypedData(domainNado(verifierAddr), signedTransactionTypes, {
    idx,
    transaction,
  });
}

/**
 * Schnorr (Verifier.verify) over a 32-byte message.
 * Single-signer aggregate: privkey d, pubkey P = d*G with coords (px, py).
 * e = keccak256(abi.encodePacked(r_addr, uint8(parity), px, message))
 * s = (k + e*d) mod Q
 */
function schnorrSign(privKey, message) {
  const d = BigInt(privKey);
  const pub = ethers.utils.computePublicKey(privKey, false); // 0x04||x||y
  const px = '0x' + pub.slice(4, 68);
  const py = '0x' + pub.slice(68, 132);
  const parity = BigInt(py) % 2n === 0n ? 27 : 28;

  // Deterministic nonce; retry loop handles degenerate (sp==0 / ecrecover fail) cases.
  let k = BigInt(ethers.utils.keccak256(ethers.utils.concat([privKey, message]))) % Q;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (k === 0n) k = BigInt(attempt) + 1n;
    const kHex = ethers.utils.hexZeroPad(ethers.BigNumber.from(k).toHexString(), 32);
    const Rpub = ethers.utils.computePublicKey(kHex, false);
    const rAddr = ethers.utils.computeAddress(Rpub);
    const e = ethers.utils.keccak256(
      ethers.utils.solidityPack(
        ['address', 'uint8', 'bytes32', 'bytes32'],
        [rAddr, parity, px, message]
      )
    );
    const s = (k + BigInt(e) * d) % Q;
    if (s === 0n) {
      k = (k + 1n) % Q;
      continue;
    }
    // sp = Q - (s*px % Q) must be nonzero for the contract's require(sp != 0)
    const sp = (Q - ((s * BigInt(px)) % Q)) % Q;
    if (sp === 0n) {
      k = (k + 1n) % Q;
      continue;
    }
    const ep = (Q - ((BigInt(e) * BigInt(px)) % Q)) % Q;
    if (ep === 0n) {
      k = (k + 1n) % Q;
      continue;
    }
    return {
      e,
      s: ethers.utils.hexZeroPad(ethers.BigNumber.from(s).toHexString(), 32),
    };
  }
  throw new Error('schnorrSign: failed to find valid nonce k');
}

function batchTransactionsHash(idx, transactions) {
  let h = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(['uint64'], [idx])
  );
  for (const tx of transactions) {
    h = ethers.utils.keccak256(ethers.utils.concat([h, tx]));
  }
  return h;
}

async function schnorrSignBatch(schnorrPriv, endpointAddr, idx, transactions) {
  const transactionsHash = batchTransactionsHash(idx, transactions);
  const digest = ethers.utils._TypedDataEncoder.hash(
    domainNado(endpointAddr),
    submitTransactionsTypes,
    { idx, transactionsHash }
  );
  return schnorrSign(schnorrPriv, digest);
}

describe('N-007 F1: fast withdrawal voids nonce without debit', function () {
  this.timeout(600000);

  let deployer, user, sequencer, ecdsaSigner, relayer;
  let quote, sanctions, endpointTx;
  let verifier, spotEngine, perpEngine, clearinghouse, withdrawPool, endpoint;
  let schnorrPriv;
  let subaccount;

  async function deployProxy(implFactory, impl, args = [], initFn = null) {
    const Proxy = await ethers.getContractFactory('MinimalProxy');
    let data = '0x';
    if (initFn) {
      data = impl.interface.encodeFunctionData(initFn, args);
    }
    const proxy = await Proxy.deploy(impl.address, data);
    await proxy.deployed();
    return implFactory.attach(proxy.address);
  }

  beforeEach(async function () {
    [deployer, user, sequencer, ecdsaSigner, relayer] = await ethers.getSigners();

    // --- token + mocks ---
    const MockERC20 = await ethers.getContractFactory('MockERC20');
    quote = await MockERC20.deploy('USD Coin', 'USDC', DECIMALS);
    await quote.deployed();

    const MockSanctions = await ethers.getContractFactory('MockSanctions');
    sanctions = await MockSanctions.deploy();
    await sanctions.deployed();

    const EndpointTx = await ethers.getContractFactory('EndpointTx');
    endpointTx = await EndpointTx.deploy();
    await endpointTx.deployed();

    // --- implementations ---
    const Verifier = await ethers.getContractFactory('Verifier');
    const verifierImpl = await Verifier.deploy();
    await verifierImpl.deployed();

    const SpotEngine = await ethers.getContractFactory('SpotEngine');
    const spotImpl = await SpotEngine.deploy();
    await spotImpl.deployed();

    const PerpEngine = await ethers.getContractFactory('PerpEngine');
    const perpImpl = await PerpEngine.deploy();
    await perpImpl.deployed();

    const Clearinghouse = await ethers.getContractFactory('Clearinghouse');
    const chImpl = await Clearinghouse.deploy();
    await chImpl.deployed();

    const WithdrawPool = await ethers.getContractFactory('WithdrawPool');
    const wpImpl = await WithdrawPool.deploy();
    await wpImpl.deployed();

    const Endpoint = await ethers.getContractFactory('Endpoint');
    const epImpl = await Endpoint.deploy();
    await epImpl.deployed();

    // --- proxies (admin slot = 0 → anyone may initialize) ---
    verifier = await deployProxy(Verifier, verifierImpl);
    spotEngine = await deployProxy(SpotEngine, spotImpl);
    perpEngine = await deployProxy(PerpEngine, perpImpl);
    clearinghouse = await deployProxy(Clearinghouse, chImpl);
    withdrawPool = await deployProxy(WithdrawPool, wpImpl);
    endpoint = await deployProxy(Endpoint, epImpl);

    // --- verifier: 1 Schnorr key + 1 ECDSA signer → nSigner = 1 ---
    schnorrPriv = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const schnorrPub = ethers.utils.computePublicKey(schnorrPriv, false);
    const point = {
      x: '0x' + schnorrPub.slice(4, 68),
      y: '0x' + schnorrPub.slice(68, 132),
    };
    const none = { x: 0, y: 0 };
    await verifier.initialize(
      [point, none, none, none, none, none, none, none],
      [
        ecdsaSigner.address,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
      ]
    );

    // --- clearinghouse (withdrawPoolProxy known; engine add after) ---
    await clearinghouse.initialize(
      endpoint.address,
      quote.address,
      deployer.address, // clearinghouseLiq dummy
      0,
      withdrawPool.address
    );

    // addEngine calls engine.initialize(clearinghouse, offchainExchange, quote, endpoint, owner)
    const MockOex = await ethers.getContractFactory('MockOffchainExchange');
    const oex = await MockOex.deploy();
    await oex.deployed();
    const offchainExchangeDummy = oex.address;
    await clearinghouse.addEngine(spotEngine.address, offchainExchangeDummy, SPOT);
    await clearinghouse.addEngine(perpEngine.address, offchainExchangeDummy, 1 /* PERP */);

    await withdrawPool.initialize(clearinghouse.address, verifier.address);

    await endpoint.initialize(
      sanctions.address,
      sequencer.address,
      offchainExchangeDummy,
      clearinghouse.address,
      verifier.address,
      endpointTx.address
    );

    // Register a dummy perp product so productIds is non-empty
    // (getHealthContribution reads productIds[length-1]; empty → underflow).
    // Must run AFTER endpoint.initialize — setInitialPrice requires
    // msg.sender == endpoint.perpEngine, which is only set during init.
    // RiskStore bounds: longWInitial <= longWMaint <= 1e9;
    // shortWInitial >= shortWMaint >= 1e9.
    const riskStore = {
      longWeightInitial: 10n ** 9n, // 1.0
      shortWeightInitial: 10n ** 9n,
      longWeightMaintenance: 10n ** 9n,
      shortWeightMaintenance: 10n ** 9n,
      priceX18: ONE,
    };
    await perpEngine
      .connect(deployer)
      .addOrUpdateProduct(1 /* dummy perp id */, 10n ** 12n, 10n ** 12n, riskStore);

    // subaccount = address || bytes12(0)
    subaccount =
      user.address.toLowerCase() + '00'.repeat(12);

    // --- fund: user deposit balance + pool fast-path liquidity ---
    // mint is capped < 100 ether per call; 100e6 raw is fine.
    await quote.mint(user.address, 100n * 10n ** BigInt(DECIMALS));
    await quote.mint(withdrawPool.address, 200n * 10n ** BigInt(DECIMALS));

    // --- deposit 100 USDC via slow mode + time travel ---
    await quote.connect(user).approve(endpoint.address, 100n * 10n ** BigInt(DECIMALS));
    await endpoint
      .connect(user)
      .depositCollateral('0x' + '00'.repeat(12), QUOTE, 100n * 10n ** BigInt(DECIMALS));

    await network.provider.send('evm_increaseTime', [3 * 24 * 60 * 60 + 1]);
    await network.provider.send('evm_mine');
    await endpoint.executeSlowModeTransaction();
  });

  it('F1: fast payout + nonce void + batch settles W2; W1 un-settleable; pool uncompensated', async function () {
    const amt50 = 50n * 10n ** BigInt(DECIMALS); // $50
    const amt30 = 30n * 10n ** BigInt(DECIMALS); // $30

    // Internal balance credited = 100 * 1e12 = 100e18
    let bal = await spotEngine.getBalance(QUOTE, subaccount);
    expect(bal.amount.toString()).to.equal((100n * ONE).toString());

    const nSub0 = await endpoint.nSubmissions();
    // deposit execution increments nSubmissions
    expect(nSub0).to.equal(1);

    // ========== STEP 1: W1 signed, fast-executed at idx=100 ==========
    const w1 = {
      sender: subaccount,
      productId: QUOTE,
      amount: amt50,
      nonce: 0,
    };
    const w1UserSig = await signWithdrawCollateral(user, endpoint.address, w1);
    const w1Txn = encodeSignedWithdrawCollateral(w1, w1UserSig);

    const fastIdx = 100;
    const w1FastSig = await signSignedTransaction(
      ecdsaSigner,
      verifier.address,
      fastIdx,
      w1Txn
    );

    const poolBefore = BigInt((await quote.balanceOf(withdrawPool.address)).toString());
    const userBefore = BigInt((await quote.balanceOf(user.address)).toString());

    // non-party relayer submits fast path → relayer pays fee via transferFrom
    // approve pool to pull fee from relayer; relayer needs tokens
    await quote.mint(relayer.address, 10n * 10n ** BigInt(DECIMALS));
    await quote.connect(relayer).approve(withdrawPool.address, 10n * 10n ** BigInt(DECIMALS));

    await withdrawPool
      .connect(relayer)
      .submitFastWithdrawal(fastIdx, w1Txn, [w1FastSig]);

    const poolAfterFast = BigInt((await quote.balanceOf(withdrawPool.address)).toString());
    const userAfterFast = BigInt((await quote.balanceOf(user.address)).toString());

    // Fee = max(0.1% * $50, 5 * $1) = max($0.05, $5) = $5 (in raw units with 6 dec)
    // minFeeX18 = 5 * withdrawFeeX18 = 5 * 1e18; fee = 5e18 / 1e12 = 5e6 raw = $5
    // Non-party: relayer pays fee into pool; pool transfers full amt50 to user.
    // Net pool change = +fee - amt50 = -(amt50 - fee).
    const feeRaw = 5n * 10n ** BigInt(DECIMALS);
    const userGain = userAfterFast - userBefore;
    const poolLoss = poolBefore - poolAfterFast;
    expect(userGain).to.equal(amt50); // full amount to user; relayer paid fee
    expect(poolLoss).to.equal(amt50 - feeRaw);

    // Internal balance UNCHANGED — no debit on fast path
    bal = await spotEngine.getBalance(QUOTE, subaccount);
    expect(bal.amount.toString()).to.equal((100n * ONE).toString());

    expect(await withdrawPool.markedIdxs(fastIdx)).to.equal(true);

    // ========== STEP 2: W2 (same nonce 0) settles via sequencer batch ==========
    const w2 = {
      sender: subaccount,
      productId: QUOTE,
      amount: amt30,
      nonce: 0,
    };
    const w2UserSig = await signWithdrawCollateral(user, endpoint.address, w2);
    const w2Txn = encodeSignedWithdrawCollateral(w2, w2UserSig);

    const batchIdx = (await endpoint.nSubmissions()).toNumber(); // 1
    expect(batchIdx).to.equal(nSub0.toNumber());

    const { e, s } = await schnorrSignBatch(schnorrPriv, endpoint.address, batchIdx, [
      w2Txn,
    ]);

    await endpoint
      .connect(sequencer)
      .submitTransactionsChecked(batchIdx, [w2Txn], e, s, 1 /* bitmask */);

    // Nonce consumed
    const nonceAfter = await endpoint.getNonce(user.address);
    expect(nonceAfter).to.equal(1);

    // Balance debited for W2 only: 30e18 + fee 1e18 = 31e18 → 69e18 left
    // (withdrawFeeX18 = ONE = $1 → chargeFee 1e18 normalized)
    bal = await spotEngine.getBalance(QUOTE, subaccount);
    expect(bal.amount.toString()).to.equal((69n * ONE).toString());

    // ========== STEP 3: attempt to settle W1 → ERR_WRONG_NONCE ==========
    // Re-sign W1 for a new batch idx (idx=2)
    const batchIdx2 = (await endpoint.nSubmissions()).toNumber(); // 2
    expect(batchIdx2).to.equal(2);
    const batch2 = await schnorrSignBatch(schnorrPriv, endpoint.address, batchIdx2, [
      w1Txn,
    ]);

    await expect(
      endpoint
        .connect(sequencer)
        .submitTransactionsChecked(batchIdx2, [w1Txn], batch2.e, batch2.s, 1)
    ).to.be.revertedWith('WN');

    // ========== STEP 4: pool uncompensated ==========
    // Pool paid amt50 on fast path (relayer fee replenished feeRaw, net -(amt50-feeRaw)).
    // W2 path: clearinghouse transferred amt30 to pool then pool forwarded amt30 to user
    // → net 0 for pool on W2.
    // Pool is permanently short the fast advance with no path to refill via W1.
    const poolFinal = await quote.balanceOf(withdrawPool.address);
    expect(poolFinal.toString()).to.equal(
      (poolBefore - (amt50 - feeRaw)).toString()
    );

    // User extracted amt50 + amt30 with only amt30+fee debited from internal balance.
    // Internal claim remaining = 69e18; wallet = userBefore + amt50 + amt30.
    const userFinal = await quote.balanceOf(user.address);
    expect(userFinal.toString()).to.equal((userBefore + amt50 + amt30).toString());

    // The hole: internal balances still show 69e18 claim on clearinghouse tokens,
    // but pool liquidity is short 50e6 with no path to refill via W1.
    const chBal = await quote.balanceOf(clearinghouse.address);
    // clearinghouse started with 100e6 from deposit, paid out 30e6 for W2 → 70e6
    expect(chBal.toString()).to.equal((70n * 10n ** BigInt(DECIMALS)).toString());
  });
});
