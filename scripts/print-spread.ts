import { config } from '../src/config.js';
import { initializeRpcClient, getSuiClient } from '../src/utils/sui.js';
import { resolvePoolAddresses, getResolvedAddresses } from '../src/resolve.js';
import { getCetusPrice, getCetusPoolInfo } from '../src/cetusIntegration.js';
import { getTurbosPrice, getTurbosPoolInfo } from '../src/turbosIntegration.js';

/**
 * Calculate spread percentage between two prices
 */
function calculateSpread(price1: number, price2: number): number {
  return (Math.abs(price1 - price2) / Math.min(price1, price2)) * 100;
}

/**
 * Print current price spreads with real SDK quotes
 */
async function printSpread() {
  console.log('=== Sui DEX Price Spread Checker ===\n');

  try {
    // Initialize RPC client
    console.log('Initializing...');
    initializeRpcClient(
      config.rpcEndpoints.primary,
      config.rpcEndpoints.backup,
      config.rpcEndpoints.fallback
    );

    const client = getSuiClient();

    // Resolve pool addresses
    console.log('Resolving pool addresses...');
    await resolvePoolAddresses(client);
    console.log();

    console.log('Fetching prices from Cetus and Turbos...\n');

    // Fetch prices using real SDKs
    const [cetusPrice, turbosPrice] = await Promise.all([getCetusPrice(), getTurbosPrice()]);

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

    // Profitability analysis with real flashloan size
    const minSpread = config.minSpreadPercent;
    const isProfitable = spread >= minSpread;

    console.log('Profitability Assessment:');
    console.log(`  Minimum Required Spread: ${minSpread}%`);
    console.log(`  Current Spread: ${spread.toFixed(4)}%`);
    console.log(`  Status: ${isProfitable ? '✓ POTENTIALLY PROFITABLE' : '✗ Below Threshold'}`);
    console.log();

    if (isProfitable) {
      console.log('Estimated Arbitrage (at configured flashloan size):');
      const flashloanAmount = config.flashloanAmount / 1e6; // Convert to USDC
      const estimatedGross = (flashloanAmount * spread) / 100;
      const flashloanFee = flashloanAmount * (config.suilendFeePercent / 100);
      const swapFees = flashloanAmount * 0.001; // ~0.1% total swap fees
      const estimatedNet = estimatedGross - flashloanFee - swapFees;

      console.log(`  Flashloan Size: ${flashloanAmount.toFixed(2)} USDC`);
      console.log(`  Gross Profit: ${estimatedGross.toFixed(6)} USDC`);
      console.log(`  Flashloan Fee (${config.suilendFeePercent}%): ${flashloanFee.toFixed(6)} USDC`);
      console.log(`  Swap Fees: ${swapFees.toFixed(6)} USDC`);
      console.log(`  Net Profit: ${estimatedNet.toFixed(6)} USDC`);
      console.log();
    }

    // Pool information
    console.log('Pool Information:');
    try {
      const resolved = getResolvedAddresses();
      await getCetusPoolInfo(); // Verify pool is accessible
      console.log(`  Cetus Pool ID: ${resolved.cetus.suiUsdcPool.poolId}`);
      console.log(`  Cetus Coin A: ${resolved.cetus.suiUsdcPool.coinTypeA.split('::').pop()}`);
      console.log(`  Cetus Coin B: ${resolved.cetus.suiUsdcPool.coinTypeB.split('::').pop()}`);
    } catch (err) {
      console.log(`  Cetus Pool: Error fetching info`);
    }

    try {
      const resolved = getResolvedAddresses();
      await getTurbosPoolInfo(); // Verify pool is accessible
      console.log(`  Turbos Pool ID: ${resolved.turbos.suiUsdcPool.poolId}`);
      console.log(`  Turbos Coin A: ${resolved.turbos.suiUsdcPool.coinTypeA.split('::').pop()}`);
      console.log(`  Turbos Coin B: ${resolved.turbos.suiUsdcPool.coinTypeB.split('::').pop()}`);
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
