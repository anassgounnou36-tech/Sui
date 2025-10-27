# Cetus Price Fallback Hotfix

## Problem Summary

Intermittent, inconsistent prices appeared when computing USDC/SUI from CLMM sqrt_price_x64 depending on pool coin order and decimal normalization. Observed outputs included:
- 380,124 USDC/SUI (clearly wrong - inverted)
- 0.000003 USDC/SUI (clearly wrong - mis-scaled)

Expected: ~0.37–0.38 USDC/SUI

## Root Cause

The original price calculation logic in `find-cetus-fee-pools.ts` and elsewhere had ambiguity issues:
1. Coin order detection was based on string matching (`includes('usdc')`)
2. No validation that both candidate prices were computed
3. No caching of orientation decisions between quotes
4. Fallback math could invert or mis-scale depending on pool setup

## Solution

### 1. New Robust Helper Library (`src/lib/cetusPrice.ts`)

Created a centralized helper with:

#### `computeUsdcPerSuiFromSqrtPrice()`
- Computes BOTH candidate prices for any sqrt_price:
  - `candidateAisUSDC`: Price assuming coin A is USDC, coin B is SUI
  - `candidateAisSUI`: Price assuming coin A is SUI, coin B is USDC
- Uses correct formulas:
  - If A=SUI, B=USDC: `USDC/SUI = P * 10^3` where `P = sqrt_price^2`
  - If A=USDC, B=SUI: `USDC/SUI = 10^3 / P` where `P = sqrt_price^2`
- Validates against sanity band [0.01, 5.0]
- Returns both candidates plus chosen method

#### `chooseUsdcPerSui()`
- Quote-first: Uses SDK quote price directly when available
- Caches per-pool orientation for 1 minute when quote is available
- Falls back to computed candidates with:
  - Coin type checking (exact match on COIN_TYPES constants)
  - Sanity validation (only one candidate in range → use it)
  - Conservative default (closest to expected center if ambiguous)
- Comprehensive DEBUG logging

### 2. Integration Changes

#### `src/cetusIntegration.ts`
- Updated `getCetusPriceByPool()` to use `chooseUsdcPerSui()`
- Added DEBUG logging for:
  - Pool ID
  - Coin order (A, B with human-readable names)
  - sqrt_price_x64 value
  - Final computed price

This function is called by:
- `quoteCetusPoolSwapB2A()` - USDC → SUI swaps
- `quoteCetusPoolSwapA2B()` - SUI → USDC swaps
- `scripts/print-spread.ts` - Price display
- `src/index.ts` - Main bot loop

#### `scripts/find-cetus-fee-pools.ts`
- Replaced old `calculatePrice()` function with call to `chooseUsdcPerSui()`
- Added DEBUG logging for coin order and sqrt_price

### 3. Price Calculation Details

The math for CLMM pools:
```
sqrt_price_x64 represents: sqrt(amount_B_raw / amount_A_raw) * 2^64
P = (sqrt_price_x64 / 2^64)^2 = amount_B_raw / amount_A_raw
```

For SUI (9 decimals) and USDC (6 decimals):

**Case 1: Pool has A=SUI, B=USDC**
- P = USDC_raw / SUI_raw
- USDC_std / SUI_std = P * 10^(9-6) = P * 10^3

**Case 2: Pool has A=USDC, B=SUI**
- P = SUI_raw / USDC_raw  
- USDC_std / SUI_std = 10^3 / P

### 4. Testing

Created unit tests (`test-price-calculation.ts`) to verify:
- Correct price calculation for both coin orders
- Quote-first behavior returns quote directly
- Fallback computes reasonable price within [0.35, 0.40]
- Orientation caching works correctly

All tests passed with calculated sqrt_price values.

## Benefits

1. **Unambiguous**: Always computes both candidates, clearly shows which was chosen
2. **Self-validating**: Sanity checks catch inverted or mis-scaled prices
3. **Quote-first**: Prefers SDK quotes, only falls back when necessary
4. **Cached orientation**: Remembers which candidate matched the quote for future fallbacks
5. **Observable**: DEBUG logs show all intermediate values for diagnosis
6. **Consistent**: Single source of truth used across all scripts

## Acceptance Criteria

✅ Math verified with unit tests for both coin orders  
✅ Quote-first implemented with orientation caching  
✅ DEBUG logging added throughout  
✅ Sanity band [0.01, 5.0] enforced  
✅ find-cetus-fee-pools uses new helper  
✅ print-spread uses new helper (via getCetusPriceByPool)  
✅ simulate uses new helper (via quote functions)  

🔄 Manual testing with live RPC blocked by network restrictions in test environment

## Expected Behavior

When running scripts:
- `npm run find-cetus-fee-pools` should print ~0.37–0.38 USDC/SUI for both pools
- `npm run spread` should show consistent prices using quote-first
- `npm run simulate` should log which orientation was locked per pool
- No more 380k or 0.000003 price artifacts
