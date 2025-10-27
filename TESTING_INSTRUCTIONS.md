# Testing Instructions for Cetus Price Fallback Fix

## Prerequisites

1. Ensure you have a valid `.env` file with at least:
   ```
   SUI_RPC_MAINNET_PRIMARY=https://sui-mainnet.public.blastapi.io
   SUI_RPC_MAINNET_BACKUP=https://1rpc.io/sui
   SUI_RPC_MAINNET_FALLBACK=https://sui.rpc.grove.city/v1/01fdb492
   ```

2. Build the project:
   ```bash
   npm run build
   ```

## Test 1: find-cetus-fee-pools

This script discovers the 0.05% and 0.25% Cetus pools and displays their prices.

```bash
npm run find-cetus-fee-pools
```

### Expected Output

You should see:
- ✅ Prices around **0.37–0.38 USDC per SUI** for both pools
- ❌ NOT 380,000 USDC/SUI
- ❌ NOT 0.000003 USDC/SUI
- DEBUG logs showing:
  - Pool coin order (A=SUI, B=USDC or A=USDC, B=SUI)
  - sqrt_price_x64 value
  - Both price candidates (one reasonable, one unreasonable)
  - Which candidate was chosen and why

Example good output:
```
[DEBUG] Pool 0x51e883... coin order: A=SUI, B=USDC
[DEBUG] sqrt_price_x64: 354823066636771840
[DEBUG] Price candidates: AisUSDC=2702811.479875, AisSUI=0.369985
[DEBUG] Final price: 0.369985 USDC/SUI
[INFO] Price: 0.369985 USDC per SUI
```

## Test 2: print-spread

This script fetches prices from both pools and calculates the spread.

```bash
npm run spread
```

### Expected Output

You should see:
- ✅ Both prices around **0.37–0.38 USDC per SUI**
- ✅ Spread percentage (typically 0.01% to 0.5%)
- ✅ No sanity check warnings
- DEBUG logs for both pools showing:
  - Coin order
  - sqrt_price_x64
  - Computed price

Example good output:
```
Current Prices (SUI/USDC):
  Cetus 0.05%: 0.373245 USDC per SUI
  Cetus 0.25%: 0.372981 USDC per SUI

Spread Analysis:
  Percentage Spread: 0.0707%
```

## Test 3: simulate

This script simulates a complete arbitrage transaction.

```bash
npm run simulate
```

### Expected Output

You should see:
- ✅ Quote results showing USDC amounts that make sense for your configured flashloan size
- ✅ Direction determined (0.05-to-0.25 or 0.25-to-0.05)
- ✅ Profitability check (may be negative if spread is low, that's OK)
- ✅ No sanity check warnings
- DEBUG logs showing:
  - Prices for both pools
  - Which orientation was chosen

Example good output:
```
=== Quote Results ===
SUI -> USDC (sell with flashloan):
  0.05% pool: 3.732450 USDC
  0.25% pool: 3.729810 USDC

Direction: 0.05-to-0.25
```

## What to Look For

### ✅ Good Signs
- Prices consistently in the 0.35–0.40 range
- Both pools showing similar prices (within 1-2%)
- DEBUG logs showing reasonable candidates
- No sanity warnings

### ❌ Bad Signs (Indicate bug)
- Prices like 380,000 or 0.000003
- Sanity warnings about prices outside [0.01, 5.0]
- Inconsistent prices between pool005 and pool025 (>10% difference)
- Missing DEBUG logs

## Troubleshooting

### If you see network errors:
- Check your RPC endpoints are accessible
- Try alternative RPC providers
- Ensure your firewall isn't blocking connections

### If you see "Pool not found":
- Verify pool IDs in .env match mainnet pools:
  - CETUS_POOL_ID_005=0x51e883ba7c0b566a26cbc8a94cd33eb0abd418a77cc1e60ad22fd9b1f29cd2ab
  - CETUS_POOL_ID_025=0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105

### If prices are still wrong:
- Enable DEBUG level logging
- Check the candidates shown in DEBUG logs
- Verify coin types match expected (SUI and bridged USDC)
- Report the issue with full DEBUG output

## Reporting Results

When reporting test results, please include:
1. Which test(s) you ran
2. The actual prices displayed
3. Any warnings or errors
4. DEBUG log excerpt showing candidate prices
5. Whether prices are now consistent (~0.37-0.38)

## Success Criteria

✅ All three scripts run without errors  
✅ All prices are in the 0.35–0.40 USDC/SUI range  
✅ No more 380k or 0.000003 artifacts  
✅ DEBUG logs show clear decision-making  
✅ Spread between pools is <1% typically  
