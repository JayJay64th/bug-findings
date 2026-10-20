# N-006b — MintNlp/BurnNlp Price Fields Not Covered by EIP-712 Signature (Confirmed)

**Date:** 2026-10-08
**Status:** confirmed
**Class:** signature-coverage-gap / oracle-price-manipulation
**Severity lean:** High
**Target:** Nado Core (`github.com/nadohq/nado-contracts`)
**Test:** code-path analysis (no state-changing PoC — Law 10: present before prove)

---

## Summary

`MintNlp` and `BurnNlp` EIP-712 signatures cover only `(sender, quoteAmount|nlpAmount, nonce)`. The fields `oraclePriceX18` and `nlpPoolRebalanceX18` sit outside the signed struct and are read unconditionally by `processTransactionImpl`. A malicious sequencer (or frontend) can set an arbitrary positive price after the user signs, minting or burning NLP at a manipulated rate and stealing value from existing LPs.

**Invariant violated:** The exchange rate for a user-signed mint/burn must be committed by the user's signature.

---

## Economic Event

User signs `MintNlp(sender, quoteAmount, nonce)` intending to mint NLP at the current fair NAV. The transaction bytes carry an unsigned `oraclePriceX18` that determines `nlpAmount = quoteAmount.div(oraclePriceX18)`. The same applies in reverse for `BurnNlp`.

---

## Trace

```
USER SIGNS EIP-712 (Verifier.sol:35-38, :427-439)
  MINT_NLP_SIGNATURE = "MintNlp(bytes32 sender,uint128 quoteAmount,uint64 nonce)"
  digest covers: sender, quoteAmount, nonce
  DOES NOT COVER: oraclePriceX18, nlpPoolRebalanceX18

ASSEMBLER SETS UNSIGNED FIELDS (IEndpoint.sol:118-123)
  SignedMintNlp {
    MintNlp tx;              // signed
    bytes signature;         // signed
    int128 oraclePriceX18;   // UNSIGNED
    int128[] nlpPoolRebalanceX18; // UNSIGNED
  }

SEQUENCER SUBMITS (Endpoint.sol:288-323)
  processTransaction → processTransactionImpl (EndpointTx.sol:547-566)
  1. validateSignedTx(sender, nonce, transaction, signature, true)  // PASSES — sig covers only 3 fields
  2. priceX18[NLP_PRODUCT_ID] = signedTx.oraclePriceX18             // WRITES UNSIGNED PRICE
  3. clearinghouse.mintNlp(tx, oraclePriceX18, nlpPools, nlpPoolRebalanceX18)

CLEARINGHOUSE.MINTNLP (Clearinghouse.sol:459-479)
  spotEngine.updatePrice(NLP_PRODUCT_ID, oraclePriceX18)  // NO positivity check (BaseEngine.sol:296-298)
  nlpAmount = quoteAmount.div(oraclePriceX18)               // MathSD21x18.div, only rejects y==0
  spotEngine.updateBalance(NLP_PRODUCT_ID, sender, nlpAmount)
```

---

## Root Cause

The EIP-712 typehash `MINT_NLP_SIGNATURE` / `BURN_NLP_SIGNATURE` omits `oraclePriceX18` and `nlpPoolRebalanceX18`. These fields determine the economic outcome of the mint/burn but are not committed by the user's signature. `BaseEngine.updatePrice` (called with the unsigned price) has no positivity check, unlike `Clearinghouse.updatePrice` (Clearinghouse.sol:373) which requires `priceX18 > 0`.

---

## Numeric Trace (Mint dilution)

Fair NLP price: `1e18` (1 NLP per 1 quote, X18).

User signs `MintNlp(sender, quoteAmount=1000e18, nonce=1)`.

| Scenario | oraclePriceX18 | nlpAmount = quoteAmount.div(price) | User receives | Fair would be |
|---|---|---|---|---|
| Honest | `1e18` | `1000e18 * 1e18 / 1e18 = 1000e18` | 1000 NLP | 1000 NLP |
| Manipulated | `1e15` (fair/1000) | `1000e18 * 1e18 / 1e15 = 1000e21` | 1,000,000 NLP | 1000 NLP |

User mints 1000× more NLP than fair. Existing LPs diluted by factor 1000×.

## Numeric Trace (Burn extraction)

Fair NLP price: `1e18`. User holds 1000 NLP.

User signs `BurnNlp(sender, nlpAmount=1000e18, nonce=1)`.

| Scenario | oraclePriceX18 | quote returned (reverse of div) | Fair quote |
|---|---|---|---|
| Honest | `1e18` | 1000 quote | 1000 quote |
| Manipulated | `1e21` (fair×1000) | 1,000,000 quote | 1000 quote |

User extracts 1000× more quote than fair. Pool drained.

---

## Involved Contracts, Functions, and Lines

| Contract | Function | Lines | Role |
|---|---|---|---|
| `Verifier.sol` | typehash constants | 35-38 | Omit price/rebalance from EIP-712 |
| `Verifier.sol` | `computeDigest` | 427-452 | Encodes only 3 fields for Mint/Burn |
| `IEndpoint.sol` | `SignedMintNlp` / `SignedBurnNlp` | 118-136 | Price fields outside signed struct |
| `EndpointTx.sol` | `processTransactionImpl` | 547-586 | Reads unsigned price, writes `priceX18[NLP]` |
| `Clearinghouse.sol` | `mintNlp` / `burnNlp` | 459-520 | Uses unsigned price for exchange |
| `BaseEngine.sol` | `updatePrice` | 296-298 | No positivity check (contrast Clearinghouse.sol:373) |

---

## Attacker Model

**Who:** Any user with a valid linked signer, or a malicious sequencer/frontend that modifies transaction bytes after the user signs.

**Capability needed:** Ability to submit or modify `MintNlp`/`BurnNlp` transaction bytes. The user's signature remains valid because it only covers `(sender, amount, nonce)`.

**Prerequisite:** None — no admin action, no special role. Any LP's NLP can be diluted.

---

## Impact

- **Mint path:** Attacker mints NLP at an arbitrarily favorable (low) positive price, diluting all existing NLP holders. Value extracted = (fair_amount − manipulated_amount) × quote_value.
- **Burn path:** Attacker burns NLP at an arbitrarily favorable (high) positive price, extracting excess quote from the pool. Value extracted = manipulated_quote − fair_quote.

Both are direct fund theft / dilution. Severity: High.

---

## Fix

Add `oraclePriceX18` and `nlpPoolRebalanceX18` to the EIP-712 typehash and `computeDigest` for both `MintNlp` and `BurnNlp`:

```
MINT_NLP_SIGNATURE = "MintNlp(bytes32 sender,uint128 quoteAmount,uint64 nonce,int128 oraclePriceX18,int128[] nlpPoolRebalanceX18)"
BURN_NLP_SIGNATURE = "BurnNlp(bytes32 sender,uint128 nlpAmount,uint64 nonce,int128 oraclePriceX18,int128[] nlpPoolRebalanceX18)"
```

Also add `require(oraclePriceX18 > 0)` in `Clearinghouse.mintNlp`/`burnNlp` (defense in depth, matching `Clearinghouse.updatePrice`).

---

## Related Findings

- **N-012:** Same class — `WithdrawCollateralV2` `feeX18` unsigned.
- **N-006:** Earlier lead on user-supplied oracle price (subsumed by this).
