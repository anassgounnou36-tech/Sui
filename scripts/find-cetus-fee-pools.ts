/**
 * Script to discover Cetus SUI/USDC(bridged) pools at 0.05% and 0.25% fee tiers
 * Uses raw RPC to verify coin types and extract pool metadata
 */

import { initializeRpcClient } from '../src/utils/sui';
import { logger } from '../src/logger';
import { COIN_TYPES } from '../src/addresses';
import Decimal from 'decimal.js';

interface PoolInfo {
  poolId: string;
  coinTypeA: string;
  coinTypeB: string;
  feeTier: number;
  currentSqrtPrice: string;
  liquidity: string;
  price: number;
}

const BRIDGED_USDC = COIN_TYPES.BRIDGED_USDC;
const SUI = COIN_TYPES.SUI;

// Known Cetus pool IDs for bridged USDC/SUI
const KNOWN_POOL_IDS = {
  '0.05%': '0x51e883ba7c0b566a26cbc8a94cd33eb0abd418a77cc1e60ad22fd9b1f29cd2ab',
  '0.25%': '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105',
};

/**
 * Calculate price from sqrtPrice
 */
function calculatePrice(
  sqrtPrice: string,
  coinTypeA: string,
  coinTypeB: string
): number {
  const sqrtPriceDec = new Decimal(sqrtPrice);
  const Q64 = new Decimal(2).pow(64);
  
  // Price = (sqrtPrice / 2^64)^2
  const priceRatio = sqrtPriceDec.div(Q64).pow(2);
  
  // Determine decimals based on coin order
  const aIsUsdc = coinTypeA.includes('usdc') || coinTypeA.includes('USDC');
  const bIsUsdc = coinTypeB.includes('usdc') || coinTypeB.includes('USDC');
  
  // Adjust for decimal difference (USDC: 6, SUI: 9)
  let price: number;
  if (aIsUsdc && !bIsUsdc) {
    // Pool is USDC/SUI, so price is USDC per SUI
    const decimalAdjustment = new Decimal(10).pow(9 - 6);
    price = priceRatio.mul(decimalAdjustment).toNumber();
  } else if (!aIsUsdc && bIsUsdc) {
    // Pool is SUI/USDC, so price is SUI per USDC - need to invert
    const decimalAdjustment = new Decimal(10).pow(6 - 9);
    const rawPrice = priceRatio.mul(decimalAdjustment).toNumber();
    price = 1 / rawPrice;
  } else {
    // Unknown ordering, use raw ratio
    price = priceRatio.toNumber();
  }
  
  return price;
}

/**
 * Fetch and verify a pool by ID
 */
async function fetchPoolInfo(poolId: string): Promise<PoolInfo | null> {
  try {
    const client = initializeRpcClient();
    
    const poolObj = await client.getObject({
      id: poolId,
      options: { showContent: true, showType: true },
    });
    
    if (!poolObj.data || !poolObj.data.content) {
      logger.warn(`Pool not found: ${poolId}`);
      return null;
    }
    
    const content = poolObj.data.content as any;
    if (content.dataType !== 'moveObject') {
      logger.warn(`Invalid pool object type: ${poolId}`);
      return null;
    }
    
    const fields = content.fields;
    
    // Extract type arguments using raw RPC type string
    const poolType = poolObj.data.type;
    if (!poolType) {
      logger.warn(`Pool type not found: ${poolId}`);
      return null;
    }
    
    // Parse Pool<CoinA, CoinB> type
    const typeMatch = poolType.match(/Pool<([^,]+),\s*([^>]+)>/);
    if (!typeMatch) {
      logger.warn(`Cannot parse pool type: ${poolType}`);
      return null;
    }
    
    const [, coinTypeA, coinTypeB] = typeMatch;
    
    // Verify this is SUI/bridged-USDC pool
    const hasSui = coinTypeA === SUI || coinTypeB === SUI;
    const hasBridgedUsdc = coinTypeA === BRIDGED_USDC || coinTypeB === BRIDGED_USDC;
    
    if (!hasSui || !hasBridgedUsdc) {
      logger.warn(`Pool does not contain SUI + bridged USDC: ${poolId}`);
      logger.warn(`  Found: ${coinTypeA}, ${coinTypeB}`);
      return null;
    }
    
    // Extract pool metadata
    const feeRate = Number(fields.fee_rate || fields.fee || 0);
    const currentSqrtPrice = fields.current_sqrt_price || fields.sqrt_price || '0';
    const liquidity = fields.liquidity || '0';
    
    // Calculate price
    const price = calculatePrice(currentSqrtPrice.toString(), coinTypeA, coinTypeB);
    
    return {
      poolId,
      coinTypeA,
      coinTypeB,
      feeTier: feeRate,
      currentSqrtPrice: currentSqrtPrice.toString(),
      liquidity: liquidity.toString(),
      price,
    };
  } catch (error) {
    logger.error(`Failed to fetch pool ${poolId}:`, error);
    return null;
  }
}

/**
 * Main function
 */
async function main() {
  try {
    logger.info('=== Cetus Fee-Tier Pool Discovery ===');
    logger.info('Searching for SUI/USDC(bridged) pools at 0.05% and 0.25% fee tiers...\n');
    
    const pools: PoolInfo[] = [];
    
    // Fetch known pools
    for (const [feeTier, poolId] of Object.entries(KNOWN_POOL_IDS)) {
      logger.info(`Checking ${feeTier} fee tier pool: ${poolId}...`);
      const poolInfo = await fetchPoolInfo(poolId);
      
      if (poolInfo) {
        pools.push(poolInfo);
        logger.success(`✓ Found ${feeTier} pool`);
        logger.info(`  Pool ID: ${poolInfo.poolId}`);
        logger.info(`  Coin A: ${poolInfo.coinTypeA.split('::').pop()}`);
        logger.info(`  Coin B: ${poolInfo.coinTypeB.split('::').pop()}`);
        logger.info(`  Fee: ${(poolInfo.feeTier / 10000).toFixed(2)}%`);
        logger.info(`  Price: ${poolInfo.price.toFixed(6)} USDC/SUI`);
        logger.info(`  Liquidity: ${poolInfo.liquidity}`);
        logger.info('');
      } else {
        logger.error(`✗ Failed to verify ${feeTier} pool\n`);
      }
    }
    
    // Display results summary
    logger.info('=== Summary ===');
    
    if (pools.length === 0) {
      logger.error('No valid pools found. Please check pool IDs and coin types.');
      process.exit(1);
    }
    
    logger.success(`Found ${pools.length} valid Cetus fee-tier pools:\n`);
    
    pools.forEach((pool) => {
      const feeTier = (pool.feeTier / 10000).toFixed(2);
      logger.info(`${feeTier}% Fee Tier:`);
      logger.info(`  Pool ID: ${pool.poolId}`);
      logger.info(`  Coin Order: ${pool.coinTypeA === SUI ? 'SUI/USDC' : 'USDC/SUI'}`);
      logger.info(`  Price: ${pool.price.toFixed(6)} USDC per SUI`);
      logger.info('');
    });
    
    // Calculate spread if we have both pools
    if (pools.length === 2) {
      const [pool1, pool2] = pools;
      const spreadPercent = Math.abs(pool1.price - pool2.price) / Math.min(pool1.price, pool2.price) * 100;
      
      logger.info('=== Arbitrage Opportunity ===');
      logger.info(`Current spread: ${spreadPercent.toFixed(4)}%`);
      
      if (spreadPercent >= 0.5) {
        logger.success('✓ Spread above 0.5% threshold - arbitrage may be profitable!');
      } else {
        logger.warn('⚠ Spread below 0.5% - arbitrage may not be profitable after fees');
      }
      logger.info('');
    }
    
    // Output recommended .env configuration
    logger.info('=== Recommended .env Configuration ===');
    logger.info('Add these lines to your .env file:\n');
    logger.info('MODE=CETUS_FEE_TIER_ARB');
    logger.info('FLASHLOAN_ASSET=SUI');
    
    pools.forEach((pool) => {
      const feeTier = pool.feeTier === 500 ? '005' : '025';
      logger.info(`CETUS_POOL_ID_${feeTier}=${pool.poolId}`);
    });
    
    logger.info(`BRIDGED_USDC_COIN_TYPE=${BRIDGED_USDC}`);
    logger.info('');
    
    logger.success('Pool discovery complete!');
    process.exit(0);
  } catch (error) {
    logger.error('Pool discovery failed:', error);
    process.exit(1);
  }
}

// Run main
main();
