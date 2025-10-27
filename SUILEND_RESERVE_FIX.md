# Suilend Reserve Discovery Fix

## Problem

The original implementation assumed Suilend reserves were stored as a vector/array:

```typescript
const reserves = content.fields.reserves || [];
for (let i = 0; i < reserves.length; i++) {
  const reserve = reserves[i];
  // ...
}
```

This caused "Could not find reserve for coin type 0x2::sui::SUI" errors because reserves are actually stored as **dynamic fields in a `0x2::bag::Bag`**, not as a vector.

Additionally, the fee field was incorrectly read as `borrow_fee_bps` when it should be `config.borrow_fee`.

## Solution

The fix properly enumerates reserves using the Sui SDK's dynamic field APIs:

### 1. Extract bagId

```typescript
const reservesBag = content.fields?.reserves;
const bagId = reservesBag.fields.id.id;
```

### 2. Paginate through dynamic fields

```typescript
let allDynamicFields = [];
let hasNextPage = true;
let cursor = null;

while (hasNextPage) {
  const page = await client.getDynamicFields({
    parentId: bagId,
    cursor: cursor || undefined,
  });
  allDynamicFields = allDynamicFields.concat(page.data);
  hasNextPage = page.hasNextPage;
  cursor = page.nextCursor || null;
}
```

### 3. Fetch each dynamic field object

```typescript
for (const field of allDynamicFields) {
  const fieldObject = await client.getDynamicFieldObject({
    parentId: bagId,
    name: {
      type: field.name.type,
      value: field.name.value,
    },
  });
  // Check coin_type and extract config
}
```

### 4. Extract correct fields

```typescript
const reserveFields = fieldContent.fields;
const reserveCoinType = reserveFields?.coin_type;
const configFields = reserveFields?.config?.fields || reserveFields?.config;
const borrowFeeBps = BigInt(configFields?.borrow_fee || '5'); // NOT borrow_fee_bps
const availableAmount = BigInt(reserveFields?.available_amount || '0');
const reserveKey = field.name.value;
```

## Key Changes

1. **Data structure**: Changed from array iteration to Bag dynamic field enumeration
2. **Pagination**: Added support for `hasNextPage` and `nextCursor` to handle large reserve lists
3. **Fee field**: Changed from `config.borrow_fee_bps` to `config.borrow_fee` (in basis points)
4. **Reserve identifier**: Use `field.name.value` as the reserve key/index
5. **Error handling**: Proper fallback in DRY_RUN mode, fail-fast in live mode
6. **Logging**: Enhanced debug logging to troubleshoot dynamic field structure

## Schema Reference

### LendingMarket Structure
```
LendingMarket {
  content.fields.reserves: {
    type: "0x2::bag::Bag",
    fields: {
      id: { id: "0x..." },  // This is the bagId
      size: "N"
    }
  }
}
```

### Reserve Dynamic Field Structure
```
DynamicField {
  name: { type: "u64", value: "0" },  // Reserve index
  objectId: "0x..."
}

ReserveObject {
  data.content.fields: {
    coin_type: "0x2::sui::SUI",
    available_amount: "50000000000000",  // Base units (MIST for SUI)
    config: {
      fields: {
        borrow_fee: "5",  // Basis points (5 = 0.05%)
        open_ltv_pct: "75",
        close_ltv_pct: "80"
      }
    }
  }
}
```

## Testing

Comprehensive tests verify:
- bagId extraction from Bag structure
- Pagination through dynamic fields
- Dynamic field object fetching
- Correct extraction of `config.borrow_fee` (not `borrow_fee_bps`)
- Correct extraction of `available_amount` in base units
- Fee calculations using basis points
- Capacity validation

## Acceptance

✅ Reserve discovery works with Bag dynamic fields
✅ Pagination handles all reserves
✅ Fee field reads `config.borrow_fee` correctly
✅ Available amount reads base units (MIST)
✅ Comprehensive logging for debugging
✅ Documentation updated
✅ Code review passed
✅ Security scan passed (0 alerts)
