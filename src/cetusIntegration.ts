/**
 * Cetus DEX Integration with Real SDK
 * Provides price quotes and swap operations using pool state
 */

import { getSuiClient } from './utils/sui';
import { logger } from './logger';
import { CETUS, COIN_TYPES } from './addresses';
import { config } from './config';
import { validatePrice, getCetusPools } from './resolve';
import { chooseUsdcPerSui } from './lib/cetusPrice';
import { Transaction } from '@mysten/sui/transactions';
import Decimal from 'decimal.js';

// Pool metadata type for specific pool operations
export interface CetusPoolMetadata {
  poolId: string;
  coinTypeA: string;
  coinTypeB: string;
}

// Pool state cache structure
interface PoolStateCache {
  currentSqrtPrice: string;
  liquidity: string;
  feeRate: number;
  coinTypeA: string;
  coinTypeB: string;
  timestamp: number;
}

interface QuoteResult {
  amountOut: bigint;
  sqrtPriceLimit: string;
  priceImpact: number;
}

// Cache variables
const poolStateCache: Map<string, PoolStateCache> = new Map();
const quoteCache: Map<string, { quote: QuoteResult; timestamp: number }> = new Map();

/**
 * Check if pool state cache is still valid
 */
function isPoolStateCacheValid(timestamp: number): boolean {
  return Date.now() - timestamp < config.poolStateCacheTtlMs;
}

/**
 * Get cached pool state or fetch from RPC
 */
async function getPoolState(poolId: string): Promise<PoolStateCache> {
  // Check cache first
  const cached = poolStateCache.get(poolId);
  if (cached && isPoolStateCacheValid(cached.timestamp)) {
    logger.debug(`Using cached pool state for ${poolId.slice(0, 8)}...`);
    return cached;
  }

  // Fetch from RPC
  logger.debug(`Fetching pool state from RPC for ${poolId.slice(0, 8)}...`);
  const client = getSuiClient();
  const poolObject = await client.getObject({
    id: poolId,
    options: { showContent: true, showType: true },
  });

  if (!poolObject.data || !poolObject.data.content) {
    throw new Error(`Pool not found: ${poolId}`);
  }

  const content = poolObject.data.content as any;
  if (content.dataType !== 'moveObject') {
    throw new Error(`Invalid pool object type for ${poolId}`);
  }

  const fields = content.fields;
  
  // Extract type arguments from pool type
  const poolType = poolObject.data.type;
  if (!poolType) {
    throw new Error(`Pool type not found for ${poolId}`);
  }

  const typeMatch = poolType.match(/Pool<([^,]+),\s*([^>]+)>/);
  if (!typeMatch) {
    throw new Error(`Cannot parse pool type: ${poolType}`);
  }

  const [, coinTypeA, coinTypeB] = typeMatch;

  // Create cache entry
  const state: PoolStateCache = {
    currentSqrtPrice: fields.current_sqrt_price?.toString() || fields.sqrt_price?.toString() || '0',
    liquidity: fields.liquidity?.toString() || '0',
    feeRate: Number(fields.fee_rate || fields.fee || 0),
    coinTypeA,
    coinTypeB,
    timestamp: Date.now(),
  };

  // Cache it
  poolStateCache.set(poolId, state);
  
  return state;
}

/**
 * Get current SUI/USDC price from Cetus using SDK (DEPRECATED)
 * Use getCetusPriceByPool() instead with specific pool metadata
 * @deprecated Use getCetusPriceByPool() with specific pool metadata
 */
export async function getCetusPrice(): Promise<number> {
  logger.warn('getCetusPrice() is deprecated. Use getCetusPriceByPool() with pool metadata.');
  
  // Default to 0.05% pool for backward compatibility
  const pools = getCetusPools();
  return getCetusPriceByPool(pools.pool005);
}

/**
 * Get executable quote for USDC -> SUI swap on Cetus (DEPRECATED)
 * Use quoteCetusPoolSwapB2A() with specific pool metadata instead
 * @deprecated Use quoteCetusPoolSwapB2A() with specific pool metadata
 */
export async function quoteCetusSwapB2A(amountIn: bigint): Promise<QuoteResult> {
  logger.warn('quoteCetusSwapB2A() is deprecated. Use quoteCetusPoolSwapB2A() with pool metadata.');
  
  // Default to 0.05% pool for backward compatibility
  const pools = getCetusPools();
  return quoteCetusPoolSwapB2A(pools.pool005, amountIn, 0.05);
}

/**
 * Get executable quote for SUI -> USDC swap on Cetus (DEPRECATED)
 * Use quoteCetusPoolSwapA2B() with specific pool metadata instead
 * @deprecated Use quoteCetusPoolSwapA2B() with specific pool metadata
 */
export async function quoteCetusSwapA2B(amountIn: bigint): Promise<QuoteResult> {
  logger.warn('quoteCetusSwapA2B() is deprecated. Use quoteCetusPoolSwapA2B() with pool metadata.');
  
  // Default to 0.05% pool for backward compatibility
  const pools = getCetusPools();
  return quoteCetusPoolSwapA2B(pools.pool005, amountIn, 0.05);
}

/**
 * Build swap transaction for Cetus (DEPRECATED)
 * Use buildCetusPoolSwap() with specific pool metadata instead
 * @deprecated Use buildCetusPoolSwap() with specific pool metadata
 */
export function buildCetusSwap(
  tx: Transaction,
  inputCoin: any,
  amountIn: bigint,
  minAmountOut: bigint,
  sqrtPriceLimit: string,
  a2b: boolean
): any {
  logger.warn('buildCetusSwap() is deprecated. Use buildCetusPoolSwap() with pool metadata.');
  
  // Default to 0.05% pool for backward compatibility
  const pools = getCetusPools();
  return buildCetusPoolSwap(
    tx,
    pools.pool005,
    pools.globalConfigId,
    inputCoin,
    amountIn,
    minAmountOut,
    sqrtPriceLimit,
    a2b
  );
}

/**
 * Clear caches
 */
export function clearCetusCache(): void {
  poolStateCache.clear();
  quoteCache.clear();
  logger.debug('Cetus cache cleared');
}

/**
 * Get Cetus pool info for debugging (DEPRECATED)
 * @deprecated Use pool-specific metadata from getCetusPools() instead
 */
export async function getCetusPoolInfo(): Promise<any> {
  logger.warn('getCetusPoolInfo() is deprecated.');
  
  try {
    const pools = getCetusPools();
    const client = getSuiClient();

    const poolObject = await client.getObject({
      id: pools.pool005.poolId,
      options: {
        showContent: true,
        showType: true,
      },
    });

    return poolObject;
  } catch (error) {
    logger.error('Failed to get Cetus pool info', error);
    throw error;
  }
}

/**
 * Get price from a specific Cetus pool by pool metadata
 * @param poolMeta Pool metadata with poolId and coin types
 * @returns Price in USDC per SUI
 */
export async function getCetusPriceByPool(poolMeta: {
  poolId: string;
  coinTypeA: string;
  coinTypeB: string;
}): Promise<number> {
  try {
    // Use cached pool state
    const poolState = await getPoolState(poolMeta.poolId);

    // Extract sqrt_price from pool state
    const sqrtPriceStr = poolState.currentSqrtPrice;
    if (!sqrtPriceStr || sqrtPriceStr === '0') {
      throw new Error('sqrtPrice not found in pool state');
    }

    // Use the robust helper
    logger.debug(`Getting price for pool ${poolMeta.poolId.slice(0, 8)}...`);
    logger.debug(`  Coin A: ${poolMeta.coinTypeA.split('::').pop()}`);
    logger.debug(`  Coin B: ${poolMeta.coinTypeB.split('::').pop()}`);
    logger.debug(`  sqrt_price_x64: ${sqrtPriceStr}`);

    const price = chooseUsdcPerSui({
      poolId: poolMeta.poolId,
      sqrtPriceX64: sqrtPriceStr,
      coinTypeA: poolMeta.coinTypeA,
      coinTypeB: poolMeta.coinTypeB,
    });

    // Sanity check the price
    if (!validatePrice(price, `Cetus pool ${poolMeta.poolId.slice(0, 10)}...`)) {
      throw new Error(
        `Price ${price.toFixed(6)} USDC/SUI failed sanity check for pool ${poolMeta.poolId}`
      );
    }

    logger.debug(`Final price: ${price.toFixed(6)} USDC/SUI`);

    return price;
  } catch (error) {
    logger.error(`Failed to get price from Cetus pool ${poolMeta.poolId}`, error);
    throw error;
  }
}

/**
 * Get executable quote for a specific Cetus pool (USDC -> SUI)
 * @param poolMeta Pool metadata
 * @param amountIn Amount of USDC to swap (in smallest units)
 * @param feePercent Fee percentage for this pool
 * @returns Quote with expected output and sqrt_price_limit
 */
export async function quoteCetusPoolSwapB2A(
  poolMeta: CetusPoolMetadata,
  amountIn: bigint,
  feePercent: number
): Promise<QuoteResult> {
  try {

    // Get current price from this specific pool
    const price = await getCetusPriceByPool(poolMeta);

    // Safety check: reject if price is implausible
    if (!validatePrice(price, `Cetus pool ${poolMeta.poolId.slice(0, 10)}...`)) {
      throw new Error(
        `Cetus price ${price} failed sanity check for pool ${poolMeta.poolId}`
      );
    }

    // Calculate expected output: amountIn (USDC) / price = amountOut (SUI)
    const usdcAmount = new Decimal(amountIn.toString()).div(1e6);
    const suiAmount = usdcAmount.div(price);
    const suiSmallestUnit = suiAmount.mul(1e9);

    // Apply fee
    const feeMultiplier = new Decimal(1).minus(feePercent / 100);
    const amountOutAfterFee = suiSmallestUnit.mul(feeMultiplier);

    // Safety check: ensure output is not zero or negative
    if (amountOutAfterFee.lte(0)) {
      throw new Error(`Invalid quote output: ${amountOutAfterFee.toString()}`);
    }

    // Use cached pool state for sqrt_price_limit
    const poolState = await getPoolState(poolMeta.poolId);
    const currentSqrtPrice = new Decimal(poolState.currentSqrtPrice);

    // Determine direction based on coin ordering
    const suiIsCoinA = poolMeta.coinTypeA === COIN_TYPES.SUI;

    // For USDC->SUI swap: price moves up if SUI is A, down if USDC is A
    const slippageMultiplier = suiIsCoinA
      ? new Decimal(1).plus(config.maxSlippagePercent / 100)
      : new Decimal(1).minus(config.maxSlippagePercent / 100);

    const sqrtPriceLimit = currentSqrtPrice.mul(slippageMultiplier.sqrt()).toFixed(0);

    const quote: QuoteResult = {
      amountOut: BigInt(amountOutAfterFee.toFixed(0)),
      sqrtPriceLimit,
      priceImpact: 0.1,
    };

    return quote;
  } catch (error) {
    logger.error('Failed to quote Cetus pool swap B2A', error);
    throw error;
  }
}

/**
 * Get executable quote for a specific Cetus pool (SUI -> USDC)
 * @param poolMeta Pool metadata
 * @param amountIn Amount of SUI to swap (in smallest units)
 * @param feePercent Fee percentage for this pool
 * @returns Quote with expected output and sqrt_price_limit
 */
export async function quoteCetusPoolSwapA2B(
  poolMeta: CetusPoolMetadata,
  amountIn: bigint,
  feePercent: number
): Promise<QuoteResult> {
  try {

    // Get current price from this specific pool
    const price = await getCetusPriceByPool(poolMeta);

    // Safety check: reject if price is implausible
    if (!validatePrice(price, `Cetus pool ${poolMeta.poolId.slice(0, 10)}...`)) {
      throw new Error(
        `Cetus price ${price} failed sanity check for pool ${poolMeta.poolId}`
      );
    }

    // Calculate expected output: amountIn (SUI) * price = amountOut (USDC)
    const suiAmount = new Decimal(amountIn.toString()).div(1e9);
    const usdcAmount = suiAmount.mul(price);
    const usdcSmallestUnit = usdcAmount.mul(1e6);

    // Apply fee
    const feeMultiplier = new Decimal(1).minus(feePercent / 100);
    const amountOutAfterFee = usdcSmallestUnit.mul(feeMultiplier);

    // Safety check: ensure output is not zero or negative
    if (amountOutAfterFee.lte(0)) {
      throw new Error(`Invalid quote output: ${amountOutAfterFee.toString()}`);
    }

    // Use cached pool state for sqrt_price_limit
    const poolState = await getPoolState(poolMeta.poolId);
    const currentSqrtPrice = new Decimal(poolState.currentSqrtPrice);

    // Determine direction based on coin ordering
    const suiIsCoinA = poolMeta.coinTypeA === COIN_TYPES.SUI;

    // For SUI->USDC swap: price moves down if SUI is A, up if USDC is A
    const slippageMultiplier = suiIsCoinA
      ? new Decimal(1).minus(config.maxSlippagePercent / 100)
      : new Decimal(1).plus(config.maxSlippagePercent / 100);

    const sqrtPriceLimit = currentSqrtPrice.mul(slippageMultiplier.sqrt()).toFixed(0);

    const quote: QuoteResult = {
      amountOut: BigInt(amountOutAfterFee.toFixed(0)),
      sqrtPriceLimit,
      priceImpact: 0.1,
    };

    return quote;
  } catch (error) {
    logger.error('Failed to quote Cetus pool swap A2B', error);
    throw error;
  }
}

/**
 * Build swap transaction for a specific Cetus pool
 * @param tx Transaction builder
 * @param poolMeta Pool metadata (poolId, coinTypeA, coinTypeB)
 * @param globalConfigId Cetus global config ID
 * @param inputCoin Input coin object
 * @param amountIn Amount to swap
 * @param minAmountOut Minimum output amount (slippage protection)
 * @param sqrtPriceLimit Price limit for swap
 * @param a2b Direction: true for A->B, false for B->A
 * @returns Output coin object
 */
export function buildCetusPoolSwap(
  tx: Transaction,
  poolMeta: CetusPoolMetadata,
  globalConfigId: string,
  inputCoin: any,
  amountIn: bigint,
  minAmountOut: bigint,
  sqrtPriceLimit: string,
  a2b: boolean
): any {
  logger.debug(
    `Building Cetus pool swap: pool=${poolMeta.poolId.slice(0, 10)}..., amount=${amountIn}, minOut=${minAmountOut}, a2b=${a2b}`
  );

  const coinTypeA = poolMeta.coinTypeA;
  const coinTypeB = poolMeta.coinTypeB;

  // Create coins for both sides
  const [coinA, coinB] = a2b
    ? [inputCoin, tx.splitCoins(tx.gas, [tx.pure.u64('0')])]
    : [tx.splitCoins(tx.gas, [tx.pure.u64('0')]), inputCoin];

  const [outputCoinA, outputCoinB] = tx.moveCall({
    target: `${CETUS.packageId}::pool::swap`,
    arguments: [
      tx.object(globalConfigId),
      tx.object(poolMeta.poolId),
      coinA,
      coinB,
      tx.pure.bool(a2b),
      tx.pure.bool(true), // by_amount_in
      tx.pure.u64(amountIn.toString()),
      tx.pure.u64(minAmountOut.toString()),
      tx.pure.u128(sqrtPriceLimit),
      tx.object('0x6'), // Clock object
    ],
    typeArguments: [coinTypeA, coinTypeB],
  });

  return a2b ? outputCoinB : outputCoinA;
}
