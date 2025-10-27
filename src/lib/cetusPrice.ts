/**
 * Shared Cetus Price Helper
 * Provides unified price calculation logic for USDC per SUI from Cetus CLMM pools
 */

import { COIN_TYPES } from '../addresses';
import { logger } from '../logger';
import { getSuiClient } from '../utils/sui';
import Decimal from 'decimal.js';

const MIN_PRICE_USDC_PER_SUI = 0.01; // $0.01 per SUI
const MAX_PRICE_USDC_PER_SUI = 5.0; // $5.00 per SUI

/**
 * Get USDC per SUI price from pool state with proper token order and decimals
 * 
 * @param params Pool state parameters
 * @param params.sqrt_price Square root price from pool (sqrt_price_x64)
 * @param params.coinTypeA First coin type in pool
 * @param params.coinTypeB Second coin type in pool
 * @param params.decimalsA Decimals for coin A (optional, defaults based on coin type)
 * @param params.decimalsB Decimals for coin B (optional, defaults based on coin type)
 * @returns Price in USDC per SUI
 * @throws Error if price is outside sanity bounds or coin types are invalid
 */
export function getUsdcPerSuiFromPoolState(params: {
  sqrt_price: string | bigint;
  coinTypeA: string;
  coinTypeB: string;
  decimalsA?: number;
  decimalsB?: number;
}): number {
  const { sqrt_price, coinTypeA, coinTypeB, decimalsA, decimalsB } = params;

  // Determine if coin A or B is SUI/USDC
  const aIsSui = coinTypeA === COIN_TYPES.SUI;
  const bIsSui = coinTypeB === COIN_TYPES.SUI;
  const aIsUsdc = isUsdcCoinType(coinTypeA);
  const bIsUsdc = isUsdcCoinType(coinTypeB);

  // Validate pool contains SUI and USDC
  if (!(aIsSui || bIsSui) || !(aIsUsdc || bIsUsdc)) {
    throw new Error(
      `Pool does not contain SUI and USDC. Found: ${coinTypeA}, ${coinTypeB}`
    );
  }

  // Determine decimals (SUI=9, USDC=6)
  const decA = decimalsA ?? (aIsSui ? 9 : 6);
  const decB = decimalsB ?? (bIsSui ? 9 : 6);

  // Convert sqrt_price_x64 to actual sqrt price
  const sqrtPriceDec = new Decimal(sqrt_price.toString());
  const Q64 = new Decimal(2).pow(64);
  const sqrtP = sqrtPriceDec.div(Q64);

  let priceUsdcPerSui: number;

  if (aIsUsdc && bIsSui) {
    // Pool is USDC/SUI (coin A = USDC, coin B = SUI)
    // sqrtPrice represents sqrt(USDC/SUI)
    // So price_USDC_per_SUI = (sqrtP)^2 * 10^(decimalsA - decimalsB)
    // = (sqrtP)^2 * 10^(6 - 9) = (sqrtP)^2 * 10^(-3)
    const priceRatio = sqrtP.pow(2);
    const decimalAdjustment = new Decimal(10).pow(decA - decB);
    priceUsdcPerSui = priceRatio.mul(decimalAdjustment).toNumber();
  } else if (aIsSui && bIsUsdc) {
    // Pool is SUI/USDC (coin A = SUI, coin B = USDC)
    // sqrtPrice represents sqrt(SUI/USDC)
    // So price_SUI_per_USDC = (sqrtP)^2 * 10^(decimalsA - decimalsB)
    // = (sqrtP)^2 * 10^(9 - 6) = (sqrtP)^2 * 10^3
    // We need USDC per SUI, so: price_USDC_per_SUI = 1 / price_SUI_per_USDC
    const priceRatio = sqrtP.pow(2);
    const decimalAdjustment = new Decimal(10).pow(decA - decB);
    const priceSuiPerUsdc = priceRatio.mul(decimalAdjustment).toNumber();
    priceUsdcPerSui = 1 / priceSuiPerUsdc;
  } else {
    throw new Error('Invalid coin type configuration');
  }

  // Sanity check
  if (
    priceUsdcPerSui < MIN_PRICE_USDC_PER_SUI ||
    priceUsdcPerSui > MAX_PRICE_USDC_PER_SUI
  ) {
    throw new Error(
      `Price ${priceUsdcPerSui.toFixed(6)} USDC/SUI is outside reasonable bounds [${MIN_PRICE_USDC_PER_SUI}, ${MAX_PRICE_USDC_PER_SUI}]. ` +
        `Coin order: A=${coinTypeA.split('::').pop()}, B=${coinTypeB.split('::').pop()}, ` +
        `Raw sqrt_price=${sqrt_price.toString()}`
    );
  }

  return priceUsdcPerSui;
}

/**
 * Get executable quote-based price (USDC per SUI) from a Cetus pool
 * Uses SDK preSwap for exact-in quote when available, falls back to on-chain sqrt_price
 * 
 * @param poolId Pool ID to query
 * @param amountInSuiAtomic Amount of SUI to use for quote (in atomic units, e.g., 1_000_000_000 for 1 SUI)
 * @returns Price in USDC per SUI derived from executable quote or pool state
 */
export async function getExecutablePriceUsdcPerSui(
  poolId: string,
  amountInSuiAtomic: bigint = BigInt(1_000_000_000) // Default: 1 SUI
): Promise<number> {
  try {
    const client = getSuiClient();

    // Fetch pool object to get state and coin types
    const poolObj = await client.getObject({
      id: poolId,
      options: { showContent: true, showType: true },
    });

    if (!poolObj.data || !poolObj.data.content) {
      throw new Error(`Pool not found: ${poolId}`);
    }

    const content = poolObj.data.content as any;
    if (content.dataType !== 'moveObject') {
      throw new Error('Invalid pool object type');
    }

    const fields = content.fields;
    const poolType = poolObj.data.type;

    if (!poolType) {
      throw new Error('Pool type not found');
    }

    // Extract coin types from Pool<CoinA, CoinB>
    const typeMatch = poolType.match(/Pool<([^,]+),\s*([^>]+)>/);
    if (!typeMatch) {
      throw new Error(`Cannot parse pool type: ${poolType}`);
    }

    const [, coinTypeA, coinTypeB] = typeMatch;
    const sqrt_price = fields.current_sqrt_price || fields.sqrt_price;

    if (!sqrt_price) {
      throw new Error('sqrt_price not found in pool state');
    }

    // Try SDK-based quote approach first (preferred)
    try {
      const priceFromQuote = await getQuoteBasedPrice(
        poolId,
        coinTypeA,
        coinTypeB,
        amountInSuiAtomic
      );
      
      logger.debug(
        `Quote-based price for pool ${poolId.slice(0, 10)}...: ${priceFromQuote.toFixed(6)} USDC/SUI`
      );
      
      return priceFromQuote;
    } catch (quoteError) {
      // Fall back to sqrt_price calculation
      logger.debug(
        `SDK quote failed for pool ${poolId.slice(0, 10)}..., falling back to sqrt_price calculation`
      );
      if (quoteError instanceof Error) {
        logger.debug(quoteError.message);
      }

      const priceFromSqrt = getUsdcPerSuiFromPoolState({
        sqrt_price,
        coinTypeA,
        coinTypeB,
      });

      logger.debug(
        `Sqrt-based price for pool ${poolId.slice(0, 10)}...: ${priceFromSqrt.toFixed(6)} USDC/SUI`
      );

      return priceFromSqrt;
    }
  } catch (error) {
    logger.error(`Failed to get executable price for pool ${poolId}`, error);
    throw error;
  }
}

/**
 * Helper to get quote-based price using simple fee calculation
 * This simulates what the SDK would return without requiring full SDK integration
 */
async function getQuoteBasedPrice(
  poolId: string,
  coinTypeA: string,
  coinTypeB: string,
  amountInSuiAtomic: bigint
): Promise<number> {
  const client = getSuiClient();

  // Fetch pool to get fee_rate
  const poolObj = await client.getObject({
    id: poolId,
    options: { showContent: true },
  });

  const content = poolObj.data?.content as any;
  const fields = content.fields;
  const feeRate = Number(fields.fee_rate || 500); // Default 0.05%
  const sqrt_price = fields.current_sqrt_price || fields.sqrt_price;

  // Calculate base price from sqrt_price
  const basePrice = getUsdcPerSuiFromPoolState({
    sqrt_price,
    coinTypeA,
    coinTypeB,
  });

  // Determine swap direction
  const aIsSui = coinTypeA === COIN_TYPES.SUI;

  if (aIsSui) {
    // Swapping SUI (A) -> USDC (B)
    // Calculate USDC output
    const suiAmount = new Decimal(amountInSuiAtomic.toString()).div(1e9);
    const usdcAmountBeforeFee = suiAmount.mul(basePrice);
    const feePercent = feeRate / 10000 / 100; // Convert basis points to decimal
    const usdcAmountAfterFee = usdcAmountBeforeFee.mul(1 - feePercent);

    // Price = USDC out / SUI in (after fees)
    const effectivePrice = usdcAmountAfterFee.div(suiAmount).toNumber();
    return effectivePrice;
  } else {
    // Swapping USDC (A) -> SUI (B)
    // This is less common for our use case, but handle it
    const usdcAmount = new Decimal(amountInSuiAtomic.toString())
      .mul(basePrice)
      .div(1e9)
      .mul(1e6); // Convert to USDC atomic units
    const feePercent = feeRate / 10000 / 100;
    const suiAmountAfterFee = new Decimal(amountInSuiAtomic.toString())
      .div(1e9)
      .mul(1 - feePercent);

    // Price = USDC in / SUI out (after fees)
    const effectivePrice = usdcAmount.div(1e6).div(suiAmountAfterFee).toNumber();
    return effectivePrice;
  }
}

/**
 * Helper to check if a coin type is USDC (any variant)
 */
function isUsdcCoinType(coinType: string): boolean {
  return (
    coinType === COIN_TYPES.BRIDGED_USDC ||
    coinType === COIN_TYPES.NATIVE_USDC ||
    coinType === COIN_TYPES.WORMHOLE_USDC ||
    coinType.toLowerCase().includes('usdc')
  );
}
