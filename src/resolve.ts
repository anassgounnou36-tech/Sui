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
    // Fee-tier specific pools for Cetus fee-tier arbitrage
    suiUsdcPool005: PoolMetadata; // 0.05% fee tier
    suiUsdcPool025: PoolMetadata; // 0.25% fee tier
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
 * Resolve Cetus pool for SUI/USDC 0.05% fee tier (DEPRECATED - use resolveCetusPoolByFeeTier)
 * Kept for backward compatibility, but not used in main flow
 */
/*
async function resolveCetusPool(client: SuiClient): Promise<{
  globalConfigId: string;
  suiUsdcPool: PoolMetadata;
}> {
  logger.warn('⚠️  resolveCetusPool is deprecated. Use resolveCetusPoolByFeeTier instead.');
  
  // Cetus global config (consistent across mainnet)
  const globalConfigId =
    process.env.CETUS_GLOBAL_CONFIG_ID ||
    '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f';

  // Use the 0.05% pool as the default
  const poolMetadata = await resolveCetusPoolByFeeTier(
    client,
    500,
    'CETUS_POOL_ID_005',
    '0x51e883ba7c0b566a26cbc8a94cd33eb0abd418a77cc1e60ad22fd9b1f29cd2ab'
  );

  return { globalConfigId, suiUsdcPool: poolMetadata };
}
*/

/**
 * Resolve a specific Cetus pool by fee tier with strict RPC-based coin type verification
 * Helper function for Cetus fee-tier arbitrage (default strategy)
 * @param client SuiClient
 * @param feeTier Fee tier in basis points (e.g., 500 for 0.05%, 2500 for 0.25%)
 * @param envKey Environment variable key for override
 * @param defaultPoolId Default pool ID if no override
 * @returns Pool metadata with coin ordering
 */
async function resolveCetusPoolByFeeTier(
  client: SuiClient,
  feeTier: number,
  envKey: string,
  defaultPoolId: string
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

    // Enforce bridged USDC + SUI with strict type checking
    const hasSui = coinTypeA === COIN_TYPES.SUI || coinTypeB === COIN_TYPES.SUI;
    const hasBridgedUsdc = 
      coinTypeA === COIN_TYPES.BRIDGED_USDC || coinTypeB === COIN_TYPES.BRIDGED_USDC;

    // Hard fail on Wormhole USDC
    if (coinTypeA.includes(COIN_TYPES.WORMHOLE_USDC_HASH) ||
        coinTypeB.includes(COIN_TYPES.WORMHOLE_USDC_HASH)) {
      throw new Error(
        `Pool ${poolId} contains Wormhole USDC which is not supported.\n` +
        `Expected bridged USDC: ${COIN_TYPES.BRIDGED_USDC}\n` +
        `Found coin types: ${coinTypeA}, ${coinTypeB}`
      );
    }

    // Hard fail on native USDC
    if (coinTypeA.includes(COIN_TYPES.NATIVE_USDC_HASH) ||
        coinTypeB.includes(COIN_TYPES.NATIVE_USDC_HASH)) {
      throw new Error(
        `Pool ${poolId} contains native USDC which is not the expected bridged USDC.\n` +
        `Expected bridged USDC: ${COIN_TYPES.BRIDGED_USDC}\n` +
        `Found coin types: ${coinTypeA}, ${coinTypeB}`
      );
    }

    if (!hasSui || !hasBridgedUsdc) {
      const error = 
        `Pool ${poolId} does not contain SUI + bridged USDC.\n` +
        `Expected: ${COIN_TYPES.SUI} and ${COIN_TYPES.BRIDGED_USDC}\n` +
        `Found: ${coinTypeA}, ${coinTypeB}`;
      throw new Error(isOverride ? `Env override pool invalid: ${error}` : error);
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
 * Resolve Turbos pool for SUI/USDC 0.05% fee tier (DEPRECATED - no longer used)
 * Commented out since Turbos is no longer supported
 */
/*
async function resolveTurbosPool(_client: SuiClient): Promise<{
  factoryId: string;
  suiUsdcPool: PoolMetadata;
}> {
  logger.warn('⚠️  Turbos pool resolution is deprecated and will be skipped.');
  
  // Return stub data
  const factoryId =
    process.env.TURBOS_FACTORY_ID ||
    '0x91bfbc386a41afcfd9b2533058d7e915a1d3829089cc268ff4333d54d6339ca1';
  
  const stubPoolMetadata: PoolMetadata = {
    poolId: '',
    coinTypeA: COIN_TYPES.SUI,
    coinTypeB: COIN_TYPES.USDC,
    feeTier: 500,
    currentSqrtPrice: '0',
    liquidity: '0',
  };

  return { factoryId, suiUsdcPool: stubPoolMetadata };
}
*/

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
 * Default strategy: Cetus fee-tier arbitrage with SUI flashloans
 */
export async function resolvePoolAddresses(
  client: SuiClient
): Promise<ResolvedAddresses> {
  logger.info('=== Resolving Pool and Market Addresses ===');
  logger.info('Strategy: Cetus fee-tier arbitrage (0.05% vs 0.25%)');
  logger.info('Flashloan asset: SUI');
  logger.info(`Expected USDC type: ${COIN_TYPES.BRIDGED_USDC}`);
  logger.info('');

  try {
    // Cetus global config
    const globalConfigId =
      process.env.CETUS_GLOBAL_CONFIG_ID ||
      '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f';

    // Resolve Cetus fee-tier pools and lending markets in parallel
    const [pool005, pool025, suilend, navi] = await Promise.all([
      resolveCetusPoolByFeeTier(
        client,
        500, // 0.05%
        'CETUS_POOL_ID_005',
        '0x51e883ba7c0b566a26cbc8a94cd33eb0abd418a77cc1e60ad22fd9b1f29cd2ab'
      ),
      resolveCetusPoolByFeeTier(
        client,
        2500, // 0.25%
        'CETUS_POOL_ID_025',
        '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105'
      ),
      resolveSuilendMarket(client),
      resolveNaviStorage(client),
    ]);

    const resolved: ResolvedAddresses = {
      cetus: {
        globalConfigId,
        suiUsdcPool005: pool005,
        suiUsdcPool025: pool025,
      },
      suilend,
      navi,
    };

    // Cache the resolved addresses
    cachedAddresses = resolved;

    // Validate resolved pool configurations
    logger.info('=== Validating Pool Configurations ===');

    // Validate both Cetus pools have bridged USDC + SUI
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

    // Log summary
    logger.success('=== Address Resolution Complete ===');
    logger.info('Resolved addresses:');
    logger.info(`  Cetus Global Config: ${resolved.cetus.globalConfigId}`);
    logger.info(`  Cetus 0.05% Pool: ${resolved.cetus.suiUsdcPool005.poolId}`);
    logger.info(`  Cetus 0.25% Pool: ${resolved.cetus.suiUsdcPool025.poolId}`);
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
 */
export function getCetusPools(): {
  pool005: PoolMetadata;
  pool025: PoolMetadata;
  globalConfigId: string;
} {
  const resolved = getResolvedAddresses();
  
  if (!resolved.cetus.suiUsdcPool005 || !resolved.cetus.suiUsdcPool025) {
    throw new Error(
      'Fee-tier pools not available. Ensure pools are resolved via resolvePoolAddresses().'
    );
  }

  return {
    pool005: resolved.cetus.suiUsdcPool005,
    pool025: resolved.cetus.suiUsdcPool025,
    globalConfigId: resolved.cetus.globalConfigId,
  };
}
