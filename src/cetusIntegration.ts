/**
 * Cetus DEX Integration with Real SDK
 * Provides price quotes and swap operations using pool state
 */

import { getSuiClient } from './utils/sui';
import { logger } from './logger';
import { CETUS, COIN_TYPES } from './addresses';
import { config } from './config';
import { getResolvedAddresses, calculatePriceFromSqrtPrice, validatePrice } from './resolve';
import { Transaction } from '@mysten/sui/transactions';
import Decimal from 'decimal.js';

// Price and quote cache
interface PriceCache {
  price: number;
  timestamp: number;
}

interface QuoteResult {
  amountOut: bigint;
  sqrtPriceLimit: string;
  priceImpact: number;
}

let priceCache: PriceCache | null = null;
const quoteCache: Map<string, { quote: QuoteResult; timestamp: number }> = new Map();

/**
 * Check if cache is still valid
 */
function isCacheValid(timestamp: number): boolean {
  return Date.now() - timestamp < config.priceCacheTtlMs;
}

/**
 * Get current SUI/USDC price from Cetus using SDK
 * Fetches pool state and calculates price from sqrtPrice
 */
export async function getCetusPrice(): Promise<number> {
  // Check cache
  if (priceCache && isCacheValid(priceCache.timestamp)) {
    return priceCache.price;
  }

  try {
    const resolved = getResolvedAddresses();
    const client = getSuiClient();

    // Fetch pool object
    const poolObject = await client.getObject({
      id: resolved.cetus.suiUsdcPool.poolId,
      options: {
        showContent: true,
      },
    });

    if (!poolObject.data || !poolObject.data.content) {
      throw new Error('Cetus pool data not found');
    }

    const content = poolObject.data.content as any;
    if (content.dataType !== 'moveObject') {
      throw new Error('Invalid pool object type');
    }

    const fields = content.fields;

    // Extract sqrt_price from pool state
    const sqrtPriceStr = fields.current_sqrt_price || fields.sqrt_price;
    if (!sqrtPriceStr) {
      throw new Error('sqrtPrice not found in pool state');
    }

    // Determine coin ordering from resolved metadata
    const poolMeta = resolved.cetus.suiUsdcPool;
    const suiIsCoinA = poolMeta.coinTypeA === COIN_TYPES.SUI;

    // Calculate price based on coin ordering
    // If SUI is coin A: price = USDC/SUI (we want this)
    // If USDC is coin A: price = SUI/USDC (need to invert)
    let price: number;

    if (suiIsCoinA) {
      // Pool is SUI/USDC, price is in USDC per SUI (what we want)
      price = calculatePriceFromSqrtPrice(sqrtPriceStr, 9, 6); // SUI decimals=9, USDC=6
    } else {
      // Pool is USDC/SUI, price is in SUI per USDC (need to invert)
      const inversePrice = calculatePriceFromSqrtPrice(sqrtPriceStr, 6, 9);
      price = 1 / inversePrice;
    }

    // Sanity check the price
    if (!validatePrice(price, 'Cetus')) {
      throw new Error(
        `Cetus price ${price.toFixed(6)} USDC/SUI failed sanity check. ` +
          `Check pool configuration and coin ordering.`
      );
    }

    logger.debug(
      `Cetus price: ${price.toFixed(6)} USDC/SUI (sqrtPrice: ${sqrtPriceStr}, ` +
        `SUI is ${suiIsCoinA ? 'A' : 'B'})`
    );

    // Cache the price
    priceCache = { price, timestamp: Date.now() };

    return price;
  } catch (error) {
    logger.error('Failed to get Cetus price', error);
    throw error;
  }
}

/**
 * Get executable quote for USDC -> SUI swap on Cetus
 * @param amountIn Amount of USDC to swap (in smallest units, 6 decimals)
 * @returns Quote with expected output and sqrt_price_limit
 */
export async function quoteCetusSwapB2A(amountIn: bigint): Promise<QuoteResult> {
  const cacheKey = `b2a:${amountIn}`;

  // Check cache
  const cached = quoteCache.get(cacheKey);
  if (cached && isCacheValid(cached.timestamp)) {
    return cached.quote;
  }

  try {
    const resolved = getResolvedAddresses();
    const client = getSuiClient();

    // Get current price to estimate output
    const price = await getCetusPrice();

    // Safety check: reject if price is implausible
    if (!validatePrice(price, 'Cetus')) {
      throw new Error(`Cetus price ${price} failed sanity check`);
    }

    // Calculate expected output: amountIn (USDC) / price = amountOut (SUI)
    // Convert to proper decimals: USDC (6) -> SUI (9)
    const usdcAmount = new Decimal(amountIn.toString()).div(1e6);
    const suiAmount = usdcAmount.div(price);
    const suiSmallestUnit = suiAmount.mul(1e9);

    // Apply fee (0.05% = 50 bps = 0.9995 multiplier)
    const feeMultiplier = new Decimal(1).minus(config.cetusSwapFeePercent / 100);
    const amountOutAfterFee = suiSmallestUnit.mul(feeMultiplier);

    // Safety check: ensure output is not zero or negative
    if (amountOutAfterFee.lte(0)) {
      throw new Error(`Invalid quote output: ${amountOutAfterFee.toString()}`);
    }

    // Calculate sqrt_price_limit (1% slippage from current)
    const poolObject = await client.getObject({
      id: resolved.cetus.suiUsdcPool.poolId,
      options: { showContent: true },
    });

    const content = poolObject.data?.content as any;
    const currentSqrtPrice = new Decimal(
      content.fields.current_sqrt_price || content.fields.sqrt_price
    );

    // Determine direction based on coin ordering
    const poolMeta = resolved.cetus.suiUsdcPool;
    const suiIsCoinA = poolMeta.coinTypeA === COIN_TYPES.SUI;

    // For USDC->SUI swap:
    // If SUI is A: we're swapping B->A (buying A with B), price moves up
    // If USDC is A: we're swapping A->B (buying B with A), price moves down
    const slippageMultiplier = suiIsCoinA
      ? new Decimal(1).plus(config.maxSlippagePercent / 100)
      : new Decimal(1).minus(config.maxSlippagePercent / 100);

    const sqrtPriceLimit = currentSqrtPrice.mul(slippageMultiplier.sqrt()).toFixed(0);

    const quote: QuoteResult = {
      amountOut: BigInt(amountOutAfterFee.toFixed(0)),
      sqrtPriceLimit,
      priceImpact: 0.1, // Estimate - would need deeper calculation
    };

    // Cache the quote
    quoteCache.set(cacheKey, { quote, timestamp: Date.now() });

    logger.debug(
      `Cetus quote B2A: ${amountIn} USDC -> ${quote.amountOut} SUI (limit: ${sqrtPriceLimit})`
    );

    return quote;
  } catch (error) {
    logger.error('Failed to quote Cetus swap B2A', error);
    throw error;
  }
}

/**
 * Get executable quote for SUI -> USDC swap on Cetus
 * @param amountIn Amount of SUI to swap (in smallest units, 9 decimals)
 * @returns Quote with expected output and sqrt_price_limit
 */
export async function quoteCetusSwapA2B(amountIn: bigint): Promise<QuoteResult> {
  const cacheKey = `a2b:${amountIn}`;

  // Check cache
  const cached = quoteCache.get(cacheKey);
  if (cached && isCacheValid(cached.timestamp)) {
    return cached.quote;
  }

  try {
    const resolved = getResolvedAddresses();
    const client = getSuiClient();

    // Get current price to estimate output
    const price = await getCetusPrice();

    // Safety check: reject if price is implausible
    if (!validatePrice(price, 'Cetus')) {
      throw new Error(`Cetus price ${price} failed sanity check`);
    }

    // Calculate expected output: amountIn (SUI) * price = amountOut (USDC)
    // Convert to proper decimals: SUI (9) -> USDC (6)
    const suiAmount = new Decimal(amountIn.toString()).div(1e9);
    const usdcAmount = suiAmount.mul(price);
    const usdcSmallestUnit = usdcAmount.mul(1e6);

    // Apply fee (0.05% = 50 bps)
    const feeMultiplier = new Decimal(1).minus(config.cetusSwapFeePercent / 100);
    const amountOutAfterFee = usdcSmallestUnit.mul(feeMultiplier);

    // Safety check: ensure output is not zero or negative
    if (amountOutAfterFee.lte(0)) {
      throw new Error(`Invalid quote output: ${amountOutAfterFee.toString()}`);
    }

    // Calculate sqrt_price_limit (1% slippage from current)
    const poolObject = await client.getObject({
      id: resolved.cetus.suiUsdcPool.poolId,
      options: { showContent: true },
    });

    const content = poolObject.data?.content as any;
    const currentSqrtPrice = new Decimal(
      content.fields.current_sqrt_price || content.fields.sqrt_price
    );

    // Determine direction based on coin ordering
    const poolMeta = resolved.cetus.suiUsdcPool;
    const suiIsCoinA = poolMeta.coinTypeA === COIN_TYPES.SUI;

    // For SUI->USDC swap:
    // If SUI is A: we're swapping A->B (selling A for B), price moves down
    // If USDC is A: we're swapping B->A (selling B for A), price moves up
    const slippageMultiplier = suiIsCoinA
      ? new Decimal(1).minus(config.maxSlippagePercent / 100)
      : new Decimal(1).plus(config.maxSlippagePercent / 100);

    const sqrtPriceLimit = currentSqrtPrice.mul(slippageMultiplier.sqrt()).toFixed(0);

    const quote: QuoteResult = {
      amountOut: BigInt(amountOutAfterFee.toFixed(0)),
      sqrtPriceLimit,
      priceImpact: 0.1, // Estimate
    };

    // Cache the quote
    quoteCache.set(cacheKey, { quote, timestamp: Date.now() });

    logger.debug(
      `Cetus quote A2B: ${amountIn} SUI -> ${quote.amountOut} USDC (limit: ${sqrtPriceLimit})`
    );

    return quote;
  } catch (error) {
    logger.error('Failed to quote Cetus swap A2B', error);
    throw error;
  }
}

/**
 * Build swap transaction for Cetus
 * @param tx Transaction builder
 * @param inputCoin Input coin object
 * @param amountIn Amount to swap
 * @param minAmountOut Minimum output amount (slippage protection)
 * @param sqrtPriceLimit Price limit for swap
 * @param a2b Direction: true for A->B (SUI->USDC), false for B->A (USDC->SUI)
 * @returns Output coin object
 */
export function buildCetusSwap(
  tx: Transaction,
  inputCoin: any,
  amountIn: bigint,
  minAmountOut: bigint,
  sqrtPriceLimit: string,
  a2b: boolean
): any {
  const resolved = getResolvedAddresses();
  const poolMeta = resolved.cetus.suiUsdcPool;

  logger.debug(
    `Building Cetus swap: amount=${amountIn}, minOut=${minAmountOut}, a2b=${a2b}, limit=${sqrtPriceLimit}`
  );

  // Cetus swap entrypoint per Perplexity spec:
  // pool::swap(config, &mut Pool, Coin<A>, Coin<B>, a2b, by_amount_in, amount u64, amount_limit u64, sqrt_price_limit u128, &Clock)
  // For exact-in swaps, we pass the input coin as Coin<A> or Coin<B> and an empty coin for the other
  // Type args [A,B] in pool coin order
  
  const coinTypeA = poolMeta.coinTypeA;
  const coinTypeB = poolMeta.coinTypeB;
  
  // Create coins for both sides - input coin and empty coin for opposite side
  const [coinA, coinB] = a2b 
    ? [inputCoin, tx.splitCoins(tx.gas, [tx.pure.u64('0')])] 
    : [tx.splitCoins(tx.gas, [tx.pure.u64('0')]), inputCoin];

  const [outputCoinA, outputCoinB] = tx.moveCall({
    target: `${CETUS.packageId}::pool::swap`,
    arguments: [
      tx.object(resolved.cetus.globalConfigId),
      tx.object(resolved.cetus.suiUsdcPool.poolId),
      coinA,
      coinB,
      tx.pure.bool(a2b),
      tx.pure.bool(true), // by_amount_in
      tx.pure.u64(amountIn.toString()),
      tx.pure.u64(minAmountOut.toString()), // amount_limit (min out)
      tx.pure.u128(sqrtPriceLimit),
      tx.object('0x6'), // Clock object
    ],
    typeArguments: [coinTypeA, coinTypeB],
  });

  // Return the output coin (either coinA or coinB depending on direction)
  return a2b ? outputCoinB : outputCoinA;
}

/**
 * Clear caches
 */
export function clearCetusCache(): void {
  priceCache = null;
  quoteCache.clear();
  logger.debug('Cetus cache cleared');
}

/**
 * Get Cetus pool info for debugging
 */
export async function getCetusPoolInfo(): Promise<any> {
  try {
    const resolved = getResolvedAddresses();
    const client = getSuiClient();

    const poolObject = await client.getObject({
      id: resolved.cetus.suiUsdcPool.poolId,
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
