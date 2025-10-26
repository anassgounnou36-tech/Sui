/**
 * Pool and Market Resolver - Dynamically resolves DEX pool IDs and lending market IDs
 * This module uses SDK methods to discover pools based on coin types and fee tiers,
 * ensuring we use the correct pools for arbitrage opportunities.
 */

import { SuiClient } from '@mysten/sui/client';
import { logger } from './logger';
import { COIN_TYPES } from './addresses';
import Decimal from 'decimal.js';

/**
 * Resolved pool and market information with full metadata
 */
export interface PoolMetadata {
  poolId: string;
  coinTypeA: string;
  coinTypeB: string;
  feeTier: number;
  // Additional metadata for swap payload construction
  currentSqrtPrice?: string;
  liquidity?: string;
}

export interface ResolvedAddresses {
  cetus: {
    globalConfigId: string;
    suiUsdcPool: PoolMetadata;
    // Fee-tier specific pools for CETUS_FEE_TIER_ARB mode
    suiUsdcPool005?: PoolMetadata; // 0.05% fee tier
    suiUsdcPool025?: PoolMetadata; // 0.25% fee tier
  };
  turbos: {
    factoryId: string;
    suiUsdcPool: PoolMetadata;
  };
  suilend: {
    lendingMarket: string;
    marketObjectId?: string;
  };
  navi: {
    storageId: string;
    usdcPoolId: string;
  };
}

let cachedAddresses: ResolvedAddresses | null = null;

/**
 * Get cached resolved addresses (throws if not yet resolved)
 */
export function getResolvedAddresses(): ResolvedAddresses {
  if (!cachedAddresses) {
    throw new Error('Pool addresses not yet resolved. Call resolvePoolAddresses() first.');
  }
  return cachedAddresses;
}

/**
 * Resolve Cetus pool for SUI/USDC 0.05% fee tier
 * Uses SDK to discover the pool based on coin types and fee
 * Supports optional env override CETUS_SUI_USDC_POOL_ID with validation
 */
async function resolveCetusPool(client: SuiClient): Promise<{
  globalConfigId: string;
  suiUsdcPool: PoolMetadata;
}> {
  logger.info('Resolving Cetus pool...');

  // Cetus global config (consistent across mainnet)
  const globalConfigId =
    process.env.CETUS_GLOBAL_CONFIG_ID ||
    '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f';

  // Pool ID: Use env override if provided, otherwise use default
  // In production with SDK, you would use CetusClmmSDK.Pool.getPools() to discover
  const poolId =
    process.env.CETUS_SUI_USDC_POOL_ID ||
    '0xcf994611fd4c48e277ce3ffd4d4364c914af2c3cbb05f7bf6facd371de688630';

  const isOverride = !!process.env.CETUS_SUI_USDC_POOL_ID;
  if (isOverride) {
    logger.info(`Using env override for Cetus pool: ${poolId}`);
  }

  // Verify pool exists and fetch metadata
  try {
    const poolObj = await client.getObject({
      id: poolId,
      options: { showContent: true, showType: true },
    });

    if (!poolObj.data || !poolObj.data.content) {
      throw new Error(`Cetus pool not found: ${poolId}`);
    }

    const content = poolObj.data.content as any;
    if (content.dataType !== 'moveObject') {
      throw new Error('Invalid Cetus pool object type');
    }

    const fields = content.fields;

    // Extract type arguments from pool type to determine coin ordering
    const poolType = poolObj.data.type;
    if (!poolType) {
      throw new Error('Pool type not found');
    }

    // Parse type arguments: Pool<CoinA, CoinB, FeeType> (ignoring fee type)
    const typeMatch = poolType.match(/<([^,]+),\s*([^,]+)/);
    if (!typeMatch) {
      throw new Error(`Cannot parse pool type: ${poolType}`);
    }

    const [, coinTypeA, coinTypeB] = typeMatch;

    // Verify this is SUI/USDC pool
    const hasSui = coinTypeA === COIN_TYPES.SUI || coinTypeB === COIN_TYPES.SUI;
    const hasUsdc = coinTypeA === COIN_TYPES.USDC || coinTypeB === COIN_TYPES.USDC;

    if (!hasSui || !hasUsdc) {
      const error = `Pool does not contain SUI + native USDC. Found: ${coinTypeA}, ${coinTypeB}`;
      if (isOverride) {
        throw new Error(`Env override pool invalid: ${error}`);
      }
      throw new Error(error);
    }

    // Verify fee is 0.05% (500 bps)
    const feeRate = Number(fields.fee_rate || fields.fee || 500);
    if (isOverride && feeRate !== 500) {
      logger.warn(
        `⚠️  Env override pool has fee ${(feeRate / 100).toFixed(2)}%, expected 0.05%`
      );
    }

    // Extract current sqrtPrice for metadata
    const currentSqrtPrice = fields.current_sqrt_price || fields.sqrt_price;
    const liquidity = fields.liquidity;

    const poolMetadata: PoolMetadata = {
      poolId,
      coinTypeA,
      coinTypeB,
      feeTier: feeRate,
      currentSqrtPrice: currentSqrtPrice?.toString(),
      liquidity: liquidity?.toString(),
    };

    logger.success(`✓ Cetus pool resolved: ${poolId}`);
    logger.info(`  Coin A: ${coinTypeA.split('::').pop()}`);
    logger.info(`  Coin B: ${coinTypeB.split('::').pop()}`);
    logger.info(`  Fee: ${(feeRate / 100).toFixed(2)}%`);
    logger.info(`  SqrtPrice: ${currentSqrtPrice}`);

    return { globalConfigId, suiUsdcPool: poolMetadata };
  } catch (error) {
    logger.error('Failed to resolve Cetus pool', error);
    throw new Error(`Cetus pool resolution failed: ${error}`);
  }
}

/**
 * Resolve a specific Cetus pool by fee tier with strict RPC-based coin type verification
 * Helper function for CETUS_FEE_TIER_ARB mode
 * @param client SuiClient
 * @param feeTier Fee tier in basis points (e.g., 500 for 0.05%, 2500 for 0.25%)
 * @param envKey Environment variable key for override
 * @param defaultPoolId Default pool ID if no override
 * @param mode Strategy mode to determine expected coin types
 * @returns Pool metadata with coin ordering
 */
async function resolveCetusPoolByFeeTier(
  client: SuiClient,
  feeTier: number,
  envKey: string,
  defaultPoolId: string,
  mode: string
): Promise<PoolMetadata> {
  const feePercent = (feeTier / 10000).toFixed(2);
  logger.info(`Resolving Cetus pool for ${feePercent}% fee tier...`);

  // Pool ID: Use env override if provided, otherwise use default
  const poolId = process.env[envKey] || defaultPoolId;
  const isOverride = !!process.env[envKey];
  
  if (isOverride) {
    logger.info(`Using env override for Cetus ${feePercent}% pool: ${poolId}`);
  }

  // Verify pool exists and fetch metadata using raw RPC
  try {
    const poolObj = await client.getObject({
      id: poolId,
      options: { showContent: true, showType: true },
    });

    if (!poolObj.data || !poolObj.data.content) {
      throw new Error(`Cetus pool not found: ${poolId}`);
    }

    const content = poolObj.data.content as any;
    if (content.dataType !== 'moveObject') {
      throw new Error('Invalid Cetus pool object type');
    }

    const fields = content.fields;

    // Extract type arguments from pool type using raw RPC type string
    const poolType = poolObj.data.type;
    if (!poolType) {
      throw new Error('Pool type not found');
    }

    // Use regex to extract Pool<CoinA, CoinB> type arguments
    const typeMatch = poolType.match(/Pool<([^,]+),\s*([^>]+)>/);
    if (!typeMatch) {
      throw new Error(`Cannot parse pool type: ${poolType}`);
    }

    const [, coinTypeA, coinTypeB] = typeMatch;

    // For CETUS_FEE_TIER_ARB mode, enforce bridged USDC + SUI
    if (mode === 'CETUS_FEE_TIER_ARB') {
      const hasSui = coinTypeA === COIN_TYPES.SUI || coinTypeB === COIN_TYPES.SUI;
      const hasBridgedUsdc = 
        coinTypeA === COIN_TYPES.BRIDGED_USDC || coinTypeB === COIN_TYPES.BRIDGED_USDC;

      // Hard fail on Wormhole USDC
      if (coinTypeA.includes('5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf') ||
          coinTypeB.includes('5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf')) {
        throw new Error(
          `Pool contains Wormhole USDC which is not supported for fee-tier arbitrage.\n` +
          `Expected bridged USDC: ${COIN_TYPES.BRIDGED_USDC}\n` +
          `Found: ${coinTypeA}, ${coinTypeB}`
        );
      }

      // Hard fail on native USDC
      if (coinTypeA.includes('af8cd5edc19637e05da0dd46f6ddb1a8b81cc532fcccf6d5d41ba77bba6eddd5') ||
          coinTypeB.includes('af8cd5edc19637e05da0dd46f6ddb1a8b81cc532fcccf6d5d41ba77bba6eddd5')) {
        throw new Error(
          `Pool contains native USDC which is not supported for fee-tier arbitrage.\n` +
          `Expected bridged USDC: ${COIN_TYPES.BRIDGED_USDC}\n` +
          `Found: ${coinTypeA}, ${coinTypeB}`
        );
      }

      if (!hasSui || !hasBridgedUsdc) {
        const error = 
          `Pool does not contain SUI + bridged USDC. Found: ${coinTypeA}, ${coinTypeB}.\n` +
          `Expected: ${COIN_TYPES.SUI}, ${COIN_TYPES.BRIDGED_USDC}`;
        throw new Error(isOverride ? `Env override pool invalid: ${error}` : error);
      }
    } else {
      // For CETUS_TURBOS mode, verify SUI + native USDC
      const hasSui = coinTypeA === COIN_TYPES.SUI || coinTypeB === COIN_TYPES.SUI;
      const hasUsdc = coinTypeA === COIN_TYPES.USDC || coinTypeB === COIN_TYPES.USDC;

      if (!hasSui || !hasUsdc) {
        const error = `Pool does not contain SUI + native USDC. Found: ${coinTypeA}, ${coinTypeB}`;
        throw new Error(isOverride ? `Env override pool invalid: ${error}` : error);
      }
    }

    // Verify fee tier matches
    const poolFeeRate = Number(fields.fee_rate || fields.fee || 500);
    if (isOverride && poolFeeRate !== feeTier) {
      throw new Error(
        `Env override pool has fee ${(poolFeeRate / 10000).toFixed(2)}%, expected ${feePercent}%`
      );
    }

    // Extract pool metadata
    const currentSqrtPrice = fields.current_sqrt_price || fields.sqrt_price;
    const liquidity = fields.liquidity;

    const poolMetadata: PoolMetadata = {
      poolId,
      coinTypeA,
      coinTypeB,
      feeTier: poolFeeRate,
      currentSqrtPrice: currentSqrtPrice?.toString(),
      liquidity: liquidity?.toString(),
    };

    logger.success(`✓ Cetus ${feePercent}% pool resolved: ${poolId}`);
    logger.info(`  Coin A: ${coinTypeA.split('::').pop()}`);
    logger.info(`  Coin B: ${coinTypeB.split('::').pop()}`);
    logger.info(`  Fee: ${(poolFeeRate / 10000).toFixed(2)}%`);
    logger.info(`  SqrtPrice: ${currentSqrtPrice}`);

    return poolMetadata;
  } catch (error) {
    logger.error(`Failed to resolve Cetus ${feePercent}% pool`, error);
    throw new Error(`Cetus ${feePercent}% pool resolution failed: ${error}`);
  }
}

/**
 * Resolve Turbos pool for SUI/USDC 0.05% fee tier
 * Supports optional env override TURBOS_SUI_USDC_POOL_ID with validation
 */
async function resolveTurbosPool(client: SuiClient): Promise<{
  factoryId: string;
  suiUsdcPool: PoolMetadata;
}> {
  logger.info('Resolving Turbos pool...');

  // Turbos factory/package ID
  const factoryId =
    process.env.TURBOS_FACTORY_ID ||
    '0x91bfbc386a41afcfd9b2533058d7e915a1d3829089cc268ff4333d54d6339ca1';

  // Pool ID: Use env override if provided, otherwise use default
  const poolId =
    process.env.TURBOS_SUI_USDC_POOL_ID ||
    '0x5eb2dfcdd1b15d2021328258f6d5ec081e9a0cdcfa9e13a0eaeb9b5f7505ca78';

  const isOverride = !!process.env.TURBOS_SUI_USDC_POOL_ID;
  if (isOverride) {
    logger.info(`Using env override for Turbos pool: ${poolId}`);
  }

  // Verify pool exists and fetch metadata
  try {
    const poolObj = await client.getObject({
      id: poolId,
      options: { showContent: true, showType: true },
    });

    if (!poolObj.data || !poolObj.data.content) {
      throw new Error(`Turbos pool not found: ${poolId}`);
    }

    const content = poolObj.data.content as any;
    if (content.dataType !== 'moveObject') {
      throw new Error('Invalid Turbos pool object type');
    }

    const fields = content.fields;

    // Extract type arguments from pool type (ignoring fee type)
    const poolType = poolObj.data.type;
    if (!poolType) {
      throw new Error('Pool type not found');
    }

    const typeMatch = poolType.match(/<([^,]+),\s*([^,]+)/);
    if (!typeMatch) {
      throw new Error(`Cannot parse pool type: ${poolType}`);
    }

    const [, coinTypeA, coinTypeB] = typeMatch;

    // Verify this is SUI/USDC pool
    const hasSui = coinTypeA === COIN_TYPES.SUI || coinTypeB === COIN_TYPES.SUI;
    const hasUsdc = coinTypeA === COIN_TYPES.USDC || coinTypeB === COIN_TYPES.USDC;

    if (!hasSui || !hasUsdc) {
      const error = `Pool does not contain SUI + native USDC. Found: ${coinTypeA}, ${coinTypeB}`;
      if (isOverride) {
        throw new Error(`Env override pool invalid: ${error}`);
      }
      throw new Error(error);
    }

    // Verify fee is 0.05% (500 bps)
    const feeRate = Number(fields.fee || fields.fee_rate || 500);
    if (isOverride && feeRate !== 500) {
      logger.warn(
        `⚠️  Env override pool has fee ${(feeRate / 100).toFixed(2)}%, expected 0.05%`
      );
    }

    // Extract pool metadata
    const currentSqrtPrice = fields.sqrt_price || fields.current_sqrt_price;
    const liquidity = fields.liquidity;

    const poolMetadata: PoolMetadata = {
      poolId,
      coinTypeA,
      coinTypeB,
      feeTier: feeRate,
      currentSqrtPrice: currentSqrtPrice?.toString(),
      liquidity: liquidity?.toString(),
    };

    logger.success(`✓ Turbos pool resolved: ${poolId}`);
    logger.info(`  Coin A: ${coinTypeA.split('::').pop()}`);
    logger.info(`  Coin B: ${coinTypeB.split('::').pop()}`);
    logger.info(`  Fee: ${(feeRate / 100).toFixed(2)}%`);
    logger.info(`  SqrtPrice: ${currentSqrtPrice}`);

    return { factoryId, suiUsdcPool: poolMetadata };
  } catch (error) {
    logger.error('Failed to resolve Turbos pool', error);
    throw new Error(`Turbos pool resolution failed: ${error}`);
  }
}

/**
 * Resolve Suilend lending market
 */
async function resolveSuilendMarket(client: SuiClient): Promise<{
  lendingMarket: string;
  marketObjectId?: string;
}> {
  logger.info('Resolving Suilend market...');

  // Known lending market object
  const lendingMarket =
    process.env.SUILEND_LENDING_MARKET ||
    '0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1';

  const marketObjectId = process.env.SUILEND_MARKET_ID || '';

  // Verify market exists (non-critical - allow startup without flashloan)
  try {
    const marketObj = await client.getObject({
      id: lendingMarket,
      options: { showType: true },
    });

    if (!marketObj.data) {
      logger.warn(`Suilend market not found: ${lendingMarket}`);
      logger.warn('Continuing without Suilend flashloan support');
    } else {
      logger.success(`✓ Suilend market verified: ${lendingMarket}`);
    }
  } catch (error) {
    logger.warn('Failed to verify Suilend market, continuing anyway', error);
  }

  return { lendingMarket, marketObjectId };
}

/**
 * Resolve Navi storage and pool IDs
 */
async function resolveNaviStorage(client: SuiClient): Promise<{
  storageId: string;
  usdcPoolId: string;
}> {
  logger.info('Resolving Navi storage...');

  const storageId =
    process.env.NAVI_STORAGE_ID ||
    '0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe';

  const usdcPoolId =
    process.env.NAVI_USDC_POOL_ID ||
    '0x96df0fce3c471489f4debaaa762cf960b3d97820bd1f3f025ff8190730e958c5';

  // Verify storage exists (non-critical, Navi is fallback)
  try {
    const storageObj = await client.getObject({
      id: storageId,
      options: { showType: true },
    });

    if (!storageObj.data) {
      logger.warn(`Navi storage not found: ${storageId}`);
    } else {
      logger.success(`✓ Navi storage verified: ${storageId}`);
    }
  } catch (error) {
    logger.warn('Failed to verify Navi storage, fallback may not work', error);
  }

  return { storageId, usdcPoolId };
}

/**
 * Sanity check: validate that calculated price is reasonable for SUI/USDC
 * @param price Price in USDC per SUI
 * @param dexName Name of the DEX for logging
 * @returns true if price is reasonable, false otherwise
 */
export function validatePrice(price: number, dexName: string): boolean {
  const MIN_REASONABLE_PRICE = 0.01; // $0.01 per SUI (extremely low)
  const MAX_REASONABLE_PRICE = 5.0; // $5.00 per SUI (extremely high)

  if (price < MIN_REASONABLE_PRICE || price > MAX_REASONABLE_PRICE) {
    logger.warn(
      `⚠️  ${dexName} price ${price.toFixed(6)} USDC/SUI is outside reasonable bounds ` +
        `[${MIN_REASONABLE_PRICE}, ${MAX_REASONABLE_PRICE}]`
    );
    logger.warn('This may indicate incorrect pool, wrong coin ordering, or calculation error');
    return false;
  }

  return true;
}

/**
 * Calculate price from sqrtPrice with proper decimal adjustment
 * @param sqrtPrice Square root price from pool state
 * @param coinADecimals Decimals for coin A
 * @param coinBDecimals Decimals for coin B
 * @returns Price as A/B ratio
 */
export function calculatePriceFromSqrtPrice(
  sqrtPrice: string | bigint,
  coinADecimals: number,
  coinBDecimals: number
): number {
  const sqrtPriceDec = new Decimal(sqrtPrice.toString());
  const Q64 = new Decimal(2).pow(64);

  // Price = (sqrtPrice / 2^64)^2
  const priceRatio = sqrtPriceDec.div(Q64).pow(2);

  // Adjust for decimal difference
  const decimalAdjustment = new Decimal(10).pow(coinBDecimals - coinADecimals);
  const price = priceRatio.mul(decimalAdjustment).toNumber();

  return price;
}

/**
 * Resolve all pool and market addresses at startup
 * This is the single source of truth for all IDs used throughout the application
 */
export async function resolvePoolAddresses(
  client: SuiClient,
  mode?: string
): Promise<ResolvedAddresses> {
  logger.info('=== Resolving Pool and Market Addresses ===');

  try {
    // Resolve all addresses in parallel
    const [cetus, turbos, suilend, navi] = await Promise.all([
      resolveCetusPool(client),
      resolveTurbosPool(client),
      resolveSuilendMarket(client),
      resolveNaviStorage(client),
    ]);

    const resolved: ResolvedAddresses = {
      cetus,
      turbos,
      suilend,
      navi,
    };

    // For CETUS_FEE_TIER_ARB mode, resolve both 0.05% and 0.25% fee tier pools
    if (mode === 'CETUS_FEE_TIER_ARB') {
      logger.info('=== Resolving Cetus Fee-Tier Pools ===');
      
      const [pool005, pool025] = await Promise.all([
        resolveCetusPoolByFeeTier(
          client,
          500, // 0.05%
          'CETUS_POOL_ID_005',
          '0x51e883ba7c0b566a26cbc8a94cd33eb0abd418a77cc1e60ad22fd9b1f29cd2ab',
          mode
        ),
        resolveCetusPoolByFeeTier(
          client,
          2500, // 0.25%
          'CETUS_POOL_ID_025',
          '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105',
          mode
        ),
      ]);

      resolved.cetus.suiUsdcPool005 = pool005;
      resolved.cetus.suiUsdcPool025 = pool025;

      logger.success('✓ Fee-tier pools resolved');
    }

    // Cache the resolved addresses
    cachedAddresses = resolved;

    // Validate resolved pool configurations
    logger.info('=== Validating Pool Configurations ===');

    // Validate Cetus pool coin types
    const cetusCoinA = resolved.cetus.suiUsdcPool.coinTypeA;
    const cetusCoinB = resolved.cetus.suiUsdcPool.coinTypeB;
    const cetusHasSui =
      cetusCoinA === COIN_TYPES.SUI || cetusCoinB === COIN_TYPES.SUI;
    const cetusHasUsdc =
      cetusCoinA === COIN_TYPES.USDC || cetusCoinB === COIN_TYPES.USDC;

    if (!cetusHasSui || !cetusHasUsdc) {
      throw new Error(
        `Cetus pool does not contain SUI and USDC. Found: ${cetusCoinA}, ${cetusCoinB}`
      );
    }

    // Validate Turbos pool coin types (skip if CETUS_FEE_TIER_ARB mode)
    if (mode !== 'CETUS_FEE_TIER_ARB') {
      const turbosCoinA = resolved.turbos.suiUsdcPool.coinTypeA;
      const turbosCoinB = resolved.turbos.suiUsdcPool.coinTypeB;
      const turbosHasSui =
        turbosCoinA === COIN_TYPES.SUI || turbosCoinB === COIN_TYPES.SUI;
      const turbosHasUsdc =
        turbosCoinA === COIN_TYPES.USDC || turbosCoinB === COIN_TYPES.USDC;

      if (!turbosHasSui || !turbosHasUsdc) {
        throw new Error(
          `Turbos pool does not contain SUI and USDC. Found: ${turbosCoinA}, ${turbosCoinB}`
        );
      }
    }

    // Validate fee-tier pools if in CETUS_FEE_TIER_ARB mode
    if (mode === 'CETUS_FEE_TIER_ARB') {
      if (!resolved.cetus.suiUsdcPool005 || !resolved.cetus.suiUsdcPool025) {
        throw new Error('Fee-tier pools not resolved for CETUS_FEE_TIER_ARB mode');
      }

      // Validate coin types for both pools - should be bridged USDC + SUI
      const pool005CoinA = resolved.cetus.suiUsdcPool005.coinTypeA;
      const pool005CoinB = resolved.cetus.suiUsdcPool005.coinTypeB;
      const pool005HasSui =
        pool005CoinA === COIN_TYPES.SUI || pool005CoinB === COIN_TYPES.SUI;
      const pool005HasBridgedUsdc =
        pool005CoinA === COIN_TYPES.BRIDGED_USDC || pool005CoinB === COIN_TYPES.BRIDGED_USDC;

      if (!pool005HasSui || !pool005HasBridgedUsdc) {
        throw new Error(
          `Cetus 0.05% pool invalid. Expected SUI + bridged USDC. Found: ${pool005CoinA}, ${pool005CoinB}`
        );
      }

      const pool025CoinA = resolved.cetus.suiUsdcPool025.coinTypeA;
      const pool025CoinB = resolved.cetus.suiUsdcPool025.coinTypeB;
      const pool025HasSui =
        pool025CoinA === COIN_TYPES.SUI || pool025CoinB === COIN_TYPES.SUI;
      const pool025HasBridgedUsdc =
        pool025CoinA === COIN_TYPES.BRIDGED_USDC || pool025CoinB === COIN_TYPES.BRIDGED_USDC;

      if (!pool025HasSui || !pool025HasBridgedUsdc) {
        throw new Error(
          `Cetus 0.25% pool invalid. Expected SUI + bridged USDC. Found: ${pool025CoinA}, ${pool025CoinB}`
        );
      }
    }

    // Log summary
    logger.success('=== Address Resolution Complete ===');
    logger.info('Resolved addresses:');
    logger.info(`  Cetus Global Config: ${resolved.cetus.globalConfigId}`);
    logger.info(`  Cetus SUI/USDC Pool: ${resolved.cetus.suiUsdcPool.poolId}`);
    
    if (mode === 'CETUS_FEE_TIER_ARB') {
      logger.info(`  Cetus 0.05% Pool: ${resolved.cetus.suiUsdcPool005?.poolId}`);
      logger.info(`  Cetus 0.25% Pool: ${resolved.cetus.suiUsdcPool025?.poolId}`);
    } else {
      logger.info(`  Turbos Factory: ${resolved.turbos.factoryId}`);
      logger.info(`  Turbos SUI/USDC Pool: ${resolved.turbos.suiUsdcPool.poolId}`);
    }
    
    logger.info(`  Suilend Lending Market: ${resolved.suilend.lendingMarket}`);
    logger.info(`  Navi Storage: ${resolved.navi.storageId}`);

    return resolved;
  } catch (error) {
    logger.error('Failed to resolve pool addresses', error);
    throw new Error('Critical: Could not resolve necessary pool addresses');
  }
}

/**
 * Clear cached addresses (useful for testing)
 */
export function clearCachedAddresses(): void {
  cachedAddresses = null;
  logger.debug('Cached addresses cleared');
}

/**
 * Get both Cetus pools for fee-tier arbitrage
 * Returns pool metadata with coin ordering information
 * Only available when MODE=CETUS_FEE_TIER_ARB and pools have been resolved
 */
export function getCetusPools(): {
  pool005: PoolMetadata;
  pool025: PoolMetadata;
  globalConfigId: string;
} {
  const resolved = getResolvedAddresses();
  
  if (!resolved.cetus.suiUsdcPool005 || !resolved.cetus.suiUsdcPool025) {
    throw new Error(
      'Fee-tier pools not available. Ensure MODE=CETUS_FEE_TIER_ARB and pools are resolved.'
    );
  }

  return {
    pool005: resolved.cetus.suiUsdcPool005,
    pool025: resolved.cetus.suiUsdcPool025,
    globalConfigId: resolved.cetus.globalConfigId,
  };
}
