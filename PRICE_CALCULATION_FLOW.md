# Cetus Price Calculation Flow

## Before (Inconsistent)

```
Script (find-cetus-fee-pools.ts)
  └─> calculatePrice()
      ├─> String matching: includes('usdc')
      ├─> Single calculation path
      └─> No validation → ❌ Could return 380k or 0.000003

Script (print-spread.ts)
  └─> getCetusPriceByPool()
      └─> calculatePriceFromSqrtPrice()
          ├─> Coin order check: coinTypeA === SUI
          └─> If/else logic → ❌ Could invert or mis-scale
```

## After (Robust)

```
All Scripts
  ├─> find-cetus-fee-pools.ts
  ├─> print-spread.ts (via getCetusPriceByPool)
  └─> simulate.ts (via quote functions)
      │
      └─> NEW: chooseUsdcPerSui() in lib/cetusPrice.ts
          │
          ├─> Has quote price? → Use it directly ✓
          │   └─> Cache orientation for this pool
          │
          └─> No quote? → Compute both candidates
              │
              ├─> computeUsdcPerSuiFromSqrtPrice()
              │   ├─> candidateAisUSDC = 10³ / P
              │   ├─> candidateAisSUI = P × 10³
              │   └─> DEBUG log both
              │
              ├─> Check coin types (exact match on COIN_TYPES)
              │   ├─> A = SUI? → Use candidateAisSUI
              │   └─> A = USDC? → Use candidateAisUSDC
              │
              ├─> Sanity check [0.01, 5.0]
              │   ├─> Only one valid? → Use it
              │   └─> Both valid? → Use cached orientation or closest to 0.37
              │
              └─> Return price with full logging ✓
```

## Key Improvements

1. **Quote-First**: Always prefer SDK quote price when available
2. **Dual Candidates**: Compute both possibilities, choose intelligently
3. **Orientation Cache**: Remember which candidate matched the quote
4. **Sanity Validation**: Guard against obviously wrong values
5. **DEBUG Logging**: Full visibility into decision process
6. **Single Source**: One function used everywhere

## Math Verification

For USDC/SUI = 0.37:

### Pool: A=SUI, B=USDC
```
P = sqrt_price² = USDC_raw / SUI_raw
USDC/SUI = P × 10³ = 0.37 ✓
```

### Pool: A=USDC, B=SUI  
```
P = sqrt_price² = SUI_raw / USDC_raw
USDC/SUI = 10³ / P = 0.37 ✓
```

Both formulas verified with unit tests.
