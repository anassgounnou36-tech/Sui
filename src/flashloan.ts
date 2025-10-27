import { Transaction } from '@mysten/sui/transactions';
import { SuiClient } from '@mysten/sui/client';
import { logger } from './logger';
import { config, smallestUnitToSui, smallestUnitToUsdc } from './config';
import { SUILEND, NAVI, COIN_TYPES } from './addresses';
import { sleep, getSuiClient } from './utils/sui';

/**
 * Suilend reserve configuration with backward-compatible fields
 */
export interface ReserveConfig {
  // New fields
  reserveKey: string;
  feeBps: number;
  availableAmount: bigint;
  coinType?: string;
  
  // Backward-compatible aliases
  reserveIndex?: number;
  borrowFeeBps?: number;
}

/**
 * @deprecated Use ReserveConfig instead
 */
export interface SuilendReserveConfig {
  reserveIndex: number;
  borrowFeeBps: bigint;
  availableAmount: bigint;
  coinType: string;
}

/**
 * Extract coin type from a reserve entry using multiple fallback strategies
 * @param entry Reserve entry from the reserves vector
 * @returns Extracted and normalized coin type string, or undefined if not found
 */
function getCoinTypeFromReserveEntry(entry: any): string | undefined {
  const reserveFields = entry.fields || entry;
  
  // Strategy a) TypeName canonical: entry.fields.coin_type.fields.name
  if (reserveFields?.coin_type?.fields?.name) {
    return String(reserveFields.coin_type.fields.name).trim();
  }
  
  // Strategy b) Alternate SDK flattening: entry.fields.coin_type.name
  if (reserveFields?.coin_type?.name) {
    return String(reserveFields.coin_type.name).trim();
  }
  
  // Strategy c) Direct string: entry.fields.coin_type
  if (typeof reserveFields?.coin_type === 'string') {
    return reserveFields.coin_type.trim();
  }
  
  // Strategy d) Parse from entry.type via regex as last-resort hint
  // Format: "...::reserve::Reserve<COIN_TYPE>"
  if (entry.type && typeof entry.type === 'string') {
    const match = entry.type.match(/::reserve::Reserve<(.+)>$/);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return undefined;
}

/**
 * Read Suilend reserve configuration using Bag-based discovery
 * Overload: (client, marketId, coinType?, opts?) for explicit control
 * Overload: (coinType?) for convenience, uses env vars and default client
 * @param clientOrCoinType SuiClient instance or coin type string
 * @param marketId Market object ID (required if first param is SuiClient)
 * @param coinType Coin type to discover (optional, defaults to SUI)
 * @param opts Options (for future pagination control)
 * @returns Reserve configuration with both new and compat fields
 */
export async function readSuilendReserveConfig(
  clientOrCoinType?: SuiClient | string,
  marketId?: string,
  coinType?: string,
  opts?: { maxPages?: number }
): Promise<ReserveConfig> {
  // Determine overload: coinType-only vs full params
  let client: SuiClient;
  let market: string;
  let targetCoinType: string;
  
  if (typeof clientOrCoinType === 'string' || clientOrCoinType === undefined) {
    // Overload: readSuilendReserveConfig(coinType?)
    client = getSuiClient();
    market = process.env.SUILEND_LENDING_MARKET || SUILEND.lendingMarket;
    targetCoinType = process.env.SUILEND_TARGET_COIN_TYPE || clientOrCoinType || COIN_TYPES.SUI;
    logger.debug(`Using convenience overload: market=${market}, coinType=${targetCoinType}`);
  } else {
    // Overload: readSuilendReserveConfig(client, marketId, coinType?, opts?)
    client = clientOrCoinType;
    market = marketId!;
    targetCoinType = process.env.SUILEND_TARGET_COIN_TYPE || coinType || COIN_TYPES.SUI;
    logger.debug(`Using explicit overload: market=${market}, coinType=${targetCoinType}`);
  }
  
  const maxPages = opts?.maxPages || 10;

  try {
    // Step 1: Fetch lending market object
    const lendingMarket = await client.getObject({
      id: market,
      options: { showContent: true, showType: true },
    });

    if (!lendingMarket.data || !lendingMarket.data.content) {
      throw new Error('Suilend lending market not found');
    }

    const content = lendingMarket.data.content as any;
    if (content.dataType !== 'moveObject') {
      throw new Error('Invalid lending market object type');
    }

    // Log content.fields keys once for visibility
    logger.info('[Suilend] Market object fields: ' + Object.keys(content.fields || {}).join(', '));

    // Step 2: Try vector-based discovery first (mainnet uses direct vector)
    const reserves = content.fields?.reserves;
    
    if (Array.isArray(reserves)) {
      // Vector path: reserves is a direct array
      logger.info(`[Suilend] Using vector-based discovery: ${reserves.length} reserves found`);
      
      // Diagnostic logging for first 3 entries (always on)
      const numToLog = Math.min(3, reserves.length);
      for (let i = 0; i < numToLog; i++) {
        const reserve = reserves[i];
        logger.info(`[Suilend] Reserve[${i}] diagnostics:`);
        logger.info(`  - type: ${reserve?.type || 'no type field'}`);
        logger.info(`  - fields keys: ${Object.keys(reserve?.fields || {}).join(', ')}`);
        
        // Log full coin_type object structure
        if (reserve?.fields?.coin_type) {
          logger.info(`  - coin_type object: ${JSON.stringify(reserve.fields.coin_type)}`);
        } else {
          logger.info(`  - coin_type object: not present`);
        }
        
        // Log extracted coin type used for comparison
        const extractedType = getCoinTypeFromReserveEntry(reserve);
        logger.info(`  - extracted coin type: ${extractedType || 'could not extract'}`);
      }
      
      // Collect all extracted coin types for failure reporting
      const allExtractedTypes: (string | undefined)[] = [];
      
      for (let index = 0; index < reserves.length; index++) {
        const reserve = reserves[index];
        const reserveFields = reserve.fields || reserve;
        
        // Use helper function for robust coin type extraction
        const reserveCoinType = getCoinTypeFromReserveEntry(reserve);
        allExtractedTypes.push(reserveCoinType);
        
        if (reserveCoinType === targetCoinType) {
          // Extract config fields - fee is at config.fields.borrow_fee (bps)
          const reserveConfig = reserveFields?.config?.fields || reserveFields?.config;
          const borrowFee = reserveConfig?.borrow_fee 
            || reserveConfig?.borrow_fee_bps 
            || reserveConfig?.fee_bps 
            || '5';
          const feeBps = Number(borrowFee);
          
          const availableAmount = BigInt(reserveFields?.available_amount || '0');
          
          // Log discovery
          const isSui = targetCoinType === COIN_TYPES.SUI;
          const humanAmount = isSui 
            ? smallestUnitToSui(availableAmount) 
            : smallestUnitToUsdc(availableAmount);
          const unit = isSui ? 'SUI' : 'USDC';
          
          // Calculate sample repay for logging (1000 units as sample)
          const samplePrincipal = isSui ? BigInt(1000000000000) : BigInt(1000000000); // 1000 SUI (9 decimals) or 1000 USDC (6 decimals)
          const sampleRepay = computeRepayAmountBase(samplePrincipal, BigInt(feeBps));
          const toHuman = (amt: bigint) => isSui ? smallestUnitToSui(amt) : smallestUnitToUsdc(amt);

          logger.info(`✓ Found Suilend reserve for ${targetCoinType}`);
          logger.info(`  Reserve index: ${index}`);
          logger.info(`  Extracted coin type: ${reserveCoinType}`);
          logger.info(`  Fee (borrow_fee): ${feeBps} bps (${feeBps / 100}%)`);
          logger.info(`  Available: ${humanAmount.toFixed(2)} ${unit}`);
          logger.info(`  Sample repay (for 1000 ${unit} principal): ${toHuman(sampleRepay).toFixed(6)} ${unit}`);

          return {
            reserveKey: String(index),
            feeBps,
            availableAmount,
            coinType: targetCoinType,
            // Backward-compatible aliases
            reserveIndex: index,
            borrowFeeBps: feeBps,
          };
        }
      }
      
      // Not found in vector - log all extracted coin types for diagnosis
      const validTypes = allExtractedTypes.filter(t => t !== undefined) as string[];
      const typesList = validTypes.length > 0 
        ? validTypes.join(', ') 
        : 'no valid coin types extracted';
      
      const errorMsg = `Could not find reserve for coin type ${targetCoinType} in Suilend reserves vector (searched ${reserves.length} reserves)`;
      logger.error(errorMsg);
      logger.error(`Extracted coin types from all reserves: ${typesList}`);
      
      if (config.dryRun) {
        logger.warn('Using default reserve config for simulation purposes.');
        
        return {
          reserveKey: '0',
          feeBps: 5,
          availableAmount: BigInt('1000000000000000'),
          coinType: targetCoinType,
          reserveIndex: 0,
          borrowFeeBps: 5,
        };
      } else {
        throw new Error(`${errorMsg}. Verify SUILEND_LENDING_MARKET and reserve configuration.`);
      }
    }
    
    // Step 3: Fallback to Bag/Table-based discovery (for non-vector environments)
    logger.info('[Suilend] Vector path not available, attempting Bag/Table fallback...');
    
    // Support multiple container names: reserves, reserves_bag, reservesBag
    const reservesBag = content.fields?.reserves 
      || content.fields?.reserves_bag 
      || content.fields?.reservesBag;
    
    if (!reservesBag || Array.isArray(reservesBag)) {
      // Already handled array case above, so this means no Bag either
      const errorMsg = 'Cannot find reserves container in lending market (neither vector nor Bag)';
      logger.debug('[Suilend] DEBUG: content.fields structure:');
      logger.debug(JSON.stringify(content.fields, null, 2));
      
      if (config.dryRun) {
        logger.warn(errorMsg);
        logger.warn('Using default reserve config for simulation purposes.');
        
        return {
          reserveKey: '0',
          feeBps: 5,
          availableAmount: BigInt('1000000000000000'),
          coinType: targetCoinType,
          reserveIndex: 0,
          borrowFeeBps: 5,
        };
      } else {
        throw new Error(errorMsg);
      }
    }
    
    // Extract bagId defensively from multiple possible patterns
    let bagId: string | undefined;
    if (reservesBag.fields?.id?.id) {
      bagId = reservesBag.fields.id.id;
    } else if (reservesBag.fields?.id?.value) {
      bagId = reservesBag.fields.id.value;
    } else if (reservesBag.fields?.id) {
      bagId = reservesBag.fields.id;
    }
    
    if (!bagId || typeof bagId !== 'string') {
      logger.debug('[Suilend] DEBUG: reservesBag.fields structure:');
      logger.debug(JSON.stringify(reservesBag.fields, null, 2));
      
      if (config.dryRun) {
        logger.warn('Cannot extract Bag ID from reserves field, using defaults for simulation');
        return {
          reserveKey: '0',
          feeBps: 5,
          availableAmount: BigInt('1000000000000000'),
          coinType: targetCoinType,
          reserveIndex: 0,
          borrowFeeBps: 5,
        };
      } else {
        throw new Error('Cannot extract Bag ID from lending market reserves field: ID not found in expected locations');
      }
    }
    
    logger.info(`[Suilend] Using Bag/Table fallback - Reserves Bag ID: ${bagId}`);

    // Step 4: Paginate through dynamic fields (Bag fallback)
    let hasNextPage = true;
    let cursor: string | null = null;
    let pageCount = 0;
    let totalFields = 0;

    while (hasNextPage && pageCount < maxPages) {
      const dynamicFields = await client.getDynamicFields({
        parentId: bagId,
        cursor,
        limit: 50,
      });

      totalFields += dynamicFields.data.length;
      logger.debug(`[Bag fallback] Page ${pageCount + 1}: Found ${dynamicFields.data.length} dynamic fields`);

      // Step 5: Match reserve by coin type (Bag fallback)
      for (const field of dynamicFields.data) {
        const fieldName = field.name;
        const reserveKey = typeof fieldName === 'object' && 'value' in fieldName 
          ? String(fieldName.value) 
          : String(fieldName);

        // Fetch the dynamic field object to inspect coin_type
        const fieldObject = await client.getDynamicFieldObject({
          parentId: bagId,
          name: field.name,
        });

        if (!fieldObject.data || !fieldObject.data.content) {
          logger.debug(`Skipping field ${reserveKey}: no content`);
          continue;
        }

        const fieldContent = fieldObject.data.content as any;
        if (fieldContent.dataType !== 'moveObject') {
          logger.debug(`Skipping field ${reserveKey}: not a moveObject`);
          continue;
        }

        // Check if this reserve matches the target coin type
        const reserveFields = fieldContent.fields?.value?.fields || fieldContent.fields;
        const reserveCoinType = getCoinTypeFromReserveEntry({ fields: reserveFields, type: fieldContent.type });

        if (reserveCoinType === targetCoinType) {
          // Extract config fields
          const reserveConfig = reserveFields?.config?.fields || reserveFields?.config;
          const borrowFee = reserveConfig?.borrow_fee 
            || reserveConfig?.borrow_fee_bps 
            || reserveConfig?.fee_bps 
            || '5';
          const feeBps = Number(borrowFee);
          
          const availableAmount = BigInt(reserveFields?.available_amount || '0');
          
          // Parse reserveIndex from reserveKey if numeric
          const parsedIndex = parseInt(reserveKey, 10);
          const reserveIndex = isNaN(parsedIndex) ? undefined : parsedIndex;

          // Log discovery
          const isSui = targetCoinType === COIN_TYPES.SUI;
          const humanAmount = isSui 
            ? smallestUnitToSui(availableAmount) 
            : smallestUnitToUsdc(availableAmount);
          const unit = isSui ? 'SUI' : 'USDC';

          logger.info(`✓ Found Suilend reserve for ${targetCoinType} (Bag fallback)`);
          logger.info(`  Reserve key: ${reserveKey}`);
          logger.info(`  Fee: ${feeBps} bps (${feeBps / 100}%)`);
          logger.info(`  Available: ${humanAmount.toFixed(2)} ${unit}`);
          if (reserveIndex !== undefined) {
            logger.info(`  Reserve index (parsed): ${reserveIndex}`);
          }

          return {
            reserveKey,
            feeBps,
            availableAmount,
            coinType: targetCoinType,
            // Backward-compatible aliases
            reserveIndex,
            borrowFeeBps: feeBps,
          };
        }
      }

      hasNextPage = dynamicFields.hasNextPage;
      cursor = dynamicFields.nextCursor || null;
      pageCount++;
    }

    logger.info(`[Bag fallback] Searched ${totalFields} dynamic fields across ${pageCount} pages`);

    // Not found - handle based on mode
    const errorMsg = `Could not find reserve for coin type ${targetCoinType} in Suilend lending market Bag ${bagId}`;
    
    if (config.dryRun) {
      logger.warn(errorMsg);
      logger.warn('Using default reserve config for simulation purposes.');
      
      return {
        reserveKey: '0',
        feeBps: 5,
        availableAmount: BigInt('1000000000000000'),
        coinType: targetCoinType,
        reserveIndex: 0,
        borrowFeeBps: 5,
      };
    } else {
      logger.error(errorMsg);
      throw new Error(`${errorMsg}. Verify SUILEND_LENDING_MARKET and reserve configuration.`);
    }
  } catch (error: any) {
    // For unexpected errors (network, parsing, etc.)
    logger.error('Failed to read Suilend reserve config', error);
    
    if (config.dryRun) {
      logger.warn('Network or parsing error while reading Suilend reserve.');
      logger.warn('Using default reserve config for simulation purposes.');
      
      return {
        reserveKey: '0',
        feeBps: 5,
        availableAmount: BigInt('1000000000000000'),
        coinType: targetCoinType,
        reserveIndex: 0,
        borrowFeeBps: 5,
      };
    } else {
      logger.error('Cannot read Suilend reserve configuration in live mode.');
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
  return config.reserveIndex || 0;
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
  reserveConfig?: ReserveConfig | SuilendReserveConfig
): Promise<{ borrowedCoins: any; receipt: any; reserveConfig: ReserveConfig }> {
  try {
    // Read reserve config if not provided
    const rawConfig = reserveConfig || await readSuilendReserveConfig(coinType);
    
    // Normalize to ReserveConfig
    const finalConfig: ReserveConfig = 'reserveKey' in rawConfig 
      ? rawConfig 
      : {
          reserveKey: String(rawConfig.reserveIndex),
          feeBps: Number(rawConfig.borrowFeeBps),
          availableAmount: rawConfig.availableAmount,
          coinType: rawConfig.coinType,
          reserveIndex: rawConfig.reserveIndex,
          borrowFeeBps: Number(rawConfig.borrowFeeBps),
        };

    // Enforce capacity limit: principal <= available_amount - SAFETY_BUFFER
    const safetyBuffer = BigInt(config.suilendSafetyBuffer);
    assertBorrowWithinCap(amount, finalConfig.availableAmount, safetyBuffer, coinType);
    
    // Helper for unit conversion
    const isSui = coinType === COIN_TYPES.SUI;
    const unit = isSui ? 'SUI' : 'USDC';
    const toHuman = (amt: bigint) => isSui ? smallestUnitToSui(amt) : smallestUnitToUsdc(amt);
    
    // Compute repay with ceiling division: repay = principal + ceil(principal * fee_bps / 10_000)
    const feeBpsBigInt = BigInt(finalConfig.feeBps);
    const repayAmount = computeRepayAmountBase(amount, feeBpsBigInt);
    
    // Log detailed borrow info
    logger.info(`Borrowing from Suilend`);
    logger.info(`  Reserve key: ${finalConfig.reserveKey}`);
    if (finalConfig.reserveIndex !== undefined) {
      logger.info(`  Reserve index: ${finalConfig.reserveIndex}`);
    }
    logger.info(`  Fee: ${finalConfig.feeBps} bps (${finalConfig.feeBps / 100}%)`);
    logger.info(`  Principal: ${toHuman(amount).toFixed(6)} ${unit}`);
    logger.info(`  Repay amount: ${toHuman(repayAmount).toFixed(6)} ${unit}`);

    // Suilend flashloan entrypoint per Perplexity spec:
    // lending::flash_borrow(lending_market, reserve_index, amount) -> (Coin<T>, FlashLoanReceipt)
    const reserveIndexArg = finalConfig.reserveIndex !== undefined 
      ? finalConfig.reserveIndex 
      : parseInt(finalConfig.reserveKey, 10) || 0;
      
    const [borrowedCoins, receipt] = tx.moveCall({
      target: `${SUILEND.packageId}::lending::flash_borrow`,
      arguments: [
        tx.object(SUILEND.lendingMarket),
        tx.pure.u64(reserveIndexArg.toString()),
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
  feeBps?: number;
  reserveConfig?: ReserveConfig;
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
      const feeBps = result.reserveConfig.borrowFeeBps ?? result.reserveConfig.feeBps;
      return {
        ...result,
        provider: 'suilend',
        feeBps,
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
 * Exported for backward compatibility with simulate/executor
 * Uses ceiling division to ensure we repay enough
 * @param principalBase Amount borrowed in base units
 * @param feeBps Fee in basis points (e.g., 5 for 0.05%)
 * @returns Total amount to repay (principal + fee, rounded up)
 */
export function calculateRepayAmountFromBps(principalBase: bigint, feeBps: number): bigint {
  return computeRepayAmountBase(principalBase, BigInt(feeBps));
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
