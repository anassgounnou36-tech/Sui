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
    │    PRIMARY: TypeName   │
    │    fields.coin_type    │
    │    .fields.name        │
    │                        │
    │ 2. FALLBACK: Parse     │
    │    from reserve.type:  │
    │    /::reserve::        │
    │    Reserve<(.+)>$/     │
    │                        │
    │ 3. Normalize both      │
    │    reserve & target    │
    │    coin types          │
    │                        │
    │ 4. Compare normalized  │
    │    strings             │
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

### 1. Type Parsing
- **Primary Method**: Read from `fields.coin_type.fields.name` (TypeName struct)
- **Fallback**: Parse `reserve.type` using regex `/::reserve::Reserve<(.+)>$/`
- **Example**: `...::Reserve<0x2::sui::SUI>` → `0x2::sui::SUI`

### 2. Type Normalization (NEW)
- **Problem**: Mainnet returns padded addresses like `0000...002::sui::SUI` vs `0x2::sui::SUI`
- **Solution**: `normalizeTypeForCompare()` function:
  - Strips `0x` prefix
  - Removes leading zeros from addresses
  - Lowercases all parts
  - Example: Both `0x2::sui::SUI` and `0000...002::sui::SUI` → `2::sui::sui`
- **Result**: Reliable matching across different address formats

### 3. Enhanced Logging
- Market field keys (one-time diagnostic)
- First 3 reserve types with raw and normalized versions
- Normalized match comparison shown in results
- Sample repay calculation for demonstration
- Error messages include unique normalized types for debugging

### 4. Conditional Paths
- **Vector Path**: Used when `reserves` is an array (PREFERRED)
- **Bag Path**: Used when `reserves` is not an array (FALLBACK)
- No hard failure if Bag ID missing when vector exists
- Both paths use normalized comparison

### 5. Backward Compatibility
- Fallback to `fields.coin_type` still works
- All existing function signatures unchanged
- Compat aliases maintained (reserveIndex, borrowFeeBps)

## Example Log Output

### Successful Discovery (Vector Path)
```
[Suilend] Market object fields: reserves, config, rate_limiter, fee_receiver
[Suilend] Using vector-based discovery: 42 reserves found
[Suilend] DEBUG - First 3 reserve coin types (raw and normalized):
  Reserve[0] raw: 0000000000000000000000000000000000000000000000000000000000000002::sui::SUI
  Reserve[0] normalized: 2::sui::sui
  Reserve[1] raw: 5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN
  Reserve[1] normalized: 5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::coin
  Reserve[2] raw: af8cd5edc19637e05da0dd46f6ddb1a8b81cc532fcccf6d5d41ba77bba6eddd5::coin::COIN
  Reserve[2] normalized: af8cd5edc19637e05da0dd46f6ddb1a8b81cc532fcccf6d5d41ba77bba6eddd5::coin::coin
[Suilend] Target coin type: 0x2::sui::SUI
[Suilend] Target normalized: 2::sui::sui
✓ Found Suilend reserve for 0x2::sui::SUI (Vector match)
  Reserve index: 0
  Match method: TypeName
  Raw coin type: 0000000000000000000000000000000000000000000000000000000000000002::sui::SUI
  Normalized match: 2::sui::sui == 2::sui::sui
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
  Raw coin type: 0000000000000000000000000000000000000000000000000000000000000002::sui::SUI
  Normalized match: 2::sui::sui == 2::sui::sui
  Fee: 5 bps (0.05%)
  Available: 1234567.89 SUI
```

### Reserve Not Found (with diagnostics)
```
[Suilend] Using vector-based discovery: 42 reserves found
[Suilend] Target coin type: 0x2::sui::SUI
[Suilend] Target normalized: 2::sui::sui
Could not find reserve for coin type 0x2::sui::SUI (normalized: 2::sui::sui) in Suilend reserves vector (searched 42 reserves)
Available normalized types: 2::sui::sui, 5d4b...::coin::coin, af8cd...::coin::coin, ...
Available raw types (first 5): 0000...002::sui::SUI, 5d4b...::coin::COIN, ...
```

## Error Handling

### Vector Path Not Found
- Logs warning with reserve count and normalized types
- Shows unique normalized types for debugging
- Shows first 5 raw types for reference
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

1. ✅ Coin type normalization (14 test cases)
   - Standard 0x-prefixed addresses
   - 64-hex padded addresses (mainnet format)
   - Leading zeros removal
   - Case normalization
   - Multi-part type paths
2. ✅ Type parsing from TypeName (primary)
3. ✅ Fallback parsing from reserve.type
4. ✅ Normalized reserve matching logic
5. ✅ Fee extraction (multiple paths)
6. ✅ Available amount extraction
7. ✅ Sample repay calculations
8. ✅ ReserveConfig structure
9. ✅ Backward compatibility aliases
10. ✅ Vector vs Bag detection logic

All tests pass ✓
