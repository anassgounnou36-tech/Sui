import { Transaction } from '@mysten/sui/transactions';
import { logger } from './logger';
import { config } from './config';
import { SUILEND, NAVI } from './addresses';
import { sleep } from './utils/sui';

/**
 * Borrow coins from Suilend flashloan
 * Per Perplexity spec: {SUILEND_CORE}::lending::flash_borrow(lending_market, reserve_index, amount u64) -> (Coin<T>, FlashLoanReceipt)
 * @param tx Transaction to add borrow to
 * @param amount Amount to borrow (in smallest units)
 * @param coinType Type of coin to borrow
 * @param reserveIndex Reserve index for the coin (dynamically discovered, defaults to 0 for USDC)
 * @returns [borrowedCoins, receipt] to be used for repayment
 */
export async function borrowFromSuilend(
  tx: Transaction,
  amount: bigint,
  coinType: string,
  reserveIndex: number = 0
): Promise<{ borrowedCoins: any; receipt: any }> {
  try {
    logger.info(`Borrowing ${amount} of ${coinType} from Suilend (reserve ${reserveIndex})`);

    // Suilend flashloan entrypoint per Perplexity spec:
    // lending::flash_borrow(lending_market, reserve_index, amount) -> (Coin<T>, FlashLoanReceipt)
    const [borrowedCoins, receipt] = tx.moveCall({
      target: `${SUILEND.packageId}::lending::flash_borrow`,
      arguments: [
        tx.object(SUILEND.lendingMarket),
        tx.pure.u64(reserveIndex.toString()), // reserve_index for native USDC
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
 * @param borrowAmount Amount borrowed
 * @param feePercent Fee percentage
 * @returns Total amount to repay (principal + fee)
 */
export function calculateRepayAmount(borrowAmount: bigint, feePercent: number): bigint {
  const fee = (borrowAmount * BigInt(Math.floor(feePercent * 100))) / BigInt(10000);
  return borrowAmount + fee;
}
