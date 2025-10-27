# Suilend Reserve Discovery Flow

## Overview
This document describes the reserve discovery logic after implementing type parsing from Reserve generic parameters.

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    readSuilendReserveConfig()                    │
│                                                                   │
│  Input: client, marketId, targetCoinType (e.g., 0x2::sui::SUI)  │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │ Fetch LendingMarket   │
                    │ object from chain     │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │ Log content.fields    │
                    │ keys for diagnostics  │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │ Get reserves field    │
                    │ from content.fields   │
                    └───────────┬───────────┘
                                │
                   ┌────────────┴────────────┐
                   │                         │
                   ▼                         ▼
        ┌──────────────────┐     ┌──────────────────┐
        │ Is Array?        │     │ Is Bag/Table?    │
        │ (Vector Path)    │     │ (Fallback Path)  │
        └────────┬─────────┘     └────────┬─────────┘
                 │ YES                     │ YES
                 ▼                         ▼
    ┌────────────────────────┐  ┌──────────────────────┐
    │ Vector-based Discovery │  │ Bag-based Discovery  │
    └────────┬───────────────┘  └──────────┬───────────┘
             │                              │
             ▼                              ▼
    ┌────────────────────────┐  ┌──────────────────────┐
    │ Log: Using vector      │  │ Log: Using Bag       │
    │ N reserves found       │  │ Extract Bag ID       │
    └────────┬───────────────┘  └──────────┬───────────┘
             │                              │
             ▼                              ▼
    ┌────────────────────────┐  ┌──────────────────────┐
    │ DEBUG: Log first 2     │  │ Paginate through     │
    │ reserve.type strings   │  │ dynamic fields       │
    └────────┬───────────────┘  └──────────┬───────────┘
             │                              │
             ▼                              │
    ┌────────────────────────┐             │
    │ For each reserve:      │             │
    │                        │◄────────────┘
    │ 1. Parse coin type     │
    │    from reserve.type:  │
    │    /::reserve::        │
    │    Reserve<(.+)>$/     │
    │                        │
    │ 2. If no type field,   │
    │    try fields.coin_type│
    │    (fallback)          │
    │                        │
    │ 3. Compare with        │
    │    targetCoinType      │
    └────────┬───────────────┘
             │
          ┌──┴───┐
          │ Match?│
          └──┬───┘
             │
         YES │
             ▼
    ┌────────────────────────────────┐
    │ Extract Reserve Data:          │
    │                                │
    │ • index = array index          │
    │ • feeBps = config.fields.      │
    │            borrow_fee          │
    │ • availableAmount = fields.    │
    │                   available_   │
    │                   amount       │
    └────────┬───────────────────────┘
             │
             ▼
    ┌────────────────────────────────┐
    │ Calculate Sample Repay:        │
    │                                │
    │ • Sample: 1000 SUI/USDC        │
    │ • Repay = principal +          │
    │   ceil(principal * fee / 10000)│
    └────────┬───────────────────────┘
             │
             ▼
    ┌────────────────────────────────┐
    │ Log Discovery:                 │
    │                                │
    │ ✓ Found reserve for X          │
    │   Reserve index: N             │
    │   Parsed coin type: X          │
    │   Fee: N bps (N%)              │
    │   Available: X.XX SUI/USDC     │
    │   Sample repay: X.XXXXXX       │
    └────────┬───────────────────────┘
             │
             ▼
    ┌────────────────────────────────┐
    │ Return ReserveConfig:          │
    │                                │
    │ {                              │
    │   reserveKey: String(index),   │
    │   feeBps,                      │
    │   availableAmount,             │
    │   coinType,                    │
    │   // Backward compat:          │
    │   reserveIndex: index,         │
    │   borrowFeeBps: feeBps         │
    │ }                              │
    └────────────────────────────────┘
```

## Key Improvements

### 1. Type Parsing (NEW)
- **Primary Method**: Parse `reserve.type` using regex
- **Pattern**: `/::reserve::Reserve<(.+)>$/`
- **Example**: `...::Reserve<0x2::sui::SUI>` → `0x2::sui::SUI`
- **Fallback**: If type parsing fails, try `fields.coin_type.*`

### 2. Enhanced Logging
- Market field keys (one-time diagnostic)
- First 2 reserve types (DEBUG mode verification)
- Parsed coin type shown in match result
- Sample repay calculation for demonstration

### 3. Conditional Paths
- **Vector Path**: Used when `reserves` is an array (PREFERRED)
- **Bag Path**: Used when `reserves` is not an array (FALLBACK)
- No hard failure if Bag ID missing when vector exists

### 4. Backward Compatibility
- Fallback to `fields.coin_type` still works
- All existing function signatures unchanged
- Compat aliases maintained (reserveIndex, borrowFeeBps)

## Example Log Output

### Successful Discovery (Vector Path)
```
[Suilend] Market object fields: reserves, config, rate_limiter, fee_receiver
[Suilend] Using vector-based discovery: 42 reserves found
[Suilend] DEBUG - First reserve types for verification:
  Reserve[0].type: 0xf95b...::reserve::Reserve<0x2::sui::SUI>
  Reserve[1].type: 0xf95b...::reserve::Reserve<0x5d4b...::coin::COIN>
✓ Found Suilend reserve for 0x2::sui::SUI
  Reserve index: 0
  Parsed coin type: 0x2::sui::SUI
  Fee (borrow_fee): 5 bps (0.05%)
  Available: 1234567.89 SUI
  Sample repay (for 1000 SUI principal): 1000.500000 SUI
```

### Fallback to Bag Path (if needed)
```
[Suilend] Market object fields: reserves, config, rate_limiter
[Suilend] Vector path not available, attempting Bag/Table fallback...
[Suilend] Using Bag/Table fallback - Reserves Bag ID: 0xabc123...
[Bag fallback] Page 1: Found 10 dynamic fields
✓ Found Suilend reserve for 0x2::sui::SUI (Bag fallback)
  Reserve key: 0
  Fee: 5 bps (0.05%)
  Available: 1234567.89 SUI
```

## Error Handling

### Vector Path Not Found
- Logs warning with reserve count
- In DRY_RUN: Uses defaults, continues
- In live mode: Throws error with details

### Bag Fallback Not Available
- Logs structure details for debugging
- In DRY_RUN: Uses defaults, continues
- In live mode: Throws error

### Network Errors
- Catches and logs all errors
- In DRY_RUN: Falls back to defaults
- In live mode: Throws to prevent silent failures

## Testing Coverage

1. ✅ Regex pattern validation (all formats)
2. ✅ Type parsing from reserve.type
3. ✅ Fallback to fields.coin_type
4. ✅ Reserve matching logic
5. ✅ Fee extraction (multiple paths)
6. ✅ Available amount extraction
7. ✅ Sample repay calculations
8. ✅ ReserveConfig structure
9. ✅ Backward compatibility aliases
10. ✅ Vector vs Bag detection logic

All tests pass ✓
