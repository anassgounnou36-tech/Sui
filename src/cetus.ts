import { getSuiClient } from './utils/sui';
import { logger } from './logger';
import { CETUS } from './addresses';
import { config } from './config';

// Simple price cache
interface PriceCache {
  price: number;
  timestamp: number;
}

let priceCache: PriceCache | null = null;
const quoteCache: Map<string, { amount: bigint; timestamp: number }> = new Map();

/**
 * Check if cache is still valid
 */
function isCacheValid(timestamp: number): boolean {
  return Date.now() - timestamp < config.priceCacheTtlMs;
}

/**
 * Get current SUI/USDC price from Cetus
 * Uses on-chain pool data to calculate current price
 */
export async function getCetusPrice(): Promise<number> {
  // Check cache
  if (priceCache && isCacheValid(priceCache.timestamp)) {
    return priceCache.price;
  }

  try {
    const client = getSuiClient();

    // Fetch pool object
    const poolObject = await client.getObject({
      id: CETUS.suiUsdcPoolId,
      options: {
        showContent: true,
      },
    });

    if (!poolObject.data) {
      throw new Error('Cetus pool not found');
    }

    // Extract pool data - this is a simplified version
    // In production, you'd use the Cetus SDK to properly parse pool state
    const content = poolObject.data.content as any;

    if (!content || !content.fields) {
      throw new Error('Invalid pool data structure');
    }

    // For now, return a mock price - in production, parse actual pool state
    // This would involve reading sqrtPrice from the pool and converting it
    logger.warn('Using mock price for Cetus - implement proper pool state parsing');

    const mockPrice = 3.5; // SUI price in USDC (mock)
    priceCache = { price: mockPrice, timestamp: Date.now() };

    return mockPrice;
  } catch (error) {
    logger.error('Failed to get Cetus price', error);
    throw error;
  }
}

/**
 * Quote swap from SUI to USDC (A to B) on Cetus
 * @param amountIn Amount of SUI to swap (in smallest units)
 * @returns Expected USDC output (in smallest units)
 */
export async function quoteCetusSwapA2B(amountIn: bigint): Promise<bigint> {
  const cacheKey = `a2b:${amountIn}`;

  // Check quote cache
  const cached = quoteCache.get(cacheKey);
  if (cached && isCacheValid(cached.timestamp)) {
    return cached.amount;
  }

  try {
    // In production, use Cetus SDK to get actual quote
    // For now, use price-based approximation
    const price = await getCetusPrice();

    // Convert SUI to USDC
    // SUI has 9 decimals, USDC has 6 decimals
    const suiAmount = Number(amountIn) / 1e9;
    const usdcAmount = suiAmount * price;
    const usdcSmallestUnit = BigInt(Math.floor(usdcAmount * 1e6));

    // Apply fee (0.05% = 50 bps)
    const feeAmount = (usdcSmallestUnit * BigInt(50)) / BigInt(10000);
    const outputAmount = usdcSmallestUnit - feeAmount;

    // Cache result
    quoteCache.set(cacheKey, { amount: outputAmount, timestamp: Date.now() });

    logger.debug(`Cetus quote A2B: ${amountIn} SUI -> ${outputAmount} USDC (price: ${price})`);

    return outputAmount;
  } catch (error) {
    logger.error('Failed to quote Cetus swap A2B', error);
    throw error;
  }
}

/**
 * Quote swap from USDC to SUI (B to A) on Cetus
 * @param amountIn Amount of USDC to swap (in smallest units)
 * @returns Expected SUI output (in smallest units)
 */
export async function quoteCetusSwapB2A(amountIn: bigint): Promise<bigint> {
  const cacheKey = `b2a:${amountIn}`;

  // Check quote cache
  const cached = quoteCache.get(cacheKey);
  if (cached && isCacheValid(cached.timestamp)) {
    return cached.amount;
  }

  try {
    // In production, use Cetus SDK to get actual quote
    const price = await getCetusPrice();

    // Convert USDC to SUI
    const usdcAmount = Number(amountIn) / 1e6;
    const suiAmount = usdcAmount / price;
    const suiSmallestUnit = BigInt(Math.floor(suiAmount * 1e9));

    // Apply fee (0.05% = 50 bps)
    const feeAmount = (suiSmallestUnit * BigInt(50)) / BigInt(10000);
    const outputAmount = suiSmallestUnit - feeAmount;

    // Cache result
    quoteCache.set(cacheKey, { amount: outputAmount, timestamp: Date.now() });

    logger.debug(`Cetus quote B2A: ${amountIn} USDC -> ${outputAmount} SUI (price: ${price})`);

    return outputAmount;
  } catch (error) {
    logger.error('Failed to quote Cetus swap B2A', error);
    throw error;
  }
}

/**
 * Clear the price and quote caches
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
    const client = getSuiClient();
    const poolObject = await client.getObject({
      id: CETUS.suiUsdcPoolId,
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
