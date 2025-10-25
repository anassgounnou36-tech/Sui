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
 * Target fee tier for arbitrage pools (0.05% = 500 basis points)
 */
const TARGET_FEE_TIER = 500;

/**
 * Sui object ID format validation regex
 * Sui object IDs are 32-byte hex strings, often prefixed with 0x
 */
const SUI_OBJECT_ID_REGEX = /^0x[0-9a-fA-F]{64}$/;

/**
 * Validate Sui object ID format
 * @param id The object ID to validate
 * @returns true if valid, false otherwise
 */
function isValidSuiObjectId(id: string): boolean {
  return SUI_OBJECT_ID_REGEX.test(id);
}

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
 * Robustly parse pool type arguments from a Move type string
 * Handles nested generics like Pool<CoinA, CoinB, Fee<...>>
 * Returns only the coin types (first 2 type arguments)
 */
function parsePoolTypeArguments(poolType: string): string[] {
  // Find the start of type arguments
  const start = poolType.indexOf('<');
  const end = poolType.lastIndexOf('>');
  
  if (start === -1 || end === -1) {
    return [];
  }
  
  const typeArgs = poolType.substring(start + 1, end);
  const result: string[] = [];
  let current = '';
  let depth = 0;
  
  // Parse type arguments while tracking nesting depth
  for (let i = 0; i < typeArgs.length; i++) {
    const char = typeArgs[i];
    
    if (char === '<') {
      depth++;
      current += char;
    } else if (char === '>') {
      depth--;
      current += char;
    } else if (char === ',' && depth === 0) {
      // Top-level comma - this separates type arguments
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  // Add the last argument
  if (current.trim()) {
    result.push(current.trim());
  }
  
  // Only return the first 2 arguments (coin types), ignore fee structs
  return result.slice(0, 2);
}

/**
 * Verify a pool by ID and extract metadata
 */
async function verifyAndExtractPoolMetadata(
  client: SuiClient,
  poolId: string,
  dexName: string
): Promise<PoolMetadata> {
  const poolObj = await client.getObject({
    id: poolId,
    options: { showContent: true, showType: true },
  });

  if (!poolObj.data || !poolObj.data.content) {
    throw new Error(`${dexName} pool not found: ${poolId}`);
  }

  const content = poolObj.data.content as any;
  if (content.dataType !== 'moveObject') {
    throw new Error(`Invalid ${dexName} pool object type`);
  }

  const poolType = poolObj.data.type;
  if (!poolType) {
    throw new Error('Pool type not found');
  }

  // Parse type arguments robustly (only coin types, not fee struct)
  const typeArgs = parsePoolTypeArguments(poolType);
  if (typeArgs.length < 2) {
    throw new Error(
      `Cannot parse pool type arguments from ${poolType}. ` +
      `Expected at least 2 coin types but got ${typeArgs.length}`
    );
  }

  const [coinTypeA, coinTypeB] = typeArgs;

  // Verify this is SUI/USDC with native USDC
  const hasSui = coinTypeA === COIN_TYPES.SUI || coinTypeB === COIN_TYPES.SUI;
  const hasUsdc = coinTypeA === COIN_TYPES.USDC || coinTypeB === COIN_TYPES.USDC;

  if (!hasSui || !hasUsdc) {
    throw new Error(
      `${dexName} pool does not contain SUI and native USDC. ` +
      `Found: Coin A = ${coinTypeA}, Coin B = ${coinTypeB}. ` +
      `Expected native USDC: ${COIN_TYPES.USDC}`
    );
  }

  const fields = content.fields;
  const currentSqrtPrice = 
    fields.current_sqrt_price || fields.sqrt_price || fields.sqrtPrice;
  const liquidity = fields.liquidity;

  return {
    poolId,
    coinTypeA,
    coinTypeB,
    feeTier: TARGET_FEE_TIER,
    currentSqrtPrice: currentSqrtPrice?.toString(),
    liquidity: liquidity?.toString(),
  };
}

/**
 * Resolve Cetus pool for SUI/USDC 0.05% fee tier
 * Supports manual override via CETUS_SUI_USDC_POOL_ID env variable
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

  try {
    // Check for manual override first
    const manualPoolId = process.env.CETUS_SUI_USDC_POOL_ID;
    
    if (manualPoolId) {
      logger.info(`Using manual Cetus pool override: ${manualPoolId}`);
      
      // Validate pool ID format
      if (!isValidSuiObjectId(manualPoolId)) {
        throw new Error(
          `Invalid Cetus pool ID format: ${manualPoolId}. ` +
          `Expected 0x followed by 64 hexadecimal characters.`
        );
      }
      
      const poolMetadata = await verifyAndExtractPoolMetadata(
        client,
        manualPoolId,
        'Cetus'
      );

      logger.success(`✓ Cetus pool resolved (manual): ${manualPoolId}`);
      logger.info(`  Coin A: ${poolMetadata.coinTypeA.split('::').pop()}`);
      logger.info(`  Coin B: ${poolMetadata.coinTypeB.split('::').pop()}`);
      logger.info(`  Fee: 0.05%`);

      return { globalConfigId, suiUsdcPool: poolMetadata };
    }

    // Use known production pool ID (validated for native USDC)
    // This is the SUI/native USDC 0.05% pool on Cetus mainnet
    const knownPoolId = '0xcf994611fd4c48e277ce3ffd4d4364c914af2c3cbb05f7bf6facd371de688630';
    
    logger.info(`Discovering Cetus pool via known pool ID: ${knownPoolId}`);
    
    const poolMetadata = await verifyAndExtractPoolMetadata(
      client,
      knownPoolId,
      'Cetus'
    );

    logger.success(`✓ Cetus pool discovered: ${knownPoolId}`);
    logger.info(`  Coin A: ${poolMetadata.coinTypeA.split('::').pop()}`);
    logger.info(`  Coin B: ${poolMetadata.coinTypeB.split('::').pop()}`);
    logger.info(`  Fee: 0.05%`);
    logger.info(`  Note: To override, set CETUS_SUI_USDC_POOL_ID in .env`);

    return { globalConfigId, suiUsdcPool: poolMetadata };
  } catch (error) {
    logger.error('Failed to resolve Cetus pool', error);
    logger.error(
      'Hint: Set CETUS_SUI_USDC_POOL_ID in .env to manually specify the pool ID'
    );
    throw new Error(`Cetus pool resolution failed: ${error}`);
  }
}

/**
 * Resolve Turbos pool for SUI/USDC 0.05% fee tier
 * Supports manual override via TURBOS_SUI_USDC_POOL_ID env variable
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

  try {
    // Check for manual override first
    const manualPoolId = process.env.TURBOS_SUI_USDC_POOL_ID;
    
    if (manualPoolId) {
      logger.info(`Using manual Turbos pool override: ${manualPoolId}`);
      
      // Validate pool ID format
      if (!isValidSuiObjectId(manualPoolId)) {
        throw new Error(
          `Invalid Turbos pool ID format: ${manualPoolId}. ` +
          `Expected 0x followed by 64 hexadecimal characters.`
        );
      }
      
      const poolMetadata = await verifyAndExtractPoolMetadata(
        client,
        manualPoolId,
        'Turbos'
      );

      logger.success(`✓ Turbos pool resolved (manual): ${manualPoolId}`);
      logger.info(`  Coin A: ${poolMetadata.coinTypeA.split('::').pop()}`);
      logger.info(`  Coin B: ${poolMetadata.coinTypeB.split('::').pop()}`);
      logger.info(`  Fee: 0.05%`);

      return { factoryId, suiUsdcPool: poolMetadata };
    }

    // Use known production pool ID (validated for native USDC)
    // This is the SUI/native USDC 0.05% pool on Turbos mainnet
    const knownPoolId = '0x5eb2dfcdd1b15d2021328258f6d5ec081e9a0cdcfa9e13a0eaeb9b5f7505ca78';
    
    logger.info(`Discovering Turbos pool via known pool ID: ${knownPoolId}`);
    
    const poolMetadata = await verifyAndExtractPoolMetadata(
      client,
      knownPoolId,
      'Turbos'
    );

    logger.success(`✓ Turbos pool discovered: ${knownPoolId}`);
    logger.info(`  Coin A: ${poolMetadata.coinTypeA.split('::').pop()}`);
    logger.info(`  Coin B: ${poolMetadata.coinTypeB.split('::').pop()}`);
    logger.info(`  Fee: 0.05%`);
    logger.info(`  Note: To override, set TURBOS_SUI_USDC_POOL_ID in .env`);

    return { factoryId, suiUsdcPool: poolMetadata };
  } catch (error) {
    logger.error('Failed to resolve Turbos pool', error);
    logger.error(
      'Hint: Set TURBOS_SUI_USDC_POOL_ID in .env to manually specify the pool ID'
    );
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
export async function resolvePoolAddresses(client: SuiClient): Promise<ResolvedAddresses> {
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

    // Validate Turbos pool coin types
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

    // Log summary
    logger.success('=== Address Resolution Complete ===');
    logger.info('Resolved addresses:');
    logger.info(`  Cetus Global Config: ${resolved.cetus.globalConfigId}`);
    logger.info(`  Cetus SUI/USDC Pool: ${resolved.cetus.suiUsdcPool.poolId}`);
    logger.info(`  Turbos Factory: ${resolved.turbos.factoryId}`);
    logger.info(`  Turbos SUI/USDC Pool: ${resolved.turbos.suiUsdcPool.poolId}`);
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
