import { Transaction } from '@mysten/sui/transactions';
import { logger } from './logger';
import { config } from './config';
import { SUILEND, NAVI, COIN_TYPES } from './addresses';
import { sleep } from './utils/sui';

/**
 * Borrow coins from Suilend flashloan
 * @param tx Transaction to add borrow to
 * @param amount Amount to borrow (in smallest units)
 * @param coinType Type of coin to borrow
 * @returns [borrowedCoins, receipt] to be used for repayment
 */
export async function borrowFromSuilend(
  tx: Transaction,
  amount: bigint,
  coinType: string
): Promise<{ borrowedCoins: any; receipt: any }> {
  try {
    logger.info(`Borrowing ${amount} of ${coinType} from Suilend`);

    // Suilend flashloan call structure (simplified)
    // In production, use proper Suilend SDK integration
    const [borrowedCoins, receipt] = tx.moveCall({
      target: `${SUILEND.packageId}::lending::borrow_flash`,
      arguments: [
        tx.object(SUILEND.lendingMarket),
        tx.pure.u64(amount.toString()),
      ],
      typeArguments: [coinType],
    });

    logger.debug('Suilend borrow transaction added to PTB');

    return { borrowedCoins, receipt };
  } catch (error) {
    logger.error('Failed to create Suilend borrow transaction', error);
    throw error;
  }
}

/**
 * Repay coins to Suilend flashloan
 * @param tx Transaction to add repay to
 * @param receipt Receipt from borrow
 * @param repayCoins Coins to repay
 * @param coinType Type of coin being repaid
 */
export function repayToSuilend(
  tx: Transaction,
  receipt: any,
  repayCoins: any,
  coinType: string
): void {
  try {
    logger.debug('Adding Suilend repay to PTB');

    // Suilend flashloan repayment (simplified)
    // In production, use proper Suilend SDK integration
    tx.moveCall({
      target: `${SUILEND.packageId}::lending::repay_flash`,
      arguments: [
        tx.object(SUILEND.lendingMarket),
        receipt,
        repayCoins,
      ],
      typeArguments: [coinType],
    });

    logger.debug('Suilend repay transaction added to PTB');
  } catch (error) {
    logger.error('Failed to create Suilend repay transaction', error);
    throw error;
  }
}

/**
 * Borrow coins from Navi Protocol (fallback)
 * @param tx Transaction to add borrow to
 * @param amount Amount to borrow (in smallest units)
 * @param coinType Type of coin to borrow
 * @returns [borrowedCoins, receipt] to be used for repayment
 */
export async function borrowFromNavi(
  tx: Transaction,
  amount: bigint,
  coinType: string
): Promise<{ borrowedCoins: any; receipt: any }> {
  try {
    logger.info(`Borrowing ${amount} of ${coinType} from Navi (fallback)`);

    // Navi flashloan call structure (simplified)
    // In production, use proper Navi SDK integration
    const [borrowedCoins, receipt] = tx.moveCall({
      target: `${NAVI.packageId}::flash_loan::borrow_flash_loan`,
      arguments: [
        tx.object(NAVI.storageId),
        tx.pure.u8(0), // Pool index for USDC
        tx.pure.u64(amount.toString()),
      ],
      typeArguments: [coinType],
    });

    logger.debug('Navi borrow transaction added to PTB');

    return { borrowedCoins, receipt };
  } catch (error) {
    logger.error('Failed to create Navi borrow transaction', error);
    throw error;
  }
}

/**
 * Repay coins to Navi Protocol
 * @param tx Transaction to add repay to
 * @param receipt Receipt from borrow
 * @param repayCoins Coins to repay
 * @param coinType Type of coin being repaid
 */
export function repayToNavi(
  tx: Transaction,
  receipt: any,
  repayCoins: any,
  coinType: string
): void {
  try {
    logger.debug('Adding Navi repay to PTB');

    // Navi flashloan repayment (simplified)
    tx.moveCall({
      target: `${NAVI.packageId}::flash_loan::repay_flash_loan`,
      arguments: [
        tx.object(NAVI.storageId),
        tx.pure.u8(0), // Pool index for USDC
        receipt,
        repayCoins,
      ],
      typeArguments: [coinType],
    });

    logger.debug('Navi repay transaction added to PTB');
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
