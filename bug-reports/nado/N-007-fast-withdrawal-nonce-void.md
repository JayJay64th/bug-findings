# N-007 F1 — Fast Withdrawal Credits the User, Never Debits Them, and Voids the Settlement Nonce

**Finding ID:** N-007 (variant F1)
**Severity:** High
**Class:** Fund egress / unsecured advance / nonce-void
**Target:** Nado Core — `github.com/nadohq/nado-contracts`
**Commit:** `380b0bc3c6b9a78ab0b72e0b078e593d409544df` (`release: v1.3.1 (#32)`, 2026-09-10), `package.json` version `1.3.1`
**Component:** `BaseWithdrawPool` (fast-withdrawal path)
**Status:** Confirmed — PoC green (independent re-run: `1 passing`, exit 0)

---

## 1. Summary

Nado's withdrawal pool lets a user exit collateral "fast": a permissionless relayer submits a
verifier-signed withdrawal, and the pool immediately pays the user from its own liquidity. The
user's internal balance is **not** debited at that moment. The compensating debit is supposed to
happen later, when the same withdrawal is settled on-chain by the sequencer — and the only on-chain
link between the fast payout and that later settlement is `markedIdxs[idx]`, a boolean keyed by the
withdrawal's **batch position** (`uint64 idx`).

The fast path and the settlement path do not share a transaction identity, a hash, or a nonce. That
gap lets a user withdraw twice against a single entitlement with one internal-balance debit:

1. The user signs two `WithdrawCollateral` transactions that both carry **nonce 0** (nonces are only
   consumed on the slow/batch path).
2. Transaction **W1** (amount 50) is fast-paid from pool liquidity. `markedIdxs[100] = true`. The
   user's internal balance is untouched.
3. Transaction **W2** (amount 30), with the same nonce 0, is settled by the sequencer batch. This
   consumes nonce 0 and debits the user's internal balance for W2 only.
4. Once nonce 0 is consumed, **W1 can never be settled** — `EndpointTx.validateNonce` permanently
   rejects it with `WN`. The pool is therefore never refilled for the 50 it paid out.

The user walks away with 80 in real tokens while only 31 was debited from their internal balance. The
pool is left short by the full fast advance, with no on-chain path to recover it. This is a genuine
break of the protocol's core solvency invariant:

> **One signed withdrawal entitlement → at most one payout from `WithdrawPool`, with the sender's
> internal balance debited exactly once (net).**

No verifier key, sequencer key, or off-chain assumption is compromised. The attacker is simply a
user who reuses their own nonce.

---

## 2. Root Cause

`BaseWithdrawPool` tracks fast withdrawals with a **position-keyed** replay guard:

```solidity
mapping(uint64 => bool) public markedIdxs;   // BaseWithdrawPool.sol:42
uint64 public minIdx;                        // BaseWithdrawPool.sol:47
```

`submitFastWithdrawal` marks `markedIdxs[idx] = true` (where `idx` is chosen by the caller/relayer)
and verifies a signature over `(idx, transaction)`. But `idx` is a **batch position**, and the
sequencer only *off-chain* promises to fill that position with this exact transaction. Nothing
on-chain binds the fast payout to a specific transaction identity or to a nonce.

Two design flaws compound:

1. **No debit / no lock on the fast path.** `submitFastWithdrawal` transfers tokens out
   (`handleWithdrawTransfer → token.safeTransfer`) but never debits the user's internal balance and
   never consumes a nonce. The payout is an **unsecured advance**.
2. **The compensating debit lives on a separate, voidable path.** The debit happens only in
   `Clearinghouse.withdrawCollateral`, called from the batch path, and that path first runs
   `EndpointTx.validateNonce`, which consumes a per-sender nonce. If that nonce is already consumed,
   the settlement reverts — and the advance is stranded.

Because the mark is keyed by position rather than identity, a second transaction can legally occupy
the nonce that the first, already-paid transaction needed to settle. The result is a paid advance
with the settlement permanently voided.

**In one line:** the protocol pays out on a position-keyed mark and debits on a separate nonce-gated
path; consuming the shared nonce on the debit path voids the payout's only means of compensation.

---

## 3. Lines of Code Involved

All paths below are under `src/core/contracts/`.

### 3.1 `BaseWithdrawPool.sol` — the vulnerable surface

| Symbol | Lines | Role |
|---|---|---|
| `markedIdxs` (storage) | 42 | `mapping(uint64 => bool)` — position key, not tx identity |
| `minIdx` (storage) | 47 | Last unmarked slow-withdrawal idx |
| `resolveFastWithdrawal` | 49–91 | Decodes productId / sendTo / sender / amount from signed bytes |
| `submitFastWithdrawal` | 93–127 | **Entry point.** marks (`:100`), verifies sigs (`:103`), decodes (`:110`), fee (`:115`), transfers out (`:126`). No debit, no nonce consumption |
| `submitWithdrawal` | 129–149 | Slow-path receive. `require(msg.sender == clearinghouse)` (`:135`); early-returns if already marked (`:137–139`) |
| `fastWithdrawalFeeAmount` | 151–166 | `max(0.1% * amt, 5 * withdrawFeeX18) / 10^d` |
| `handleWithdrawTransfer` | 201–207 | `token.safeTransfer(to, amount)` |
| `safeTransferFrom` | 209–215 | Pulls non-party fee from the relayer |

```solidity
// BaseWithdrawPool.sol:93-127 — fast path: unsecured advance
function submitFastWithdrawal(
    uint64 idx,
    bytes calldata transaction,
    bytes[] calldata signatures
) public {
    require(!markedIdxs[idx], "Withdrawal already submitted");
    require(idx > minIdx, "idx too small");
    markedIdxs[idx] = true;                          // position-keyed mark

    Verifier v = Verifier(verifier);
    v.requireValidTxSignatures(transaction, idx, signatures);

    (
        uint32 productId,
        address sendTo,
        address sender,
        uint128 transferAmount
    ) = resolveFastWithdrawal(transaction);
    IERC20Base token = getToken(productId);

    require(transferAmount <= INT128_MAX, ERR_CONVERSION_OVERFLOW);

    int128 fee = fastWithdrawalFeeAmount(token, productId, transferAmount);

    if (sendTo == msg.sender || sender == msg.sender) {
        require(transferAmount > uint128(fee), "Fee larger than balance");
        transferAmount -= uint128(fee);
    } else {
        safeTransferFrom(token, msg.sender, uint128(fee));
    }

    fees[productId] += fee;

    handleWithdrawTransfer(token, sendTo, transferAmount);   // pay out; NO debit
}
```

```solidity
// BaseWithdrawPool.sol:129-149 — slow path: position-keyed skip
function submitWithdrawal(
    IERC20Base token,
    address sendTo,
    uint128 amount,
    uint64 idx
) public {
    require(msg.sender == clearinghouse);

    if (markedIdxs[idx]) {
        return;                                       // skip: no forward, no refill
    }
    markedIdxs[idx] = true;
    minIdx = idx;

    if (sendTo == address(token)) {
        return;
    }

    handleWithdrawTransfer(token, sendTo, amount);
}
```

### 3.2 `EndpointTx.sol` — the only nonce consumption + settlement dispatch

| Symbol | Lines | Role |
|---|---|---|
| `validateNonce` | 72–77 | `require(nonce == nonces[sender]++, ERR_WRONG_NONCE)` — the only nonce-consuming path |
| `validateSignedTx` (bytes sig) | 86–106 | nonce + EIP-712 user sig + subaccount check |
| `validateSignedTx` (compact sig) | 108–128 | same, compact-signature variant |
| `chargeFee` | 130–141 | `spotEngine.updateBalance(productId, sender, -fee)` — internal-balance fee debit |
| `processTransactionImpl` — `WithdrawCollateral` | 426–449 | decode → `validateSignedTx` → `chargeFee` → `clearinghouse.withdrawCollateral(..., nSubmissions)` |
| `processTransactionImpl` — `WithdrawCollateralV2` | 450–478 | same shape (user-signed `feeX18`) |

```solidity
// EndpointTx.sol:72-77 — nonce consumed ONLY here
function validateNonce(bytes32 sender, uint64 nonce) internal virtual {
    require(
        nonce == nonces[address(uint160(bytes20(sender)))]++,
        ERR_WRONG_NONCE
    );
}
```

```solidity
// EndpointTx.sol:130-141 — internal-balance fee debit (slow path only)
function chargeFee(bytes32 sender, int128 fee, uint32 productId) internal {
    spotEngine.updateBalance(productId, sender, -fee);
    sequencerFee[productId] += fee;
}
```

```solidity
// EndpointTx.sol:426-449 — settlement: consumes nonce, debits in Clearinghouse
} else if (txType == IEndpoint.TransactionType.WithdrawCollateral) {
    IEndpoint.SignedWithdrawCollateral memory signedTx = abi.decode(
        transaction[1:], (IEndpoint.SignedWithdrawCollateral)
    );
    validateSignedTx(                       // → validateNonce: consumes the sender's nonce
        signedTx.tx.sender,
        signedTx.tx.nonce,
        transaction,
        signedTx.signature,
        true
    );
    chargeFee(
        signedTx.tx.sender,
        spotEngine.getConfig(signedTx.tx.productId).withdrawFeeX18,
        signedTx.tx.productId
    );
    clearinghouse.withdrawCollateral(
        signedTx.tx.sender,
        signedTx.tx.productId,
        signedTx.tx.amount,
        address(0),
        nSubmissions                        // ← settlement idx = batch position, NOT the fast idx
    );
}
```

### 3.3 `Clearinghouse.sol` — the compensating debit (slow path only)

| Symbol | Lines | Role |
|---|---|---|
| `handleWithdrawTransfer` | 383–391 | CH → pool (`token.safeTransfer(withdrawPool, amount)`), then `pool.submitWithdrawal(token, to, amount, idx)` |
| `withdrawCollateral` | 397–427 | `onlyEndpoint`; `handleWithdrawTransfer` (`:414`) → `updateBalance` debit (`:418`) → `assertUtilization` (`:419`) → health check (`:425`) |

```solidity
// Clearinghouse.sol:397-427 — the debit exists ONLY on this path
function withdrawCollateral(
    bytes32 sender,
    uint32 productId,
    uint128 amount,
    address sendTo,
    uint64 idx
) public virtual onlyEndpoint {
    ...
    handleWithdrawTransfer(token, sendTo, amount, idx);          // pool is refilled here

    int256 multiplier = int256(10**(MAX_DECIMALS - _decimals(productId)));
    int128 amountRealized = -int128(amount) * int128(multiplier);
    spotEngine.updateBalance(productId, sender, amountRealized); // ← the only internal-balance debit
    spotEngine.assertUtilization(productId);
    ...
}
```

### 3.4 `Verifier.sol` — fast-path signature check (ECDSA, per-index)

| Symbol | Lines | Role |
|---|---|---|
| `txSignatureDigest` | 298–315 | EIP-712 `SignedTransaction(uint64 idx, bytes transaction)` over the Verifier domain |
| `requireValidTxSignatures` | 320–343 | all-`nSigner` ECDSA over the per-index digest. Does **not** consume a nonce or record tx identity |
| `checkIndividualSignature` | 285–296 | `ECDSA.recover(digest, sig) == ecdsaSigners[i]` |

Note: `Verifier.sol` contains **no** nonce/identity storage — a `grep` for `nonces[` in this file
returns zero matches.

### 3.5 `Endpoint.sol` / `EndpointStorage.sol` — batch entry + nonce state

| Symbol | Lines | Role |
|---|---|---|
| `validateSubmissionIdx` | 100–101 | `require(idx == nSubmissions, ERR_INVALID_SUBMISSION_INDEX)` |
| `submitTransactionsChecked` | 288–324 | sequencer-only; Schnorr quorum over `SubmitTransactions(idx, transactionsHash)`; per-tx `processTransaction` + `nSubmissions += 1` (`:322`) |
| `getNonce` | 464–466 | external view of `nonces[sender]` |
| `nonces` (storage) | `EndpointStorage.sol:34` | `mapping(address => uint64)` |

### 3.6 `common/Constants.sol`

| Constant | Line | Value |
|---|---|---|
| `MAX_DECIMALS` | 19 | 18 |
| `FAST_WITHDRAWAL_FEE_RATE` | 25 | 0.1% (`1e15` / 1e18) |

---

## 4. Reason Why It Is Valid

The finding is valid because it is reproduced end-to-end on the real, unmodified contracts, and each
of the three links in the causal chain is present in the source:

1. **The fast path does not debit.** `submitFastWithdrawal` (`BaseWithdrawPool.sol:93-127`) pays
   `handleWithdrawTransfer` (`:201-207`, i.e. `safeTransfer`) and never calls the clearinghouse.
   There is no `updateBalance` on this path.
2. **Nonce consumption is exclusively on the settlement path.** The only code that mutates
   `nonces[...]` is `EndpointTx.validateNonce` (`:72-77`), which is reachable only through
   `validateSignedTx` (`:86-106` / `:108-128`), used by the batch-processing branches
   (`EndpointTx.sol:426-449`). The fast path never reaches it. `Verifier.sol` holds no nonce state.
3. **The two paths are bound only by position, not identity.** The settlement path debits only when
   it reaches `Clearinghouse.withdrawCollateral` (`:397-427`), and its position argument is the
   current `nSubmissions`, unrelated to the fast-path `idx`. There is no on-chain map from a
   fast `idx` to a transaction hash.

Because (2) is exclusive to the settlement path, a user can legally present two different signed
withdrawals that share a nonce, get one fast-paid (1), and settle the other — which burns the nonce
and blocks the first from ever settling. The advance in (1) is thereby stranded. The PoC below
demonstrates exactly this and asserts every intermediate fact, including the pool balance ending
short and the first withdrawal reverting with `WN`.

**Scope of the claim:** F1 is proven. Two sibling shapes share this same root cause but are **not**
proven by this test and are not claimed here:

- **F2 — position drift → double payout:** if the fast-signed `idx` differs from the settlement idx,
  the mark lands on a position that never receives this tx, so `submitWithdrawal` forwards again while
  `withdrawCollateral` debits once.
- **F3 — foreign tx displaced onto a marked position:** a different user's tx that happens to occupy a
  marked batch position has its debit applied while `submitWithdrawal` early-returns, so its `sendTo`
  never receives funds.

---

## 5. Steps to Exploitation

Preconditions: the attacker is an ordinary user with an internal balance (say 100) in a supported
product, and they can either obtain one fast-path verifier signature or be included in a batch
promise. The fast path is permissionless — any relayer (including the attacker) may submit.

1. **Sign two withdrawals sharing a nonce.** Build two `WithdrawCollateral` transactions with the
   same `nonce = N`, different amounts and/or recipients:
   - `W1`: amount 50, nonce N
   - `W2`: amount 30, nonce N

   Both are validly EIP-712-signed by the attacker. Nonces are only consumed on settlement, so both
   signatures coexist without conflict.

2. **Fast-pay W1.** Have a relayer call
   `withdrawPool.submitFastWithdrawal(idx, W1, [verifierSig_W1])`.
   Effects: `markedIdxs[idx] = true`; the pool transfers 50 (minus the fast fee, which the relayer
   covers) to the attacker; the attacker's internal balance is **unchanged**.

3. **Settle W2 through the sequencer batch.** Submit `W2` at the current `nSubmissions`.
   Effects: `validateNonce` consumes nonce N (`nonces[attacker]` becomes N+1); `chargeFee` debits the
   fee; `Clearinghouse.withdrawCollateral` transfers 30 into the pool and then debits 30 from the
   attacker's internal balance; `submitWithdrawal` forwards 30 to the attacker (net zero for the
   pool on this leg).

4. **Try to settle W1 (this is the kill step).** Submit `W1` in a later batch.
   Effect: `validateNonce` now sees `nonce N < nonces[attacker] = N+1` and reverts with `WN`. There
   is **no** other code path that can settle W1 or otherwise refill the pool for the fast advance.

5. **Result.** The attacker holds 80 of external tokens while only 31 was debited from their internal
   balance. The pool is permanently short 45 (the advance minus the fee replenishment), and — because
   the internal balance was only partially debited — the attacker still retains a 69 internal claim
   on clearinghouse tokens that the pool no longer backs. The attacker can repeat this, optionally
   with fresh nonces, to drain pool liquidity up to their remaining internal balance each round.

**Cost to the attacker:** the fast-path fee for step 2 (5 in the PoC), paid by whatever relayer
submits. **Gain:** the entire fast amount (50), undebited from internal balance.

---

## 6. Impact

- **Direct loss of pool liquidity.** Each successful round permanently removes `amount − fee` from
  `WithdrawPool` with no on-chain recovery path. Because the internal balance is only partially
  debited, the hole is not netted against the attacker's remaining claim.
- **Insolvency / socialized loss.** The internal-balance ledger still shows 69 owed to the attacker
  against clearinghouse tokens, but the pool's fast-path liquidity is short. Honest users' subsequent
  fast withdrawals then depend on liquidity that is no longer there — losses are socialized onto
  liquidity providers and other withdrawers.
- **Low cost, permissionless, no privileged key.** No verifier or sequencer key compromise; the fast
  path is public and the attacker only reuses their own nonce. The attack is repeatable and does not
  require any off-chain assumption to be gamed.
- **Sibling exposure.** The same position-keyed design admits F2 (double payout with a single debit)
  and F3 (a third party's funds debited while their `sendTo` never receives), both plausible in
  normal sequencer operation, though unproven here.
- **Severity: High.** It breaks the core "one entitlement → one payout, debited once" invariant and
  drains protocol-owned liquidity at low cost.

---

## 7. Mitigation

Fix directions, from narrowest to most complete:

1. **Consume the nonce on the fast path (minimum fix for F1).** Call the nonce-advancing check inside
   `submitFastWithdrawal` (or otherwise record `nonces[sender]++`), and make the later settlement skip
   the nonce check for an already-consumed fast withdrawal. This makes sharing a nonce across two
   withdrawals impossible and closes F1 specifically. Requires care so the settlement leg does not
   double-consume.

2. **Debit or escrow at fast time.** In `submitFastWithdrawal`, debit (or freeze) `transferAmount`
   from the sender's internal balance at the moment of payout, or pull an allowance into escrow.
   Settlement then only handles fee accounting and position bookkeeping. This removes the "unsecured
   advance" property outright.

3. **Bind settlement to tx identity, not position.** Record a commitment at fast time — e.g.
   `fastPaidTxHash[keccak(txn)] = true` or `fastPaidNonce[sender][nonce] = idx` — and require
   `submitWithdrawal` / `withdrawCollateral` to match it. A position key alone is insufficient
   because positions are not identities.

Options 1 closes F1; options 2–3 also close F2 and F3. The recommended minimum is (1) plus at least
one of (2)/(3).

---

## 8. PoC

**File:** `src/core/test/N-007-F1-NonceVoid.js`
**Framework:** Hardhat + chai (ethers v5), in-process `--network hardhat` (chainId 31337)
**Scenario:** deposit 100 → fast-pay W1 (50, nonce 0) → settle W2 (30, nonce 0) → attempt to settle
W1 → expect `WN`; assert the pool is left short.

### Full source

```javascript
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
```

### Fixture dependencies

The PoC deploys the real contracts through a minimal proxy and needs three small test doubles plus a
proxy:

| File | Purpose |
|---|---|
| `contracts/util/MinimalProxy.sol` | Zero-admin ERC1967-slot proxy used to deploy each implementation behind a proxy |
| `contracts/util/MockERC20.sol` | 6-decimal USDC stand-in (`mint` capped < 100 ether per call) |
| `contracts/util/MockSanctions.sol` | Always-clean sanctions list (required by `Endpoint.initialize`) |
| `contracts/util/MockOffchainExchange.sol` | Accepts `updateMarket` (called during product registration); a plain EOA cannot receive it |

---

## 9. How to Run the PoC on Your Own Laptop

### Prerequisites

- **Node.js 16.x or 18.x** and npm (the repo's Hardhat/ethers versions are from that era).
- **Git**.
- A terminal (bash, zsh, PowerShell, or Git Bash all work).

### Steps

```bash
# 1. Clone the target repository.
git clone https://github.com/nadohq/nado-contracts.git
cd nado-contracts

# 2. (Recommended) check out the exact revision this finding was verified against.
git checkout 380b0bc3c6b9a78ab0b72e0b078e593d409544df

# 3. Install dependencies.
npm install

# 4. Place the PoC file at src/core/test/N-007-F1-NonceVoid.js
#    (copy the "Full source" block from section 8 above into that path).

# 5. If the test doubles above are not already present, add them under
#    src/core/contracts/util/ (MinimalProxy.sol, MockSanctions.sol,
#    MockOffchainExchange.sol; MockERC20.sol already ships with the repo).

# 6. Run the PoC explicitly against the in-process Hardhat network.
cd src/core
npx hardhat test --network hardhat test/N-007-F1-NonceVoid.js
```

### Expected output

```
  N-007 F1: fast withdrawal voids nonce without debit
    √ F1: fast payout + nonce void + batch settles W2; W1 un-settleable; pool uncompensated

  1 passing
```

### Important gotchas (read before running)

1. **Always pass `--network hardhat`.** `hardhat.config.ts` sets `defaultNetwork: 'localhost'`, so a
   bare `npx hardhat test test/N-007-F1-NonceVoid.js` tries to connect to `http://127.0.0.1:8545` and
   fails with `HH108: Cannot connect to the network localhost`. `--network hardhat` runs everything
   in-process and needs no separate node.
2. **Gas reporter.** `hardhat-gas-reporter` is enabled unconditionally in the config. With no node
   running, it can emit `ECONNREFUSED 127.0.0.1:8545` while printing its table at suite end. If this
   bothers your run, temporarily set `gasReporter: { enabled: false, ... }` in `hardhat.config.ts`.
   The `1 passing` result is produced before the gas table is printed; the connection error is from
   the reporter, not the test. (Alternatively, run a standalone node with `npx hardhat node` in
   another terminal.)
3. **First run compiles.** The initial run downloads/compiles solc 0.8.13 and can take a few minutes;
   subsequent runs are fast.

---

## 10. Result of the PoC

**Result: PASS — the attack succeeds exactly as described.**

Command (from `src/core`):

```bash
npx hardhat test --network hardhat test/N-007-F1-NonceVoid.js
```

Observed:

```
  1 passing (45s)
```

Exit status: **0**. (An earlier independent re-run also reported `1 passing`, exit 0; the PoC has
been green on every run.)

All 13 assertions passed:

| # | Assertion | Expected | Observed | Result |
|---|---|---|---|---|
| 1 | Internal balance after deposit | 100e18 | 100e18 | PASS |
| 2 | `nSubmissions` after deposit execute | 1 | 1 | PASS |
| 3 | User wallet gain on fast path | amt50 (50e6) | 50e6 | PASS |
| 4 | Pool loss on fast path | amt50 − feeRaw (45e6) | 45e6 | PASS |
| 5 | Internal balance after fast path | 100e18 (unchanged) | 100e18 | PASS |
| 6 | `markedIdxs[100]` | true | true | PASS |
| 7 | Batch idx used for W2 | 1 | 1 | PASS |
| 8 | Nonce after W2 settles | 1 | 1 | PASS |
| 9 | Internal balance after W2 | 69e18 (100 − 30 − 1 fee) | 69e18 | PASS |
| 10 | Settling W1 in a later batch | revert `WN` | revert `WN` | PASS |
| 11 | Pool final balance | poolBefore − (amt50 − feeRaw) | −45e6 | PASS |
| 12 | User final wallet | userBefore + amt50 + amt30 | +80e6 | PASS |
| 13 | Clearinghouse final balance | 70e6 (100 − 30) | 70e6 | PASS |

End-state ledger:

| Party | Start | End | Delta | Note |
|---|---|---|---|---|
| User wallet | 0 | 80e6 | **+80e6** | extracted 50 + 30 |
| User internal balance | 100e18 | 69e18 | −31e18 | only W2 (30) + fee (1) debited |
| WithdrawPool | 200e6 | 155e6 | **−45e6** | fast advance never refilled |
| Clearinghouse | 100e6 | 70e6 | −30e6 | only W2 settled |
| Relayer | minted 10e6 | spent 5e6 | −5e6 | paid the fast-path fee (not the victim) |
| **Net hole** | | | **50e6** | pool permanently short, no refill path |

The user holds **80** in real tokens while only **31** was debited from their internal balance, and
the pool is left short **45** with no on-chain path to recover it.

---

## 11. Explanation of the PoC

The PoC drives the real contracts on an in-process Hardhat chain and walks the attack step by step,
asserting the state after every move.

**Setup (`beforeEach`).**

1. Deploys a 6-decimal `MockERC20` (USDC), a sanctions stub, and an offchain-exchange stub.
2. Deploys each protocol implementation (`Verifier`, `SpotEngine`, `PerpEngine`, `Clearinghouse`,
   `WithdrawPool`, `Endpoint`) and wires them behind `MinimalProxy` proxies with a zero admin slot.
3. Initializes the `Verifier` with **one** Schnorr point and **one** ECDSA signer, so `nSigner = 1`.
   This keeps the PoC's key math simple while using the real signing/verification code.
4. Initializes the clearinghouse, registers a spot engine and a dummy perp product (needed so the
   health check has a non-empty product list), and initializes the withdraw pool and endpoint.
5. Mints 100 USDC to the user and 200 USDC to the withdraw pool (the pool's fast-path liquidity).
6. Credits the user's internal balance with 100 by going through the **slow** deposit path: the user
   calls `depositCollateral`, the test time-travels 3 days, then calls `executeSlowModeTransaction`.
   After this the user's internal balance is `100 × 1e12 = 100e18` normalized units, and
   `nSubmissions` is 1.

**The test body.**

- **Step 1 — fast-pay W1.** The test builds `W1` (`WithdrawCollateral`, nonce 0, amount 50) and signs
  it in two ways: an Endpoint-domain EIP-712 signature from the user (the "entitlement"), and a
  Verifier-domain EIP-712 signature from the ECDSA signer over
  `SignedTransaction(idx = 100, keccak(W1))`. A relayer (which has approved the pool for the fee)
  calls `submitFastWithdrawal(100, W1, [verifierSig])`. The assertions confirm:
  - the user's wallet grows by the full 50,
  - the pool shrinks by `amt50 − feeRaw = 45` (the relayer's 5 fee partially replenishes it),
  - the user's **internal balance is completely unchanged at 100e18** ← this is the unsecured advance,
  - `markedIdxs[100] == true`.

- **Step 2 — settle W2 with the same nonce.** The test builds `W2` (nonce 0, amount 30) and submits it
  through `submitTransactionsChecked` at `idx = nSubmissions = 1`, signed by the sequencer's Schnorr
  key. Processing W2 runs `validateNonce`, which consumes nonce 0 (`getNonce(user)` becomes 1) and
  reverts if the nonce does not match. It then debits the internal balance: 30 for the withdrawal plus
  1 fee, leaving 69e18. On this leg the clearinghouse moves 30 into the pool and the pool forwards 30
  to the user, so the pool is net zero.

- **Step 3 — W1 can no longer settle.** The test re-signs W1 for the next batch idx (2) and submits it.
  Because nonce 0 is already consumed, `validateNonce` reverts with `WN`. The test asserts this
  revert. This is the crux: the sole mechanism that would refill the pool for the fast advance is now
  permanently unreachable.

- **Step 4 — quantify the hole.** Final assertions confirm the pool is short `amt50 − feeRaw = 45`,
  the user's wallet holds `+80`, and the clearinghouse holds only `70` (100 deposit − 30 paid out for
  W2). The user therefore retains a 69e18 internal claim on clearinghouse tokens that the pool no
  longer backs — the shortfall is real and permanent.

**Why the numbers are what they are.** The fast fee is
`max(0.1% × amt, 5 × withdrawFeeX18) / 10^decimals`. With `withdrawFeeX18 = 1e18` ($1) and a 50
withdrawal, that is `max(0.05, 5) = 5` — so the fast payout is 50 with a 5 fee, and the pool's net
outflow is 45. The settlement fee on W2 is the product's `withdrawFeeX18` (1), which is why the
internal balance lands at exactly 69e18.

---

## References

- `src/core/contracts/BaseWithdrawPool.sol` (main vulnerable surface)
- `src/core/contracts/EndpointTx.sol` (`validateNonce`, `chargeFee`, `WithdrawCollateral` branches)
- `src/core/contracts/Clearinghouse.sol` (`handleWithdrawTransfer`, `withdrawCollateral`)
- `src/core/contracts/Verifier.sol` (`txSignatureDigest`, `requireValidTxSignatures`)
- `src/core/contracts/Endpoint.sol` (`submitTransactionsChecked`, `nSubmissions`)
- `src/core/contracts/EndpointStorage.sol` (`nonces`)
- `src/core/contracts/common/Constants.sol` (`FAST_WITHDRAWAL_FEE_RATE`, `MAX_DECIMALS`)
- `src/core/test/N-007-F1-NonceVoid.js` (the PoC)
- Related: `hunt/targets/nado/reports/N-007-F1-report.md` (working notes and variant analysis)
- Ledger: `hunt/targets/nado/findings.md` (N-007)

---

*Verified against `nado-contracts` commit `380b0bc`, `package.json` version `1.3.1`, solc 0.8.13.
PoC green on Hardhat `--network hardhat`, exit status 0.*
