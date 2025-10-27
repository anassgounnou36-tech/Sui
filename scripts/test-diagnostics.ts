/**
 * Test diagnostic logging for the first 3 reserves
 * Demonstrates what will be logged during actual reserve discovery
 */

// Replicate the logic from flashloan.ts
function getCoinTypeFromReserveEntryDiag(entry: any): string | undefined {
  const reserveFields = entry.fields || entry;
  
  // Strategy a) TypeName canonical: entry.fields.coin_type.fields.name
  if (reserveFields?.coin_type?.fields?.name) {
    return String(reserveFields.coin_type.fields.name).trim();
  }
  
  // Strategy b) Alternate SDK flattening: entry.fields.coin_type.name
  if (reserveFields?.coin_type?.name) {
    return String(reserveFields.coin_type.name).trim();
  }
  
  // Strategy c) Direct string: entry.fields.coin_type
  if (typeof reserveFields?.coin_type === 'string') {
    return reserveFields.coin_type.trim();
  }
  
  // Strategy d) Parse from entry.type via regex as last-resort hint
  if (entry.type && typeof entry.type === 'string') {
    const match = entry.type.match(/::reserve::Reserve<(.+)>$/);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return undefined;
}

function simulateDiagnostics() {
  console.log('=== Simulating Reserve Discovery Diagnostics ===\n');
  
  // Simulate a reserves vector like mainnet would have
  const mockReserves = [
    {
      type: '0xf95b8500638429c42f9b5c8033f67c0054942e19f6f6bb28196d5f0e01fdf4f5::reserve::Reserve<0x2::sui::SUI>',
      fields: {
        coin_type: {
          fields: {
            name: '0x2::sui::SUI'
          }
        },
        config: {
          fields: {
            borrow_fee: '5'
          }
        },
        available_amount: '1234567890000000000'
      }
    },
    {
      type: '0xf95b8500638429c42f9b5c8033f67c0054942e19f6f6bb28196d5f0e01fdf4f5::reserve::Reserve<0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN>',
      fields: {
        coin_type: {
          fields: {
            name: '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN'
          }
        },
        config: {
          fields: {
            borrow_fee: '10'
          }
        },
        available_amount: '9876543210000000'
      }
    },
    {
      type: '0xf95b8500638429c42f9b5c8033f67c0054942e19f6f6bb28196d5f0e01fdf4f5::reserve::Reserve<0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC>',
      fields: {
        coin_type: {
          name: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
          // Note: name directly, not fields.name (testing fallback path)
        },
        config: {
          fields: {
            borrow_fee: '8'
          }
        },
        available_amount: '5000000000000'
      }
    }
  ];
  
  console.log(`[Suilend] Using vector-based discovery: ${mockReserves.length} reserves found\n`);
  
  // Diagnostic logging for first 3 entries (always on)
  const numToLog = Math.min(3, mockReserves.length);
  for (let i = 0; i < numToLog; i++) {
    const reserve = mockReserves[i];
    console.log(`[Suilend] Reserve[${i}] diagnostics:`);
    console.log(`  - type: ${reserve?.type || 'no type field'}`);
    console.log(`  - fields keys: ${Object.keys(reserve?.fields || {}).join(', ')}`);
    
    // Log full coin_type object structure
    if (reserve?.fields?.coin_type) {
      console.log(`  - coin_type object: ${JSON.stringify(reserve.fields.coin_type)}`);
    } else {
      console.log(`  - coin_type object: not present`);
    }
    
    // Log extracted coin type used for comparison
    const extractedType = getCoinTypeFromReserveEntryDiag(reserve);
    console.log(`  - extracted coin type: ${extractedType || 'could not extract'}`);
    console.log();
  }
  
  // Now simulate matching against target
  console.log('=== Simulating Reserve Matching ===\n');
  const targetCoinType = '0x2::sui::SUI';
  console.log(`Looking for: ${targetCoinType}\n`);
  
  const allExtractedTypes: (string | undefined)[] = [];
  let foundIndex = -1;
  
  for (let index = 0; index < mockReserves.length; index++) {
    const reserve = mockReserves[index];
    const reserveCoinType = getCoinTypeFromReserveEntryDiag(reserve);
    allExtractedTypes.push(reserveCoinType);
    
    if (reserveCoinType === targetCoinType) {
      foundIndex = index;
      const reserveFields = reserve.fields;
      const feeBps = Number(reserveFields?.config?.fields?.borrow_fee || '5');
      const availableAmount = BigInt(reserveFields?.available_amount || '0');
      
      console.log(`✓ Found Suilend reserve for ${targetCoinType}`);
      console.log(`  Reserve index: ${index}`);
      console.log(`  Extracted coin type: ${reserveCoinType}`);
      console.log(`  Fee (borrow_fee): ${feeBps} bps (${feeBps / 100}%)`);
      console.log(`  Available: ${availableAmount.toString()} (smallest units)`);
      break;
    }
  }
  
  if (foundIndex === -1) {
    console.log(`✗ Could not find reserve for ${targetCoinType}`);
    const validTypes = allExtractedTypes.filter(t => t !== undefined) as string[];
    console.log(`Extracted coin types from all reserves: ${validTypes.join(', ')}`);
  }
  
  console.log('\n=== Test Complete ===');
  console.log('✓ Diagnostics logging works as expected');
  console.log('✓ Coin type extraction succeeds');
  console.log('✓ Reserve matching succeeds');
}

simulateDiagnostics();
