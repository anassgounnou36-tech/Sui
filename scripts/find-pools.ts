/**
 * Find Pools Script - Discovers and displays DEX pool addresses and lending markets
 * This utility script helps verify pool configurations and discover pool IDs dynamically.
 */

import { config } from '../src/config.js';
import { initializeRpcClient, getSuiClient } from '../src/utils/sui.js';
import { resolvePoolAddresses, getResolvedAddresses } from '../src/resolve.js';

/**
 * Display resolved pool information in a readable format
 */
function displayPoolInfo() {
  const resolved = getResolvedAddresses();

  console.log('\n=== DEX Pool Addresses ===\n');

  // Cetus Information
  console.log('Cetus CLMM:');
  console.log(`  Global Config ID: ${resolved.cetus.globalConfigId}`);
  console.log(`  SUI/USDC Pool ID: ${resolved.cetus.suiUsdcPool.poolId}`);
  console.log(`  Coin A: ${resolved.cetus.suiUsdcPool.coinTypeA}`);
  console.log(`  Coin B: ${resolved.cetus.suiUsdcPool.coinTypeB}`);
  console.log(`  Fee Tier: ${resolved.cetus.suiUsdcPool.feeTier / 100}%`);
  if (resolved.cetus.suiUsdcPool.currentSqrtPrice) {
    console.log(`  Current Sqrt Price: ${resolved.cetus.suiUsdcPool.currentSqrtPrice}`);
  }
  if (resolved.cetus.suiUsdcPool.liquidity) {
    console.log(`  Liquidity: ${resolved.cetus.suiUsdcPool.liquidity}`);
  }
  console.log();

  // Turbos Information
  console.log('Turbos CLMM:');
  console.log(`  Factory ID: ${resolved.turbos.factoryId}`);
  console.log(`  SUI/USDC Pool ID: ${resolved.turbos.suiUsdcPool.poolId}`);
  console.log(`  Coin A: ${resolved.turbos.suiUsdcPool.coinTypeA}`);
  console.log(`  Coin B: ${resolved.turbos.suiUsdcPool.coinTypeB}`);
  console.log(`  Fee Tier: ${resolved.turbos.suiUsdcPool.feeTier / 100}%`);
  if (resolved.turbos.suiUsdcPool.currentSqrtPrice) {
    console.log(`  Current Sqrt Price: ${resolved.turbos.suiUsdcPool.currentSqrtPrice}`);
  }
  if (resolved.turbos.suiUsdcPool.liquidity) {
    console.log(`  Liquidity: ${resolved.turbos.suiUsdcPool.liquidity}`);
  }
  console.log();

  // Suilend Information
  console.log('Suilend Lending:');
  console.log(`  Lending Market: ${resolved.suilend.lendingMarket}`);
  if (resolved.suilend.marketObjectId) {
    console.log(`  Market Object ID: ${resolved.suilend.marketObjectId}`);
  }
  console.log();

  // Navi Information
  console.log('Navi Lending (Fallback):');
  console.log(`  Storage ID: ${resolved.navi.storageId}`);
  console.log(`  USDC Pool ID: ${resolved.navi.usdcPoolId}`);
  console.log();
}

/**
 * Generate environment variable configuration for .env file
 */
function generateEnvConfig() {
  const resolved = getResolvedAddresses();

  console.log('=== Environment Configuration (Optional Overrides) ===\n');
  console.log('# Add these to your .env file if you want to override default pool addresses:\n');
  console.log(`# Cetus`);
  console.log(`CETUS_GLOBAL_CONFIG_ID=${resolved.cetus.globalConfigId}`);
  console.log(`CETUS_SUI_USDC_POOL_ID=${resolved.cetus.suiUsdcPool.poolId}`);
  console.log();
  console.log(`# Turbos`);
  console.log(`TURBOS_FACTORY_ID=${resolved.turbos.factoryId}`);
  console.log(`TURBOS_SUI_USDC_POOL_ID=${resolved.turbos.suiUsdcPool.poolId}`);
  console.log();
  console.log(`# Suilend`);
  console.log(`SUILEND_LENDING_MARKET=${resolved.suilend.lendingMarket}`);
  console.log();
  console.log(`# Navi`);
  console.log(`NAVI_STORAGE_ID=${resolved.navi.storageId}`);
  console.log(`NAVI_USDC_POOL_ID=${resolved.navi.usdcPoolId}`);
  console.log();
}

/**
 * Main entry point
 */
async function findPools() {
  console.log('=== Sui Pool Finder ===');
  console.log('Discovering DEX pools and lending markets on Sui Mainnet\n');

  try {
    // Initialize RPC client
    console.log('Initializing Sui RPC client...');
    initializeRpcClient(
      config.rpcEndpoints.primary,
      config.rpcEndpoints.backup,
      config.rpcEndpoints.fallback
    );

    const client = getSuiClient();
    console.log('✓ Connected to Sui Mainnet\n');

    // Resolve all pool addresses
    console.log('Resolving pool addresses (this may take a moment)...\n');
    await resolvePoolAddresses(client);

    // Display results
    displayPoolInfo();
    generateEnvConfig();

    console.log('=== Pool Discovery Complete ===');
    console.log('All pools and markets successfully discovered and verified!\n');

    process.exit(0);
  } catch (error) {
    console.error('\n✗ Pool discovery failed:', error);
    console.error('\nTroubleshooting:');
    console.error('- Ensure you have a stable internet connection');
    console.error('- Check that RPC endpoints are accessible');
    console.error('- Verify environment variables in .env file');
    console.error('- Try again in a few moments if RPC is temporarily unavailable\n');
    process.exit(1);
  }
}

// Run the script
findPools();
