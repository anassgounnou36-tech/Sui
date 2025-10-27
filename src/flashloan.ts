import { Transaction } from '@mysten/sui/transactions';
import { logger } from './logger';
import { config, smallestUnitToSui, smallestUnitToUsdc } from './config';
import { SUILEND, NAVI, COIN_TYPES } from './addresses';
import { sleep, getSuiClient } from './utils/sui';

/**
 * Suilend reserve configuration
 */
export interface SuilendReserveConfig {
  reserveIndex: number;
  borrowFeeBps: bigint;
  availableAmount: bigint;
  coinType: string;
}

/**
 * Read Suilend reserve configuration including fee and available borrow amount
 * Iterates content.fields.reserves and matches reserves[i].fields.coin_type.name
 * @param coinType Coin type to read config for (default: "0x2::sui::SUI")
 * @returns Reserve configuration with fee_bps and available_amount
 */
export async function readSuilendReserveConfig(coinType: string = COIN_TYPES.SUI): Promise<SuilendReserveConfig> {
  try {
    const client = getSuiClient();
    const lendingMarket = await client.getObject({
      id: SUILEND.lendingMarket,
      options: { showContent: true, showType: true },
    });

    if (!lendingMarket.data || !lendingMarket.data.content) {
      throw new Error('Suilend lending market not found');
    }

    const content = lendingMarket.data.content as any;
    if (content.dataType !== 'moveObject') {
      throw new Error('Invalid lending market object type');
    }

    // Iterate reserves vector (inline Reserve structs in content.fields.reserves)
    const reserves = content.fields.reserves || [];
    for (let i = 0; i < reserves.length; i++) {
      const reserve = reserves[i];
      
      // Match reserves[i].fields.coin_type.name === coinType (verified via on-chain inspection)
      const reserveCoinType = reserve.fields?.coin_type?.name || reserve.fields?.coin_type || reserve.coin_type;
      
      if (reserveCoinType === coinType) {
        // Read from reserves[i].fields.config.fields.borrow_fee_bps (u64 bps)
        const config = reserve.fields?.config;
        const borrowFeeBps = BigInt(
          config?.fields?.borrow_fee_bps || 
          config?.borrow_fee_bps || 
          '5'
        ); // Default 5 bps = 0.05%
        
        // Read from reserves[i].fields.available_amount (base units, 9 decimals for SUI)
        const availableAmount = BigInt(reserve.fields?.available_amount || '0');
        
        // Log discovery with detailed info
        const isSui = coinType === COIN_TYPES.SUI;
        const humanAmount = isSui 
          ? smallestUnitToSui(availableAmount) 
          : smallestUnitToUsdc(availableAmount);
        const unit = isSui ? 'SUI' : 'USDC';
        
        logger.info(`✓ Found Suilend reserve for ${coinType}`);
        logger.info(`  Reserve index: ${i}`);
        logger.info(`  Borrow fee: ${borrowFeeBps} bps (${Number(borrowFeeBps) / 100}%)`);
        logger.info(`  Available amount: ${humanAmount.toFixed(2)} ${unit}`);
        
        return {
          reserveIndex: i,
          borrowFeeBps,
          availableAmount,
          coinType,
        };
      }
    }

    // If not found, handle based on mode
    const errorMsg = `Could not find reserve for coin type ${coinType} in Suilend lending market.`;
    
    if (config.dryRun) {
      // In simulation/dry-run mode, allow fallback with clear warning
      logger.warn(errorMsg);
      logger.warn('Using default reserve config for simulation purposes.');
      logger.warn('In live mode (DRY_RUN=false), this would fail.');
      logger.warn('To fix: Check SUILEND_LENDING_MARKET is correct and reserve exists.');
      
      return {
        reserveIndex: 0,
        borrowFeeBps: BigInt(5), // 0.05%
        availableAmount: BigInt('1000000000000000'), // Large default for simulation
        coinType,
      };
    } else {
      // In live mode, fail explicitly with guidance
      logger.error(errorMsg);
      logger.error('Reserve discovery failed. Cannot proceed in live mode.');
      logger.error('Please verify:');
      logger.error('  1. SUILEND_LENDING_MARKET is set correctly in .env');
      logger.error('  2. The lending market contains a reserve for the coin type');
      logger.error(`  3. Coin type matches exactly: ${coinType}`);
      throw new Error(
        `${errorMsg} Cannot proceed in live mode. ` +
        `Verify SUILEND_LENDING_MARKET and reserve configuration.`
      );
    }
  } catch (error) {
    // For unexpected errors (network, parsing, etc.)
    logger.error('Failed to read Suilend reserve config', error);
    
    if (config.dryRun) {
      // In simulation, allow fallback but log prominently
      logger.warn('Network or parsing error while reading Suilend reserve.');
      logger.warn('Using default reserve config for simulation purposes.');
      logger.warn('In live mode (DRY_RUN=false), this would fail.');
      
      return {
        reserveIndex: 0,
        borrowFeeBps: BigInt(5), // 0.05%
        availableAmount: BigInt('1000000000000000'), // Large default for simulation
        coinType,
      };
    } else {
      // In live mode, fail with clear guidance
      logger.error('Cannot read Suilend reserve configuration in live mode.');
      logger.error('Possible causes:');
      logger.error('  1. Network connectivity issue');
      logger.error('  2. RPC endpoint not responding');
      logger.error('  3. Suilend lending market object changed structure');
      throw error;
    }
  }
}

/**
 * Discover reserve index for a given coin type in Suilend lending market
 * @deprecated Use readSuilendReserveConfig instead
 * @param coinType Coin type to find reserve index for
 * @returns Reserve index or throws if not found
 */
export async function discoverSuilendReserveIndex(coinType: string): Promise<number> {
  const config = await readSuilendReserveConfig(coinType);
  return config.reserveIndex;
}

/**
 * Borrow coins from Suilend flashloan with dynamic fee and availability checks
 * Per Perplexity spec: {SUILEND_CORE}::lending::flash_borrow(lending_market, reserve_index, amount u64) -> (Coin<T>, FlashLoanReceipt)
 * @param tx Transaction to add borrow to
 * @param amount Amount to borrow (in smallest units)
 * @param coinType Type of coin to borrow
 * @param reserveConfig Reserve configuration (if not provided, will be read dynamically)
 * @returns [borrowedCoins, receipt, reserveConfig] to be used for repayment
 */
export async function borrowFromSuilend(
  tx: Transaction,
  amount: bigint,
  coinType: string,
  reserveConfig?: SuilendReserveConfig
): Promise<{ borrowedCoins: any; receipt: any; reserveConfig: SuilendReserveConfig }> {
  try {
    // Read reserve config if not provided
    const finalConfig = reserveConfig || await readSuilendReserveConfig(coinType);

    // Enforce capacity limit: principal <= available_amount - SAFETY_BUFFER
    const safetyBuffer = BigInt(config.suilendSafetyBuffer);
    assertBorrowWithinCap(amount, finalConfig.availableAmount, safetyBuffer, coinType);
    
    // Helper for unit conversion
    const isSui = coinType === COIN_TYPES.SUI;
    const unit = isSui ? 'SUI' : 'USDC';
    const toHuman = (amt: bigint) => isSui ? smallestUnitToSui(amt) : smallestUnitToUsdc(amt);
    
    // Compute repay with ceiling division: repay = principal + ceil(principal * fee_bps / 10_000)
    const repayAmount = computeRepayAmountBase(amount, finalConfig.borrowFeeBps);
    
    // Log detailed borrow info
    logger.info(`Borrowing from Suilend`);
    logger.info(`  Reserve index: ${finalConfig.reserveIndex}`);
    logger.info(`  Fee: ${finalConfig.borrowFeeBps} bps (${Number(finalConfig.borrowFeeBps) / 100}%)`);
    logger.info(`  Principal: ${toHuman(amount).toFixed(6)} ${unit}`);
    logger.info(`  Repay amount: ${toHuman(repayAmount).toFixed(6)} ${unit}`);

    // Suilend flashloan entrypoint per Perplexity spec:
    // lending::flash_borrow(lending_market, reserve_index, amount) -> (Coin<T>, FlashLoanReceipt)
    const [borrowedCoins, receipt] = tx.moveCall({
      target: `${SUILEND.packageId}::lending::flash_borrow`,
      arguments: [
        tx.object(SUILEND.lendingMarket),
        tx.pure.u64(finalConfig.reserveIndex.toString()),
        tx.pure.u64(amount.toString()),
      ],
      typeArguments: [coinType],
    });

    logger.debug('Suilend flash_borrow transaction added to PTB');

    return { borrowedCoins, receipt, reserveConfig: finalConfig };
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
 * @returns Borrow result with provider info and reserve config
 */
export async function flashloanWithRetries(
  tx: Transaction,
  amount: bigint,
  coinType: string
): Promise<{
  borrowedCoins: any;
  receipt: any;
  provider: 'suilend' | 'navi';
  feePercent?: number;
  feeBps?: bigint;
  reserveConfig?: SuilendReserveConfig;
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
        feeBps: result.reserveConfig.borrowFeeBps,
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
 * Assert that borrow amount is within available capacity with safety buffer
 * Enforces: principal <= available_amount - SAFETY_BUFFER
 * @param principalBase Principal amount to borrow (base units)
 * @param availableBase Available amount in reserve (base units)
 * @param safetyBufferBase Safety buffer to reserve (base units)
 * @param coinType Coin type for error messaging
 * @throws Error if borrow exceeds capacity (in live mode); warns in DRY_RUN mode
 */
export function assertBorrowWithinCap(
  principalBase: bigint,
  availableBase: bigint,
  safetyBufferBase: bigint,
  coinType: string
): void {
  const maxBorrow = availableBase - safetyBufferBase;
  
  if (principalBase > maxBorrow) {
    const isSui = coinType === COIN_TYPES.SUI;
    const unit = isSui ? 'SUI' : 'USDC';
    const toHuman = (amt: bigint) => isSui ? smallestUnitToSui(amt) : smallestUnitToUsdc(amt);
    
    const errorMsg = 
      `Insufficient Suilend reserve capacity:\n` +
      `  Requested: ${toHuman(principalBase).toFixed(2)} ${unit}\n` +
      `  Available: ${toHuman(maxBorrow).toFixed(2)} ${unit} (after ${safetyBufferBase} buffer)\n` +
      `  Total reserve: ${toHuman(availableBase).toFixed(2)} ${unit}\n` +
      `To fix: Reduce FLASHLOAN_AMOUNT or adjust SUILEND_SAFETY_BUFFER`;
    
    if (config.dryRun) {
      // In DRY_RUN=true, WARN and continue for demonstrability
      logger.warn('⚠️  Capacity check failed (simulation mode, continuing)');
      logger.warn(errorMsg);
    } else {
      // In DRY_RUN=false (live), fail fast with clear error
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  }
}

/**
 * Compute flashloan repayment amount from fee in basis points
 * Formula: repay = principal + ceil(principal * fee_bps / 10_000)
 * Uses integer ceiling division in bigint arithmetic to ensure we repay enough
 * @param principalBase Principal amount borrowed (base units)
 * @param feeBps Fee in basis points (e.g., 5 for 0.05%)
 * @returns Total amount to repay (principal + fee, rounded up)
 */
export function computeRepayAmountBase(principalBase: bigint, feeBps: bigint): bigint {
  // Calculate fee with ceiling: fee = ceil(principal * feeBps / 10_000)
  // Using formula: ceil(a/b) = (a + b - 1) / b
  const denominator = BigInt(10000);
  const fee = (principalBase * feeBps + denominator - BigInt(1)) / denominator;
  return principalBase + fee;
}

/**
 * Calculate flashloan repayment amount from fee in basis points
 * @deprecated Use computeRepayAmountBase instead for clarity
 * Uses ceiling division to ensure we repay enough
 * @param borrowAmount Amount borrowed
 * @param feeBps Fee in basis points (e.g., 5 for 0.05%)
 * @returns Total amount to repay (principal + fee, rounded up)
 */
export function calculateRepayAmountFromBps(borrowAmount: bigint, feeBps: bigint): bigint {
  return computeRepayAmountBase(borrowAmount, feeBps);
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
