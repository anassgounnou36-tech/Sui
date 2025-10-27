/**
 * Simple test to validate Cetus price formula with known values
 */

import Decimal from 'decimal.js';

const Q64 = new Decimal(2).pow(64);

console.log('=== Testing Cetus sqrt_price Formula ===\n');

// Example: If we want 2.5 USDC per SUI
const targetPrice = 2.5; // USDC per SUI

console.log(`Target: ${targetPrice} USDC per SUI\n`);

// Case 1: Pool<SUI, USDC>
console.log('Case 1: Pool<SUI, USDC>');
console.log('  Pool represents: SUI/USDC ratio');
console.log('  sqrtPrice = sqrt((SUI/USDC) * 10^(decimalsA - decimalsB))');
console.log('  sqrtPrice = sqrt((SUI/USDC) * 10^(9-6))');
console.log('  sqrtPrice = sqrt((1/2.5) * 1000)');
console.log('  sqrtPrice = sqrt(400)');
console.log('  sqrtPrice = 20');

const sqrtP1 = Math.sqrt((1/targetPrice) * 1000);
console.log(`  Calculated sqrtPrice (not x64): ${sqrtP1}`);

const sqrtP1_x64 = new Decimal(sqrtP1).mul(Q64);
console.log(`  sqrtPrice_x64: ${sqrtP1_x64.toFixed(0)}`);

// Now reverse it
const sqrtP1_from_x64 = sqrtP1_x64.div(Q64);
const priceRatio1 = sqrtP1_from_x64.pow(2);
console.log(`  Price ratio (SUI/USDC * 1000): ${priceRatio1.toFixed(6)}`);

const suiPerUsdc = priceRatio1.div(1000);
console.log(`  SUI per USDC: ${suiPerUsdc.toFixed(6)}`);

const usdcPerSui1 = new Decimal(1).div(suiPerUsdc);
console.log(`  USDC per SUI: ${usdcPerSui1.toFixed(6)}`);
console.log(`  Match target? ${Math.abs(usdcPerSui1.toNumber() - targetPrice) < 0.01 ? 'YES' : 'NO'}\n`);

// Case 2: Pool<USDC, SUI>
console.log('Case 2: Pool<USDC, SUI>');
console.log('  Pool represents: USDC/SUI ratio');
console.log('  sqrtPrice = sqrt((USDC/SUI) * 10^(decimalsA - decimalsB))');
console.log('  sqrtPrice = sqrt((USDC/SUI) * 10^(6-9))');
console.log('  sqrtPrice = sqrt(2.5 * 0.001)');
console.log('  sqrtPrice = sqrt(0.0025)');
console.log('  sqrtPrice = 0.05');

const sqrtP2 = Math.sqrt(targetPrice * 0.001);
console.log(`  Calculated sqrtPrice (not x64): ${sqrtP2}`);

const sqrtP2_x64 = new Decimal(sqrtP2).mul(Q64);
console.log(`  sqrtPrice_x64: ${sqrtP2_x64.toFixed(0)}`);

// Now reverse it
const sqrtP2_from_x64 = sqrtP2_x64.div(Q64);
const priceRatio2 = sqrtP2_from_x64.pow(2);
console.log(`  Price ratio (USDC/SUI * 0.001): ${priceRatio2.toFixed(6)}`);

const usdcPerSui2 = priceRatio2.div(0.001);
console.log(`  USDC per SUI: ${usdcPerSui2.toFixed(6)}`);
console.log(`  Match target? ${Math.abs(usdcPerSui2.toNumber() - targetPrice) < 0.01 ? 'YES' : 'NO'}\n`);

console.log('=== Summary ===');
console.log('For Pool<SUI, USDC> to get USDC per SUI:');
console.log('  1. sqrtP = sqrt_price_x64 / 2^64');
console.log('  2. priceRatio = sqrtP^2  (gives SUI/USDC * 1000)');
console.log('  3. suiPerUsdc = priceRatio / 1000');
console.log('  4. usdcPerSui = 1 / suiPerUsdc');
console.log('');
console.log('For Pool<USDC, SUI> to get USDC per SUI:');
console.log('  1. sqrtP = sqrt_price_x64 / 2^64');
console.log('  2. priceRatio = sqrtP^2  (gives USDC/SUI * 0.001)');
console.log('  3. usdcPerSui = priceRatio / 0.001');
