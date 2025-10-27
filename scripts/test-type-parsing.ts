/**
 * Test type parsing from reserve.type generic parameter
 * Verifies regex extraction of coin type from Reserve<T> type strings
 */

console.log('=== Testing Reserve Type Parsing ===\n');

// Test the regex pattern for extracting coin type from reserve.type
const pattern = /::reserve::Reserve<(.+)>$/;

const testCases = [
  {
    input: '0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::reserve::Reserve<0x2::sui::SUI>',
    expected: '0x2::sui::SUI',
    description: 'SUI reserve type'
  },
  {
    input: 'some::package::reserve::Reserve<0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN>',
    expected: '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN',
    description: 'USDC reserve type'
  },
  {
    input: '0xabc123::reserve::Reserve<0x123::custom::TOKEN>',
    expected: '0x123::custom::TOKEN',
    description: 'Custom token reserve type'
  },
];

console.log('Test 1: Regex pattern validation\n');

let allPassed = true;

for (const testCase of testCases) {
  const match = testCase.input.match(pattern);
  const extracted = match && match[1] ? match[1] : null;
  
  const passed = extracted === testCase.expected;
  allPassed = allPassed && passed;
  
  const status = passed ? '✓' : '✗';
  console.log(`${status} ${testCase.description}`);
  console.log(`  Input: ${testCase.input}`);
  console.log(`  Expected: ${testCase.expected}`);
  console.log(`  Extracted: ${extracted}`);
  console.log(`  Match: ${passed ? 'SUCCESS' : 'FAILED'}`);
  console.log();
}

console.log('Test 2: Edge cases\n');

// Test cases that should NOT match
const edgeCases = [
  {
    input: 'invalid::type::string',
    description: 'Invalid format (no Reserve)'
  },
  {
    input: '0xabc::reserve::Reserve',
    description: 'Missing generic parameter'
  },
  {
    input: '0xabc::Reserve<0x2::sui::SUI>',
    description: 'Missing ::reserve:: prefix'
  },
];

for (const testCase of edgeCases) {
  const match = testCase.input.match(pattern);
  const extracted = match && match[1] ? match[1] : null;
  
  const passed = extracted === null;
  allPassed = allPassed && passed;
  
  const status = passed ? '✓' : '✗';
  console.log(`${status} ${testCase.description}`);
  console.log(`  Input: ${testCase.input}`);
  console.log(`  Expected: null (no match)`);
  console.log(`  Extracted: ${extracted}`);
  console.log(`  Result: ${passed ? 'CORRECTLY REJECTED' : 'INCORRECTLY MATCHED'}`);
  console.log();
}

console.log('=== Test Summary ===');
if (allPassed) {
  console.log('✓ All tests passed - regex pattern is correct');
} else {
  console.log('✗ Some tests failed - regex pattern needs adjustment');
}
