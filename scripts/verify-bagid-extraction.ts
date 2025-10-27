/**
 * Verification script for robust bagId extraction
 * Tests the defensive extraction logic with various data structures
 */

console.log('=== BagId Extraction Verification ===\n');

// Test scenarios for bagId extraction
const testScenarios = [
  {
    name: 'Standard pattern (.fields.id.id)',
    data: {
      fields: {
        reserves: {
          fields: {
            id: {
              id: '0xabc123def456'
            }
          }
        }
      }
    },
    expected: '0xabc123def456'
  },
  {
    name: 'Alternative pattern (.fields.id.value)',
    data: {
      fields: {
        reserves: {
          fields: {
            id: {
              value: '0xdef456abc123'
            }
          }
        }
      }
    },
    expected: '0xdef456abc123'
  },
  {
    name: 'Direct ID pattern (.fields.id)',
    data: {
      fields: {
        reserves: {
          fields: {
            id: '0x123456789abc'
          }
        }
      }
    },
    expected: '0x123456789abc'
  },
  {
    name: 'Alternative field name (reserves_bag)',
    data: {
      fields: {
        reserves_bag: {
          fields: {
            id: {
              id: '0x789abcdef012'
            }
          }
        }
      }
    },
    expected: '0x789abcdef012'
  },
  {
    name: 'CamelCase field name (reservesBag)',
    data: {
      fields: {
        reservesBag: {
          fields: {
            id: {
              id: '0x012345678abc'
            }
          }
        }
      }
    },
    expected: '0x012345678abc'
  }
];

// Simulate the extraction logic from flashloan.ts
function extractBagId(content: any): string | null {
  // Support multiple container names: reserves, reserves_bag, reservesBag
  const reservesBag = content.fields?.reserves 
    || content.fields?.reserves_bag 
    || content.fields?.reservesBag;
  
  if (!reservesBag) {
    console.log('  ✗ No reserves container found');
    return null;
  }
  
  // Extract bagId defensively from multiple possible patterns
  let bagId: string | undefined;
  if (reservesBag.fields?.id?.id) {
    bagId = reservesBag.fields.id.id;
  } else if (reservesBag.fields?.id?.value) {
    bagId = reservesBag.fields.id.value;
  } else if (reservesBag.fields?.id) {
    bagId = reservesBag.fields.id;
  }
  
  if (!bagId || typeof bagId !== 'string') {
    console.log('  ✗ BagId not found or invalid type');
    return null;
  }
  
  return bagId;
}

// Run tests
let passed = 0;
let failed = 0;

testScenarios.forEach((scenario, index) => {
  console.log(`Test ${index + 1}: ${scenario.name}`);
  const result = extractBagId(scenario.data);
  
  if (result === scenario.expected) {
    console.log(`  ✓ PASS: Extracted bagId = ${result}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: Expected ${scenario.expected}, got ${result}`);
    failed++;
  }
  console.log();
});

// Test failure scenarios
console.log('Test Error Handling:');

console.log('Test: Missing reserves container');
const noReserves = { fields: { otherField: 'value' } };
const result1 = extractBagId(noReserves);
if (result1 === null) {
  console.log('  ✓ PASS: Correctly returned null\n');
  passed++;
} else {
  console.log(`  ✗ FAIL: Expected null, got ${result1}\n`);
  failed++;
}

console.log('Test: Missing ID field');
const noId = { fields: { reserves: { fields: { other: 'value' } } } };
const result2 = extractBagId(noId);
if (result2 === null) {
  console.log('  ✓ PASS: Correctly returned null\n');
  passed++;
} else {
  console.log(`  ✗ FAIL: Expected null, got ${result2}\n`);
  failed++;
}

console.log('=== Summary ===');
console.log(`Total: ${passed + failed} tests`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(passed === passed + failed && failed === 0 ? '✓ All tests passed!' : '✗ Some tests failed');
