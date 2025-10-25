import { getSuiClient } from './utils/sui';
import { logger } from './logger';
import { TURBOS } from './addresses';
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
 * Get current SUI/USDC price from Turbos
 * Uses on-chain pool data to calculate current price
 */
export async function getTurbosPrice(): Promise<number> {
  // Check cache
  if (priceCache && isCacheValid(priceCache.timestamp)) {
    return priceCache.price;
  }

  try {
    const client = getSuiClient();

    // Fetch pool object
    const poolObject = await client.getObject({
      id: TURBOS.suiUsdcPoolId,
      options: {
        showContent: true,
      },
    });

    if (!poolObject.data) {
      throw new Error('Turbos pool not found');
    }

    // Extract pool data - this is a simplified version
    // In production, you'd use the Turbos SDK to properly parse pool state
    const content = poolObject.data.content as any;

    if (!content || !content.fields) {
      throw new Error('Invalid pool data structure');
    }

    // For now, return a mock price with slight variance from Cetus
    // In production, parse actual pool state
    logger.warn('Using mock price for Turbos - implement proper pool state parsing');

    const mockPrice = 3.52; // SUI price in USDC (mock, slightly different from Cetus)
    priceCache = { price: mockPrice, timestamp: Date.now() };

    return mockPrice;
  } catch (error) {
    logger.error('Failed to get Turbos price', error);
    throw error;
  }
}

/**
 * Quote swap from SUI to USDC (A to B) on Turbos
 * @param amountIn Amount of SUI to swap (in smallest units)
 * @returns Expected USDC output (in smallest units)
 */
export async function quoteTurbosSwapA2B(amountIn: bigint): Promise<bigint> {
  const cacheKey = `a2b:${amountIn}`;

  // Check quote cache
  const cached = quoteCache.get(cacheKey);
  if (cached && isCacheValid(cached.timestamp)) {
    return cached.amount;
  }

  try {
    // In production, use Turbos SDK to get actual quote
    // For now, use price-based approximation
    const price = await getTurbosPrice();

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

    logger.debug(`Turbos quote A2B: ${amountIn} SUI -> ${outputAmount} USDC (price: ${price})`);

    return outputAmount;
  } catch (error) {
    logger.error('Failed to quote Turbos swap A2B', error);
    throw error;
  }
}

/**
 * Quote swap from USDC to SUI (B to A) on Turbos
 * @param amountIn Amount of USDC to swap (in smallest units)
 * @returns Expected SUI output (in smallest units)
 */
export async function quoteTurbosSwapB2A(amountIn: bigint): Promise<bigint> {
  const cacheKey = `b2a:${amountIn}`;

  // Check quote cache
  const cached = quoteCache.get(cacheKey);
  if (cached && isCacheValid(cached.timestamp)) {
    return cached.amount;
  }

  try {
    // In production, use Turbos SDK to get actual quote
    const price = await getTurbosPrice();

    // Convert USDC to SUI
    const usdcAmount = Number(amountIn) / 1e6;
    const suiAmount = usdcAmount / price;
    const suiSmallestUnit = BigInt(Math.floor(suiAmount * 1e9));

    // Apply fee (0.05% = 50 bps)
    const feeAmount = (suiSmallestUnit * BigInt(50)) / BigInt(10000);
    const outputAmount = suiSmallestUnit - feeAmount;

    // Cache result
    quoteCache.set(cacheKey, { amount: outputAmount, timestamp: Date.now() });

    logger.debug(`Turbos quote B2A: ${amountIn} USDC -> ${outputAmount} SUI (price: ${price})`);

    return outputAmount;
  } catch (error) {
    logger.error('Failed to quote Turbos swap B2A', error);
    throw error;
  }
}

/**
 * Clear the price and quote caches
 */
export function clearTurbosCache(): void {
  priceCache = null;
  quoteCache.clear();
  logger.debug('Turbos cache cleared');
}

/**
 * Get Turbos pool info for debugging
 */
export async function getTurbosPoolInfo(): Promise<any> {
  try {
    const client = getSuiClient();
    const poolObject = await client.getObject({
      id: TURBOS.suiUsdcPoolId,
      options: {
        showContent: true,
        showType: true,
      },
    });

    return poolObject;
  } catch (error) {
    logger.error('Failed to get Turbos pool info', error);
    throw error;
  }
}
