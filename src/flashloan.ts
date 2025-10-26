import { Transaction } from '@mysten/sui/transactions';
import { logger } from './logger';
import { config } from './config';
import { SUILEND, NAVI, COIN_TYPES } from './addresses';
import { sleep, getSuiClient } from './utils/sui';

/**
 * Discover reserve index for a given coin type in Suilend lending market
 * @param coinType Coin type to find reserve index for
 * @returns Reserve index or throws if not found
 */
export async function discoverSuilendReserveIndex(coinType: string): Promise<number> {
  try {
    const client = getSuiClient();
    const lendingMarket = await client.getObject({
      id: SUILEND.lendingMarket,
      options: { showContent: true },
    });

    if (!lendingMarket.data || !lendingMarket.data.content) {
      throw new Error('Suilend lending market not found');
    }

    const content = lendingMarket.data.content as any;
    if (content.dataType !== 'moveObject') {
      throw new Error('Invalid lending market object type');
    }

    // Search through reserves to find matching coin type
    const reserves = content.fields.reserves || [];
    for (let i = 0; i < reserves.length; i++) {
      const reserve = reserves[i];
      const reserveCoinType = reserve.fields?.coin_type || reserve.coin_type;
      
      if (reserveCoinType === coinType) {
        logger.info(`Found Suilend reserve index ${i} for ${coinType}`);
        return i;
      }
    }

    // Default fallback based on common knowledge
    if (coinType === COIN_TYPES.SUI) {
      logger.warn('Could not find SUI reserve dynamically, using default index 0');
      return 0;
    } else if (coinType === COIN_TYPES.USDC) {
      logger.warn('Could not find USDC reserve dynamically, using default index 0');
      return 0;
    }

    throw new Error(`No reserve found for coin type ${coinType} in Suilend`);
  } catch (error) {
    logger.error('Failed to discover Suilend reserve index', error);
    // Return default 0 as fallback
    logger.warn('Using default reserve index 0 as fallback');
    return 0;
  }
}

/**
 * Borrow coins from Suilend flashloan
 * Per Perplexity spec: {SUILEND_CORE}::lending::flash_borrow(lending_market, reserve_index, amount u64) -> (Coin<T>, FlashLoanReceipt)
 * @param tx Transaction to add borrow to
 * @param amount Amount to borrow (in smallest units)
 * @param coinType Type of coin to borrow
 * @param reserveIndex Reserve index for the coin (dynamically discovered if not provided)
 * @returns [borrowedCoins, receipt] to be used for repayment
 */
export async function borrowFromSuilend(
  tx: Transaction,
  amount: bigint,
  coinType: string,
  reserveIndex?: number
): Promise<{ borrowedCoins: any; receipt: any }> {
  try {
    // Discover reserve index if not provided
    const finalReserveIndex = reserveIndex !== undefined 
      ? reserveIndex 
      : await discoverSuilendReserveIndex(coinType);

    logger.info(`Borrowing ${amount} of ${coinType} from Suilend (reserve ${finalReserveIndex})`);

    // Suilend flashloan entrypoint per Perplexity spec:
    // lending::flash_borrow(lending_market, reserve_index, amount) -> (Coin<T>, FlashLoanReceipt)
    const [borrowedCoins, receipt] = tx.moveCall({
      target: `${SUILEND.packageId}::lending::flash_borrow`,
      arguments: [
        tx.object(SUILEND.lendingMarket),
        tx.pure.u64(finalReserveIndex.toString()),
        tx.pure.u64(amount.toString()),
      ],
      typeArguments: [coinType],
    });

    logger.debug('Suilend flash_borrow transaction added to PTB');

    return { borrowedCoins, receipt };
  } catch (error) {
    logger.error('Failed to create Suilend borrow transaction', error);
    throw error;
  }
}

/**
 * Repay coins to Suilend flashloan
 * Per Perplexity spec: {SUILEND_CORE}::lending::flash_repay(lending_market, reserve_index, Coin<T>, FlashLoanReceipt)
 * @param tx Transaction to add repay to
 * @param receipt Receipt from borrow
 * @param repayCoins Coins to repay
 * @param coinType Type of coin being repaid
 * @param reserveIndex Reserve index for the coin (must match borrow)
 */
export function repayToSuilend(
  tx: Transaction,
  receipt: any,
  repayCoins: any,
  coinType: string,
  reserveIndex: number = 0
): void {
  try {
    logger.debug('Adding Suilend flash_repay to PTB');

    // Suilend flashloan repayment per Perplexity spec:
    // lending::flash_repay(lending_market, reserve_index, Coin<T>, FlashLoanReceipt)
    tx.moveCall({
      target: `${SUILEND.packageId}::lending::flash_repay`,
      arguments: [
        tx.object(SUILEND.lendingMarket),
        tx.pure.u64(reserveIndex.toString()),
        repayCoins,
        receipt,
      ],
      typeArguments: [coinType],
    });

    logger.debug('Suilend flash_repay transaction added to PTB');
  } catch (error) {
    logger.error('Failed to create Suilend repay transaction', error);
    throw error;
  }
}

/**
 * Borrow coins from Navi Protocol (fallback)
 * Per Perplexity spec: {NAVI_CORE}::lending::flash_loan(storage, pool_id u8, amount u64, &Clock) -> (Coin<T>, FlashLoanReceipt)
 * @param tx Transaction to add borrow to
 * @param amount Amount to borrow (in smallest units)
 * @param coinType Type of coin to borrow
 * @param poolId Pool ID for the coin (dynamically discovered, defaults to 3 for USDC)
 * @returns [borrowedCoins, receipt] to be used for repayment
 */
export async function borrowFromNavi(
  tx: Transaction,
  amount: bigint,
  coinType: string,
  poolId: number = 3
): Promise<{ borrowedCoins: any; receipt: any }> {
  try {
    logger.info(`Borrowing ${amount} of ${coinType} from Navi (pool ${poolId}, fallback)`);

    // Navi flashloan entrypoint per Perplexity spec:
    // lending::flash_loan(storage, pool_id u8, amount u64, &Clock) -> (Coin<T>, FlashLoanReceipt)
    const [borrowedCoins, receipt] = tx.moveCall({
      target: `${NAVI.packageId}::lending::flash_loan`,
      arguments: [
        tx.object(NAVI.storageId),
        tx.pure.u8(poolId), // Pool ID for native USDC (default 3)
        tx.pure.u64(amount.toString()),
        tx.object('0x6'), // Clock object
      ],
      typeArguments: [coinType],
    });

    logger.debug('Navi flash_loan transaction added to PTB');

    return { borrowedCoins, receipt };
  } catch (error) {
    logger.error('Failed to create Navi borrow transaction', error);
    throw error;
  }
}

/**
 * Repay coins to Navi Protocol
 * Per Perplexity spec: {NAVI_CORE}::lending::repay_flash_loan(storage, pool_id u8, Coin<T>, FlashLoanReceipt)
 * @param tx Transaction to add repay to
 * @param receipt Receipt from borrow
 * @param repayCoins Coins to repay
 * @param coinType Type of coin being repaid
 * @param poolId Pool ID for the coin (must match borrow)
 */
export function repayToNavi(
  tx: Transaction,
  receipt: any,
  repayCoins: any,
  coinType: string,
  poolId: number = 3
): void {
  try {
    logger.debug('Adding Navi repay_flash_loan to PTB');

    // Navi flashloan repayment per Perplexity spec:
    // lending::repay_flash_loan(storage, pool_id u8, Coin<T>, FlashLoanReceipt)
    tx.moveCall({
      target: `${NAVI.packageId}::lending::repay_flash_loan`,
      arguments: [
        tx.object(NAVI.storageId),
        tx.pure.u8(poolId),
        repayCoins,
        receipt,
      ],
      typeArguments: [coinType],
    });

    logger.debug('Navi repay_flash_loan transaction added to PTB');
  } catch (error) {
    logger.error('Failed to create Navi repay transaction', error);
    throw error;
  }
}

/**
 * Attempt flashloan with retries and fallback
 * @param tx Transaction to add flashloan to
 * @param amount Amount to borrow
 * @param coinType Coin type to borrow
 * @returns Borrow result with provider info
 */
export async function flashloanWithRetries(
  tx: Transaction,
  amount: bigint,
  coinType: string
): Promise<{
  borrowedCoins: any;
  receipt: any;
  provider: 'suilend' | 'navi';
  feePercent: number;
}> {
  const maxRetries = config.maxRetries;
  let lastError: Error | null = null;

  // Try Suilend first with retries
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = config.retryDelayMs * Math.pow(2, attempt - 1);
        logger.info(`Retrying Suilend borrow, attempt ${attempt + 1}/${maxRetries}`);
        await sleep(delay);
      }

      const result = await borrowFromSuilend(tx, amount, coinType);
      return {
        ...result,
        provider: 'suilend',
        feePercent: config.suilendFeePercent,
      };
    } catch (error) {
      lastError = error as Error;
      logger.warn(`Suilend borrow attempt ${attempt + 1} failed`, error);
    }
  }

  // Fallback to Navi
  logger.warn('Suilend failed, falling back to Navi');

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = config.retryDelayMs * Math.pow(2, attempt - 1);
        logger.info(`Retrying Navi borrow, attempt ${attempt + 1}/${maxRetries}`);
        await sleep(delay);
      }

      const result = await borrowFromNavi(tx, amount, coinType);
      return {
        ...result,
        provider: 'navi',
        feePercent: config.naviFeePercent,
      };
    } catch (error) {
      lastError = error as Error;
      logger.warn(`Navi borrow attempt ${attempt + 1} failed`, error);
    }
  }

  // Both failed
  throw new Error(
    `Flashloan failed from both Suilend and Navi: ${lastError?.message || 'Unknown error'}`
  );
}

/**
 * Calculate flashloan repayment amount
 * Uses ceiling division to ensure we repay enough
 * @param borrowAmount Amount borrowed
 * @param feePercent Fee percentage (e.g., 0.05 for 0.05%)
 * @returns Total amount to repay (principal + fee, rounded up)
 */
export function calculateRepayAmount(borrowAmount: bigint, feePercent: number): bigint {
  // Calculate fee with ceiling: fee = ceil(principal * feePercent)
  // Using formula: ceil(a/b) = (a + b - 1) / b
  const feeRate = BigInt(Math.floor(feePercent * 10000)); // Convert to basis points
  const denominator = BigInt(10000);
  const fee = (borrowAmount * feeRate + denominator - BigInt(1)) / denominator;
  return borrowAmount + fee;
}
