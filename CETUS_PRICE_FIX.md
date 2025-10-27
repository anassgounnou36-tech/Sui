# Cetus Price Calculation Fix

## Summary
This update fixes the Cetus price orientation/decimals issue and unifies price/quote logic across all scripts (find-cetus-fee-pools, print-spread, and simulate).

## Problem
The codebase had inconsistent price calculations that led to contradictory prices like 373,xxx USDC/SUI vs 0.000003 USDC/SUI. This was caused by:
1. Different price calculation logic in each script
2. Incorrect handling of token order (Pool<SUI, USDC> vs Pool<USDC, SUI>)
3. Missing or incorrect decimal normalization (SUI=9 decimals, USDC=6 decimals)

## Solution

### 1. Shared Price Helper (`src/lib/cetusPrice.ts`)
Created a centralized module with two main functions:

#### `getUsdcPerSuiFromPoolState()`
Calculates USDC per SUI from raw pool state with proper token order handling:

- **For Pool<USDC, SUI>** (coin A = USDC, coin B = SUI):
  ```
  price_USDC_per_SUI = (sqrtP)^2 * 10^(6-9) = (sqrtP)^2 * 0.001
  ```

- **For Pool<SUI, USDC>** (coin A = SUI, coin B = USDC):
  ```
  price_SUI_per_USDC = (sqrtP)^2 * 10^(9-6) = (sqrtP)^2 * 1000
  price_USDC_per_SUI = 1 / price_SUI_per_USDC
  ```

Where `sqrtP = sqrt_price_x64 / 2^64`

**Sanity Check**: Ensures price is within [0.01, 5.0] USDC/SUI range, throwing explicit error with coin order and raw values if violated.

#### `getExecutablePriceUsdcPerSui()`
Quote-first approach that:
1. Attempts to get SDK exact-in quote (fee-inclusive) at configured flashloan size
2. Falls back to on-chain sqrt_price calculation if SDK unavailable
3. Returns consistent USDC per SUI price

### 2. Updated Scripts

#### `find-cetus-fee-pools.ts`
- Now uses `getUsdcPerSuiFromPoolState()` instead of custom calculation
- Displays consistent "X.XXXXXX USDC per SUI" format

#### `print-spread.ts`
- Uses `getExecutablePriceUsdcPerSui()` for quote-based prices
- Shows: "Strategy=Cetus fee-tier arb; Flashloan asset=SUI; Expected USDC type=bridged"

#### `simulate.ts`
- Displays current prices using `getExecutablePriceUsdcPerSui()` before simulation
- Shows consistent USDC per SUI across both pools

### 3. Fixed Swap Direction Logic (`src/cetusIntegration.ts`)

Updated `quoteCetusPoolSwapA2B()` and `quoteCetusPoolSwapB2A()` to correctly handle different pool coin orderings:

- **A2B** (coin A to coin B):
  - If Pool<SUI, USDC>: SUI → USDC
  - If Pool<USDC, SUI>: USDC → SUI

- **B2A** (coin B to coin A):
  - If Pool<SUI, USDC>: USDC → SUI
  - If Pool<USDC, SUI>: SUI → USDC

Each function now:
1. Determines if coin A/B is SUI or USDC
2. Applies correct formula based on direction
3. Adjusts slippage limits appropriately

## Verification

Run the formula verification test:
```bash
npm run build
node dist/scripts/test-formula.js
```

This validates:
- Correct calculation for both Pool<SUI, USDC> and Pool<USDC, SUI>
- Proper decimal adjustments
- Sanity bound enforcement
- Mathematical accuracy (< 0.01 error)

## Key Benefits

1. **Consistency**: All scripts now display the same USDC per SUI price format
2. **Accuracy**: Proper token order and decimal handling prevents inverted/incorrect prices
3. **Maintainability**: Single source of truth for price calculations
4. **Safety**: Sanity checks prevent execution with implausible prices
5. **Flexibility**: Quote-first approach with sqrt_price fallback

## Mathematical Reference

For Cetus CLMM pools, the sqrt_price represents:
```
sqrt_price_x64 = sqrt(price_A_per_B * 10^(decimals_A - decimals_B)) * 2^64
```

To get USDC per SUI:
1. Extract sqrt_price = sqrt_price_x64 / 2^64
2. Calculate price_A_per_B = sqrt_price^2 / 10^(decimals_A - decimals_B)
3. Convert to USDC per SUI based on which coin is A and which is B
