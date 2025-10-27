/**
 * Test the enhanced getCoinTypeFromReserveEntry function
 * Validates all 4 fallback strategies in order
 */

// Replicate the logic from flashloan.ts
function getCoinTypeFromReserveEntry(entry: any): string | undefined {
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
  // Format: "...::reserve::Reserve<COIN_TYPE>"
  if (entry.type && typeof entry.type === 'string') {
    const match = entry.type.match(/::reserve::Reserve<(.+)>$/);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return undefined;
}

function runCoinTypeExtractionTests() {
  console.log('=== Testing getCoinTypeFromReserveEntry (4-level fallback) ===\n');
  
  let passCount = 0;
  let failCount = 0;
  
  // Test 1: Strategy a) TypeName canonical path
  console.log('Test 1: TypeName canonical (fields.coin_type.fields.name)');
  const test1 = {
    type: '0xabc::reserve::Reserve<0x2::sui::SUI>',
    fields: {
      coin_type: {
        fields: {
          name: '0x2::sui::SUI'
        }
      }
    }
  };
  const result1 = getCoinTypeFromReserveEntry(test1);
  if (result1 === '0x2::sui::SUI') {
    console.log(`  ✓ PASS: Extracted "${result1}" via strategy a)`);
    passCount++;
  } else {
    console.log(`  ✗ FAIL: Expected "0x2::sui::SUI", got "${result1}"`);
    failCount++;
  }
  console.log();
  
  // Test 2: Strategy b) Alternate SDK flattening
  console.log('Test 2: Alternate SDK flattening (fields.coin_type.name)');
  const test2 = {
    type: '0xabc::reserve::Reserve<0x2::sui::SUI>',
    fields: {
      coin_type: {
        name: '0x5d4b::coin::COIN'
      }
    }
  };
  const result2 = getCoinTypeFromReserveEntry(test2);
  if (result2 === '0x5d4b::coin::COIN') {
    console.log(`  ✓ PASS: Extracted "${result2}" via strategy b)`);
    passCount++;
  } else {
    console.log(`  ✗ FAIL: Expected "0x5d4b::coin::COIN", got "${result2}"`);
    failCount++;
  }
  console.log();
  
  // Test 3: Strategy c) Direct string
  console.log('Test 3: Direct string (fields.coin_type as string)');
  const test3 = {
    type: '0xabc::reserve::Reserve<0x2::sui::SUI>',
    fields: {
      coin_type: '0xabc123::usdc::USDC'
    }
  };
  const result3 = getCoinTypeFromReserveEntry(test3);
  if (result3 === '0xabc123::usdc::USDC') {
    console.log(`  ✓ PASS: Extracted "${result3}" via strategy c)`);
    passCount++;
  } else {
    console.log(`  ✗ FAIL: Expected "0xabc123::usdc::USDC", got "${result3}"`);
    failCount++;
  }
  console.log();
  
  // Test 4: Strategy d) Regex parsing from type field (last resort)
  console.log('Test 4: Regex parsing from type field (last resort)');
  const test4 = {
    type: '0xf95b8500638429c42f9b5c8033f67c0054942e19f6f6bb28196d5f0e01fdf4f5::reserve::Reserve<0x2::sui::SUI>',
    fields: {
      // No coin_type field
    }
  };
  const result4 = getCoinTypeFromReserveEntry(test4);
  if (result4 === '0x2::sui::SUI') {
    console.log(`  ✓ PASS: Extracted "${result4}" via strategy d)`);
    passCount++;
  } else {
    console.log(`  ✗ FAIL: Expected "0x2::sui::SUI", got "${result4}"`);
    failCount++;
  }
  console.log();
  
  // Test 5: Complex coin type with long address
  console.log('Test 5: Complex coin type via regex (long address)');
  const test5 = {
    type: '0xabc::reserve::Reserve<0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN>',
    fields: {}
  };
  const result5 = getCoinTypeFromReserveEntry(test5);
  const expected5 = '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN';
  if (result5 === expected5) {
    console.log(`  ✓ PASS: Extracted long coin type via strategy d)`);
    passCount++;
  } else {
    console.log(`  ✗ FAIL: Expected long coin type, got "${result5}"`);
    failCount++;
  }
  console.log();
  
  // Test 6: All paths missing - should return undefined
  console.log('Test 6: No coin type available (all strategies fail)');
  const test6 = {
    fields: {}
    // No type field, no coin_type field
  };
  const result6 = getCoinTypeFromReserveEntry(test6);
  if (result6 === undefined) {
    console.log(`  ✓ PASS: Returns undefined when no data available`);
    passCount++;
  } else {
    console.log(`  ✗ FAIL: Expected undefined, got "${result6}"`);
    failCount++;
  }
  console.log();
  
  // Test 7: Whitespace trimming
  console.log('Test 7: Whitespace trimming');
  const test7 = {
    fields: {
      coin_type: {
        fields: {
          name: '  0x2::sui::SUI  '
        }
      }
    }
  };
  const result7 = getCoinTypeFromReserveEntry(test7);
  if (result7 === '0x2::sui::SUI') {
    console.log(`  ✓ PASS: Whitespace trimmed correctly`);
    passCount++;
  } else {
    console.log(`  ✗ FAIL: Expected "0x2::sui::SUI", got "${result7}"`);
    failCount++;
  }
  console.log();
  
  // Test 8: Strategy priority - a) should win over d)
  console.log('Test 8: Strategy priority (a wins over d)');
  const test8 = {
    type: '0xabc::reserve::Reserve<0xWRONG::wrong::WRONG>',
    fields: {
      coin_type: {
        fields: {
          name: '0x2::sui::SUI'
        }
      }
    }
  };
  const result8 = getCoinTypeFromReserveEntry(test8);
  if (result8 === '0x2::sui::SUI') {
    console.log(`  ✓ PASS: Strategy a) has priority over d)`);
    passCount++;
  } else {
    console.log(`  ✗ FAIL: Expected "0x2::sui::SUI" from strategy a), got "${result8}"`);
    failCount++;
  }
  console.log();
  
  // Summary
  console.log('=== Summary ===');
  console.log(`Total tests: ${passCount + failCount}`);
  console.log(`Passed: ${passCount}`);
  console.log(`Failed: ${failCount}`);
  
  if (failCount === 0) {
    console.log('\n✓ All tests passed! getCoinTypeFromReserveEntry is working correctly.');
  } else {
    console.log(`\n✗ ${failCount} test(s) failed.`);
    process.exit(1);
  }
}

runCoinTypeExtractionTests();
