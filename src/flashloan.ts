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
 * Reserves are stored in a 0x2::bag::Bag as dynamic fields (not a vector).
 * 
 * @param marketId Market object ID (defaults to SUILEND.lendingMarket)
 * @param targetCoinType Coin type to read config for (defaults to 0x2::sui::SUI)
 * @returns Reserve configuration with reserveKey (field.name.value), feeBps, availableAmount
 */
export async function readSuilendReserveConfig(
  targetCoinType: string = COIN_TYPES.SUI,
  marketId: string = SUILEND.lendingMarket
): Promise<SuilendReserveConfig> {
  try {
    const client = getSuiClient();
    
    // Fetch the lending market object
    const lendingMarket = await client.getObject({
      id: marketId,
      options: { showContent: true },
    });

    if (!lendingMarket.data || !lendingMarket.data.content) {
      throw new Error('Suilend lending market not found');
    }

    const content = lendingMarket.data.content as any;
    if (content.dataType !== 'moveObject') {
      throw new Error('Invalid lending market object type');
    }

    // Extract bagId from reserves Bag
    // Per Perplexity: reserves is a 0x2::bag::Bag stored at content.fields.reserves.fields.id.id
    const reservesBag = content.fields?.reserves;
    if (!reservesBag || !reservesBag.fields || !reservesBag.fields.id || !reservesBag.fields.id.id) {
      throw new Error('Cannot extract bagId from lending market reserves field');
    }
    
    const bagId = reservesBag.fields.id.id;
    logger.debug(`Reserves bagId: ${bagId}`);

    // Enumerate dynamic fields with pagination
    let allDynamicFields: any[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage) {
      const dynamicFieldsPage = await client.getDynamicFields({
        parentId: bagId,
        cursor: cursor || undefined,
      });

      allDynamicFields = allDynamicFields.concat(dynamicFieldsPage.data);
      hasNextPage = dynamicFieldsPage.hasNextPage;
      cursor = dynamicFieldsPage.nextCursor || null;

      logger.debug(`Fetched ${dynamicFieldsPage.data.length} dynamic fields (hasNextPage: ${hasNextPage})`);
    }

    logger.info(`Found ${allDynamicFields.length} reserves in Suilend lending market bag`);

    // Log the first dynamic field structure at DEBUG level for troubleshooting
    if (allDynamicFields.length > 0) {
      logger.debug(`First dynamic field structure: ${JSON.stringify(allDynamicFields[0], null, 2)}`);
    }

    // Iterate through dynamic fields to find matching coin type
    for (let i = 0; i < allDynamicFields.length; i++) {
      const field = allDynamicFields[i];
      
      // Fetch the dynamic field object
      const fieldObject = await client.getDynamicFieldObject({
        parentId: bagId,
        name: {
          type: field.name.type,
          value: field.name.value,
        },
      });

      if (!fieldObject.data || !fieldObject.data.content) {
        logger.debug(`Skipping field ${i}: no content`);
        continue;
      }

      const fieldContent = fieldObject.data.content as any;
      if (fieldContent.dataType !== 'moveObject') {
        logger.debug(`Skipping field ${i}: not a moveObject`);
        continue;
      }

      // Extract reserve data
      const reserveFields = fieldContent.fields;
      const reserveCoinType = reserveFields?.coin_type;

      // Check if this is our target coin type
      if (reserveCoinType === targetCoinType) {
        // Extract borrow_fee from config (NOT borrow_fee_bps)
        // Per Perplexity: fee field is config.borrow_fee (bps), not borrow_fee_bps
        const configFields = reserveFields?.config?.fields || reserveFields?.config;
        const borrowFeeBps = BigInt(configFields?.borrow_fee || '5'); // Default 5 bps = 0.05%
        
        // Extract available_amount (base units, e.g., 9 decimals for SUI)
        const availableAmount = BigInt(reserveFields?.available_amount || '0');
        
        // Reserve key is the field name value
        const reserveKey = field.name.value;

        logger.info(`Found Suilend reserve for ${targetCoinType}`);
        logger.info(`  Reserve key: ${reserveKey}`);
        logger.info(`  Borrow fee: ${borrowFeeBps} bps (${Number(borrowFeeBps) / 100}%)`);
        
        // Log in human units
        const isSui = targetCoinType === COIN_TYPES.SUI;
        const humanAmount = isSui 
          ? smallestUnitToSui(availableAmount) 
          : smallestUnitToUsdc(availableAmount);
        const unit = isSui ? 'SUI' : 'USDC';
        logger.info(`  Available amount: ${humanAmount.toFixed(2)} ${unit}`);
        
        // Convert reserveKey to number (should be numeric for Suilend reserves)
        const reserveIndexNum = Number(reserveKey);
        if (isNaN(reserveIndexNum)) {
          logger.warn(`Reserve key '${reserveKey}' is not numeric, using as-is (may cause issues)`);
        }
        
        return {
          reserveIndex: isNaN(reserveIndexNum) ? 0 : reserveIndexNum, // Fallback to 0 if not numeric
          borrowFeeBps,
          availableAmount,
          coinType: targetCoinType,
        };
      }
    }

    // If not found, handle based on mode
    const errorMsg = `Could not find reserve for coin type ${targetCoinType} in Suilend lending market.`;
    
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
        coinType: targetCoinType,
      };
    } else {
      // In live mode, fail explicitly with guidance
      logger.error(errorMsg);
      logger.error('Reserve discovery failed. Cannot proceed in live mode.');
      logger.error('Please verify:');
      logger.error('  1. SUILEND_LENDING_MARKET is set correctly in .env');
      logger.error('  2. The lending market contains a reserve for the coin type');
      logger.error(`  3. Coin type matches exactly: ${targetCoinType}`);
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
        coinType: targetCoinType,
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

    // Check available amount with safety buffer
    const safetyBuffer = BigInt(config.suilendSafetyBuffer);
    const maxBorrow = finalConfig.availableAmount - safetyBuffer;
    
    // Helper for unit conversion
    const isSui = coinType === COIN_TYPES.SUI;
    const unit = isSui ? 'SUI' : 'USDC';
    const toHuman = (amt: bigint) => isSui ? smallestUnitToSui(amt) : smallestUnitToUsdc(amt);
    
    if (amount > maxBorrow) {
      const errorMsg = 
        `Insufficient Suilend reserve capacity:\n` +
        `  Requested: ${toHuman(amount).toFixed(2)} ${unit}\n` +
        `  Available: ${toHuman(maxBorrow).toFixed(2)} ${unit} (after ${safetyBuffer} buffer)\n` +
        `  Total reserve available: ${toHuman(finalConfig.availableAmount).toFixed(2)} ${unit}\n` +
        `  Reserve index: ${finalConfig.reserveIndex}\n` +
        `To fix: Reduce FLASHLOAN_AMOUNT or adjust SUILEND_SAFETY_BUFFER`;
      
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    logger.info(`Borrowing ${amount} of ${coinType} from Suilend (reserve ${finalConfig.reserveIndex})`);
    logger.info(`  Fee: ${finalConfig.borrowFeeBps} bps (${Number(finalConfig.borrowFeeBps) / 100}%)`);
    
    // Calculate and log repay amount
    const repayAmount = calculateRepayAmountFromBps(amount, finalConfig.borrowFeeBps);
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
 * Calculate flashloan repayment amount from fee in basis points
 * Uses ceiling division to ensure we repay enough
 * @param borrowAmount Amount borrowed
 * @param feeBps Fee in basis points (e.g., 5 for 0.05%)
 * @returns Total amount to repay (principal + fee, rounded up)
 */
export function calculateRepayAmountFromBps(borrowAmount: bigint, feeBps: bigint): bigint {
  // Calculate fee with ceiling: fee = ceil(principal * feeBps / 10_000)
  // Using formula: ceil(a/b) = (a + b - 1) / b
  const denominator = BigInt(10000);
  const fee = (borrowAmount * feeBps + denominator - BigInt(1)) / denominator;
  return borrowAmount + fee;
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
