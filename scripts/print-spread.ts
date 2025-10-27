import { config } from '../src/config';
import { initializeRpcClient, getSuiClient } from '../src/utils/sui';
import { resolvePoolAddresses, getCetusPools } from '../src/resolve';
import { COIN_TYPES } from '../src/addresses';
import { getExecutablePriceUsdcPerSui } from '../src/lib/cetusPrice';

/**
 * Calculate spread percentage between two prices
 */
function calculateSpread(price1: number, price2: number): number {
  return (Math.abs(price1 - price2) / Math.min(price1, price2)) * 100;
}

/**
 * Print current price spreads for Cetus fee-tier pools
 */
async function printSpread() {
  console.log('=== Sui Cetus Fee-Tier Spread Checker ===\n');
  console.log('Strategy: Cetus fee-tier arbitrage (0.05% vs 0.25%)');
  console.log('Flashloan asset: SUI');
  console.log(`Expected USDC type: ${COIN_TYPES.BRIDGED_USDC}\n`);

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
    const pools = getCetusPools();
    console.log();

    console.log('Fetching prices from Cetus 0.05% and 0.25% pools...\n');

    // Fetch prices using shared price helper with quote-based approach
    const quoteAmount = BigInt(config.flashloanAmount); // Use configured flashloan amount for quote
    const [price005, price025] = await Promise.all([
      getExecutablePriceUsdcPerSui(pools.pool005.poolId, quoteAmount),
      getExecutablePriceUsdcPerSui(pools.pool025.poolId, quoteAmount),
    ]);

    // Display prices
    console.log('Current Prices (SUI/USDC):');
    console.log(`  Cetus 0.05%: ${price005.toFixed(6)} USDC per SUI`);
    console.log(`  Cetus 0.25%: ${price025.toFixed(6)} USDC per SUI`);
    console.log();

    // Calculate spread
    const spread = calculateSpread(price005, price025);
    const spreadDirection = price005 < price025 ? '0.05% → 0.25%' : '0.25% → 0.05%';

    console.log('Spread Analysis:');
    console.log(`  Absolute Spread: ${Math.abs(price005 - price025).toFixed(6)} USDC`);
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
      console.log('Estimated Arbitrage (at configured flashloan size):');
      const flashloanAmount = config.flashloanAmount / 1e9; // Convert to SUI
      const estimatedGross = (flashloanAmount * spread) / 100;
      const flashloanFee = flashloanAmount * (config.suilendFeePercent / 100);
      const swapFees = flashloanAmount * 0.003; // ~0.3% total swap fees (0.05% + 0.25%)
      const estimatedNet = estimatedGross - flashloanFee - swapFees;

      console.log(`  Flashloan Size: ${flashloanAmount.toFixed(2)} SUI`);
      console.log(`  Gross Profit: ${estimatedGross.toFixed(6)} SUI`);
      console.log(`  Flashloan Fee (${config.suilendFeePercent}%): ${flashloanFee.toFixed(6)} SUI`);
      console.log(`  Swap Fees: ${swapFees.toFixed(6)} SUI`);
      console.log(`  Net Profit: ${estimatedNet.toFixed(6)} SUI`);
      console.log();
    }

    // Pool information
    console.log('Pool Information:');
    console.log(`  Pool 0.05% ID: ${pools.pool005.poolId}`);
    console.log(`  Pool 0.05% Coin A: ${pools.pool005.coinTypeA.split('::').pop()}`);
    console.log(`  Pool 0.05% Coin B: ${pools.pool005.coinTypeB.split('::').pop()}`);
    console.log();
    console.log(`  Pool 0.25% ID: ${pools.pool025.poolId}`);
    console.log(`  Pool 0.25% Coin A: ${pools.pool025.coinTypeA.split('::').pop()}`);
    console.log(`  Pool 0.25% Coin B: ${pools.pool025.coinTypeB.split('::').pop()}`);

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
