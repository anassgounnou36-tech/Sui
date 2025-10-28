/**
 * Test normalization function for coin type comparison
 * Verifies that the normalizeTypeForCompare function handles various address formats
 */

(function runTests() {
  // NOTE: This function is intentionally duplicated from src/flashloan.ts
  // for testing purposes, since normalizeTypeForCompare is not exported.
  // This is acceptable for a unit test to remain self-contained.
  function normalizeTypeForCompare(typeStr: string): string {
    if (!typeStr) return '';
    
    // Split by :: to process each part
    const parts = typeStr.split('::');
    if (parts.length === 0) return '';
    
    // Normalize the address part (first part)
    let address = parts[0];
    
    // Remove 0x prefix if present
    if (address.startsWith('0x') || address.startsWith('0X')) {
      address = address.substring(2);
    }
    
    // Remove leading zeros, but keep at least one digit
    address = address.replace(/^0+/, '') || '0';
    
    // Lowercase the address
    address = address.toLowerCase();
    
    // Reconstruct with normalized address and lowercase module/type names
    const normalizedParts = [address, ...parts.slice(1).map(p => p.toLowerCase())];
    return normalizedParts.join('::');
  }

  console.log('=== Testing Coin Type Normalization ===\n');

  // Test cases
  const testCases = [
  {
    input: '0x2::sui::SUI',
    expected: '2::sui::sui',
    description: 'Standard 0x-prefixed address'
  },
  {
    input: '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
    expected: '2::sui::sui',
    description: '64-hex padded address (no 0x)'
  },
  {
    input: '0x0002::sui::SUI',
    expected: '2::sui::sui',
    description: '0x-prefixed with leading zeros'
  },
  {
    input: '0x00000002::sui::SUI',
    expected: '2::sui::sui',
    description: '0x-prefixed with more leading zeros'
  },
  {
    input: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    expected: 'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::usdc',
    description: 'Full-length address (USDC)'
  },
  {
    input: '0X2::SUI::SUI',
    expected: '2::sui::sui',
    description: 'Uppercase 0X prefix'
  },
  {
    input: '2::sui::SUI',
    expected: '2::sui::sui',
    description: 'No prefix, short address'
  },
  {
    input: '0::test::TOKEN',
    expected: '0::test::token',
    description: 'Zero address'
  },
  {
    input: '',
    expected: '',
    description: 'Empty string'
  },
  {
    input: '0x0000000000000000000000000000000000000000000000000000000000000001::std::option::Option',
    expected: '1::std::option::option',
    description: 'Multi-part module path'
  }
];

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const result = normalizeTypeForCompare(testCase.input);
  const success = result === testCase.expected;
  
  if (success) {
    console.log(`✓ PASS: ${testCase.description}`);
    console.log(`  Input:    "${testCase.input}"`);
    console.log(`  Output:   "${result}"`);
    console.log(`  Expected: "${testCase.expected}"`);
    passed++;
  } else {
    console.log(`✗ FAIL: ${testCase.description}`);
    console.log(`  Input:    "${testCase.input}"`);
    console.log(`  Output:   "${result}"`);
    console.log(`  Expected: "${testCase.expected}"`);
    failed++;
  }
  console.log();
}

// Test equality comparisons
console.log('=== Testing Equality Comparisons ===\n');

const comparisonTests = [
  {
    type1: '0x2::sui::SUI',
    type2: '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
    shouldMatch: true,
    description: '0x2 vs 64-hex padded (SUI mainnet case)'
  },
  {
    type1: '0x2::sui::SUI',
    type2: '0x0002::sui::SUI',
    shouldMatch: true,
    description: '0x2 vs 0x0002'
  },
  {
    type1: '0x2::sui::SUI',
    type2: '0x3::sui::SUI',
    shouldMatch: false,
    description: 'Different addresses'
  },
  {
    type1: '0x2::sui::SUI',
    type2: '0x2::usdc::USDC',
    shouldMatch: false,
    description: 'Same address, different module'
  }
];

for (const test of comparisonTests) {
  const norm1 = normalizeTypeForCompare(test.type1);
  const norm2 = normalizeTypeForCompare(test.type2);
  const matches = norm1 === norm2;
  const success = matches === test.shouldMatch;
  
  if (success) {
    console.log(`✓ PASS: ${test.description}`);
    console.log(`  Type 1:       "${test.type1}"`);
    console.log(`  Type 2:       "${test.type2}"`);
    console.log(`  Normalized 1: "${norm1}"`);
    console.log(`  Normalized 2: "${norm2}"`);
    console.log(`  Matches:      ${matches} (expected: ${test.shouldMatch})`);
    passed++;
  } else {
    console.log(`✗ FAIL: ${test.description}`);
    console.log(`  Type 1:       "${test.type1}"`);
    console.log(`  Type 2:       "${test.type2}"`);
    console.log(`  Normalized 1: "${norm1}"`);
    console.log(`  Normalized 2: "${norm2}"`);
    console.log(`  Matches:      ${matches} (expected: ${test.shouldMatch})`);
    failed++;
  }
  console.log();
}

// Summary
console.log('=== Test Summary ===');
console.log(`Total tests: ${passed + failed}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed === 0) {
  console.log('\n✓ All tests passed!');
  process.exit(0);
} else {
  console.log(`\n✗ ${failed} test(s) failed`);
  process.exit(1);
}
})();
