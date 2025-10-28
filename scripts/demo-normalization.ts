/**
 * Demo script to verify the normalization function handles the mainnet case
 * Shows that 0x2::sui::SUI matches 0000...002::sui::SUI
 */

(function demo() {
  // NOTE: This function is intentionally duplicated from src/flashloan.ts
  // for demo purposes, since normalizeTypeForCompare is not exported.
  // This is acceptable for a demo/test script to remain self-contained.
  function normalizeTypeForCompare(typeStr: string): string {
    if (!typeStr) return '';
    
    const parts = typeStr.split('::');
    if (parts.length === 0) return '';
    
    let address = parts[0];
    
    if (address.startsWith('0x') || address.startsWith('0X')) {
      address = address.substring(2);
    }
    
    address = address.replace(/^0+/, '') || '0';
    address = address.toLowerCase();
    
    const normalizedParts = [address, ...parts.slice(1).map(p => p.toLowerCase())];
    return normalizedParts.join('::');
  }

  console.log('=== Mainnet Coin Type Normalization Demo ===\n');
  
  // Problem: Mainnet returns this format (64-hex padded, no 0x)
  const mainnetFormat = '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
  
  // Our target is this format (0x-prefixed, short)
  const targetFormat = '0x2::sui::SUI';
  
  console.log('Problem Statement:');
  console.log('==================');
  console.log('Mainnet TypeName format:', mainnetFormat);
  console.log('Target coin type format:', targetFormat);
  console.log('Direct string equality: false (formats differ)');
  console.log('');
  
  // Normalize both
  const normalizedMainnet = normalizeTypeForCompare(mainnetFormat);
  const normalizedTarget = normalizeTypeForCompare(targetFormat);
  
  console.log('Solution: Normalization');
  console.log('=======================');
  console.log('Mainnet normalized:', normalizedMainnet);
  console.log('Target normalized: ', normalizedTarget);
  console.log('Normalized equality:', normalizedMainnet === normalizedTarget);
  console.log('');
  
  if (normalizedMainnet === normalizedTarget) {
    console.log('✓ SUCCESS: Reserve matching will work!');
    console.log('  The SUI reserve will be found using normalized comparison.');
    console.log('');
    console.log('Expected log output:');
    console.log('  ✓ Found Suilend reserve for 0x2::sui::SUI (Vector match)');
    console.log('    Reserve index: 0');
    console.log('    Match method: TypeName');
    console.log('    Raw coin type: ' + mainnetFormat);
    console.log('    Normalized match: ' + normalizedMainnet + ' == ' + normalizedTarget);
    console.log('    Fee (borrow_fee): 5 bps (0.05%)');
    console.log('    Available: XXXXX.XX SUI');
  } else {
    console.log('✗ FAILED: Something is wrong with the normalization');
  }
})();
