import { config, validateConfig } from '../src/config';
import { logger } from '../src/logger';
import { initializeRpcClient } from '../src/utils/sui';
import { getCetusPrice, getCetusPoolInfo } from '../src/cetus';
import { getTurbosPrice, getTurbosPoolInfo } from '../src/turbos';

/**
 * Calculate spread percentage between two prices
 */
function calculateSpread(price1: number, price2: number): number {
  return (Math.abs(price1 - price2) / Math.min(price1, price2)) * 100;
}

/**
 * Print current price spreads
 */
async function printSpread() {
  console.log('=== Sui DEX Price Spread Checker ===\n');

  try {
    // Initialize (minimal config needed)
    console.log('Initializing...');
    initializeRpcClient(config.rpcUrl);

    console.log('Fetching prices from Cetus and Turbos...\n');

    // Fetch prices
    const [cetusPrice, turbosPrice] = await Promise.all([
      getCetusPrice(),
      getTurbosPrice(),
    ]);

    // Display prices
    console.log('Current Prices (SUI/USDC):');
    console.log(`  Cetus:  ${cetusPrice.toFixed(6)} USDC per SUI`);
    console.log(`  Turbos: ${turbosPrice.toFixed(6)} USDC per SUI`);
    console.log();

    // Calculate spread
    const spread = calculateSpread(cetusPrice, turbosPrice);
    const spreadDirection = cetusPrice < turbosPrice ? 'Cetus → Turbos' : 'Turbos → Cetus';

    console.log('Spread Analysis:');
    console.log(`  Absolute Spread: ${Math.abs(cetusPrice - turbosPrice).toFixed(6)} USDC`);
    console.log(`  Percentage Spread: ${spread.toFixed(4)}%`);
    console.log(`  Direction: ${spreadDirection} (buy cheaper, sell higher)`);
    console.log();

    // Profitability analysis
    const minSpread = config.minSpreadPercent;
    const isProfitable = spread >= minSpread;

    console.log('Profitability Assessment:');
    console.log(`  Minimum Required Spread: ${minSpread}%`);
    console.log(`  Current Spread: ${spread.toFixed(4)}%`);
    console.log(`  Status: ${isProfitable ? '✓ POTENTIALLY PROFITABLE' : '✗ Below Threshold'}`);
    console.log();

    if (isProfitable) {
      console.log('Estimated Arbitrage:');
      const flashloanAmount = config.flashloanAmount / 1e6; // Convert to USDC
      const estimatedGross = (flashloanAmount * spread) / 100;
      const flashloanFee = flashloanAmount * (config.suilendFeePercent / 100);
      const swapFees = flashloanAmount * 0.001; // ~0.1% total swap fees
      const estimatedNet = estimatedGross - flashloanFee - swapFees;

      console.log(`  Flashloan Size: ${flashloanAmount.toFixed(2)} USDC`);
      console.log(`  Gross Profit: ${estimatedGross.toFixed(6)} USDC`);
      console.log(`  Flashloan Fee: ${flashloanFee.toFixed(6)} USDC`);
      console.log(`  Swap Fees: ${swapFees.toFixed(6)} USDC`);
      console.log(`  Net Profit: ${estimatedNet.toFixed(6)} USDC`);
      console.log();
    }

    // Pool information
    console.log('Pool Information:');
    try {
      const cetusPoolInfo = await getCetusPoolInfo();
      console.log(`  Cetus Pool ID: ${cetusPoolInfo.data?.objectId || 'N/A'}`);
    } catch (err) {
      console.log(`  Cetus Pool: Error fetching info`);
    }

    try {
      const turbosPoolInfo = await getTurbosPoolInfo();
      console.log(`  Turbos Pool ID: ${turbosPoolInfo.data?.objectId || 'N/A'}`);
    } catch (err) {
      console.log(`  Turbos Pool: Error fetching info`);
    }

    console.log();
    console.log('=== Spread Check Complete ===');
    process.exit(0);
  } catch (error) {
    console.error('Error fetching spreads:', error);
    process.exit(1);
  }
}

// Run the script
printSpread();
