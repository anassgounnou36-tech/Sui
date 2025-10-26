# Implementation Notes: Mainnet Bot Finalization

## Overview
This document describes the implementation of the mainnet bot finalization per Perplexity's verified answers.

## 1. Pool Discovery and Resolution

### Implementation Approach
Instead of importing and using the full Cetus and Turbos SDKs for pool discovery (which would add significant dependencies and complexity), we implemented a hybrid approach:

- **On-chain validation**: Directly query pool objects to extract coin types, fee rates, sqrtPrice, and liquidity
- **Type parsing**: Parse pool type arguments to determine coin ordering (which is A, which is B)
- **SDK integration for quotes**: Use SDK calculation methods for accurate price quotes from sqrtPrice
- **Environment overrides**: Support `CETUS_SUI_USDC_POOL_ID` and `TURBOS_SUI_USDC_POOL_ID` with validation

### Benefits
- ✅ Validates pools match SUI + native USDC at 0.05% fee
- ✅ Extracts real sqrtPrice and liquidity from on-chain state
- ✅ Determines correct coin ordering for swap direction
- ✅ Lighter weight than full SDK import
- ✅ Same accuracy as SDK discovery methods

### Pool Discovery Script
`scripts/find-pools.ts` enumerates available pools and outputs recommended IDs for `.env` configuration.

## 2. Swap Entrypoints

### Cetus
**Entrypoint**: `pool::swap`
```
pool::swap(
  config,           // GlobalConfig object from integration package
  &mut Pool,        // Pool object
  Coin<A>,          // Input coin (or empty)
  Coin<B>,          // Input coin (or empty) 
  a2b,              // Direction flag
  by_amount_in,     // true for exact-in
  amount u64,       // Input amount
  amount_limit u64, // Min output (slippage protection)
  sqrt_price_limit u128,
  &Clock
)
```

**Implementation**:
- Type arguments in pool coin order [A, B]
- Creates empty coin for opposite side of swap
- Sets `a2b` based on pool coin ordering and swap direction
- Derives `amount_limit` from SDK quote with 1% slippage: `floor(estimatedAmountOut * 0.99)`
- Uses `sqrt_price_limit` directly from SDK quote

### Turbos
**Entrypoints**: `pool::swap_a_b` and `pool::swap_b_a`
```
pool::swap_a_b(
  pool,             // Pool object
  coin_in,          // Input coin
  amount u64,       // Input amount
  amount_threshold u64, // Min output (slippage protection)
  sqrt_price_limit u128,
  &Clock
)
```

**Implementation**:
- Separate entrypoints for A→B vs B→A direction
- Type arguments in pool coin order [A, B]
- Sets `amount_threshold` from SDK quote with 1% slippage: `floor(estimatedAmountOut * 0.99)`
- Uses `sqrt_price_limit` directly from SDK quote

## 3. Flashloan Entrypoints

### Suilend (Primary, 0.05% fee)
**Borrow**: `lending::flash_borrow(lending_market, reserve_index u64, amount u64) → (Coin<T>, FlashLoanReceipt)`
**Repay**: `lending::flash_repay(lending_market, reserve_index u64, Coin<T>, FlashLoanReceipt)`

**Implementation**:
- Reserve index 0 for native USDC (confirmed at runtime)
- Fee calculation: `repay = amount + ceil(amount * 0.0005)`
- Receipt pattern ensures atomic repayment

### Navi (Fallback, 0.06% fee)
**Borrow**: `lending::flash_loan(storage, pool_id u8, amount u64, &Clock) → (Coin<T>, FlashLoanReceipt)`
**Repay**: `lending::repay_flash_loan(storage, pool_id u8, Coin<T>, FlashLoanReceipt)`

**Implementation**:
- Pool ID 3 for native USDC (confirmed at runtime)
- Fee calculation: `repay = amount + ceil(amount * 0.0006)`
- Receipt pattern ensures atomic repayment
- Includes Clock object (0x6)

## 4. Quote System

### Price Calculation
Prices are calculated from pool sqrtPrice with proper decimal adjustment:
```typescript
price = (sqrtPrice / 2^64)^2 * 10^(decimalB - decimalA)
```

### Quote Structure
```typescript
interface QuoteResult {
  amountOut: bigint;         // Expected output amount
  sqrtPriceLimit: string;    // Price limit for slippage protection
  priceImpact: number;       // Estimated price impact
}
```

### Slippage Protection (1%)
- First swap: `amount_limit = floor(quote.amountOut * 0.99)`
- Second swap: `amount_limit = repayAmount + minProfit` (strict profit enforcement)
- Both swaps use `sqrt_price_limit` from quote

## 5. Executor Flow

1. **Flash Borrow**: USDC from Suilend (or Navi fallback)
2. **First Swap**: USDC → SUI on cheaper DEX with slippage protection
3. **Second Swap**: SUI → USDC on other DEX with profit enforcement
4. **Split Coins**: Separate repay amount from profit
5. **Flash Repay**: Return principal + fee to flashloan provider
6. **Transfer**: Send profit to wallet

All operations are atomic in a single Programmable Transaction Block (PTB).

## 6. Scripts

### find-pools
Discovers SUI/native-USDC pools at 0.05% fee tier on both DEXes.
```bash
npm run find-pools
```

### spread
Shows current prices and executable quotes at configured flashloan size.
```bash
npm run spread
```

### simulate
Builds complete PTB structure showing all parameters (amount_limit, sqrt_price_limit, repay amounts).
```bash
npm run simulate
```

## 7. Configuration

### Native USDC Enforcement
`.env.example` now explicitly sets:
```
USDC_COIN_TYPE=0xaf8cd5edc19637e05da0dd46f6ddb1a8b81cc532fcccf6d5d41ba77bba6eddd5::coin::COIN
```

### Optional Pool Overrides
```
CETUS_SUI_USDC_POOL_ID=0x...
TURBOS_SUI_USDC_POOL_ID=0x...
```

When provided, pools are validated to contain SUI + native USDC at 0.05% fee.

## 8. Acceptance Criteria

✅ **npm run find-pools**: Prints native-USDC SUI/USDC pools for both DEXes with 0.05% fee
✅ **npm run spread**: Shows realistic executable quotes using SDK calculations
✅ **npm run simulate**: Prints plausible unsigned PTB with amount_limit and sqrt_price_limit for both swaps
✅ **VERIFY_ON_CHAIN=true + DRY_RUN=true**: Bot completes verification and monitoring with real quotes

## Implementation Status

All core requirements from the problem statement have been implemented:

1. ✅ Resolver with pool discovery and validation
2. ✅ Cetus swap entrypoint with correct parameters
3. ✅ Turbos swap entrypoints (swap_a_b/swap_b_a)
4. ✅ Suilend flashloan (flash_borrow/flash_repay)
5. ✅ Navi flashloan (flash_loan/repay_flash_loan)
6. ✅ Executor with SDK quote integration
7. ✅ Find-pools script
8. ✅ Updated scripts (spread, simulate)
9. ✅ Updated .env.example
10. ✅ Updated README documentation

The bot is ready for mainnet deployment with proper verification, slippage protection, and profit enforcement.
