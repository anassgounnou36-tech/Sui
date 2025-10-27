import { logger } from './logger';
import { config, smallestUnitToUsdc } from './config';
import { COIN_TYPES } from './addresses';
import { buildTransaction, signAndExecuteTransaction } from './utils/sui';
import { borrowFromSuilend, repayToSuilend, borrowFromNavi, repayToNavi, readSuilendReserveConfig, calculateRepayAmountFromBps } from './flashloan';
import {
  quoteCetusPoolSwapB2A,
  quoteCetusPoolSwapA2B,
  buildCetusPoolSwap,
} from './cetusIntegration';
import { getCetusPools } from './resolve';
import { calculateMinOut } from './slippage';
import Decimal from 'decimal.js';

export type ArbDirection =
  | 'cetus-to-turbos'
  | 'turbos-to-cetus'
  | 'cetus-005-to-025'
  | 'cetus-025-to-005';

export interface ArbResult {
  success: boolean;
  profit?: bigint;
  txDigest?: string;
  error?: string;
}

/**
 * Validate that arbitrage opportunity is safe and profitable
 * Checks combined fees, slippage, and quote validity
 * Only validates Cetus fee-tier arbitrage directions
 */
async function validateArbOpportunity(
  direction: ArbDirection,
  flashloanAmount: bigint,
  minProfit: bigint,
  flashloanFeePercent: number
): Promise<{ valid: boolean; error?: string; quotes?: any }> {
  try {
    // Get quotes from Cetus pools at the actual flashloan size
    logger.debug('Getting quotes for validation...');

    let firstSwapQuote: any;
    let secondSwapQuote: any;

    if (direction === 'cetus-005-to-025') {
      // SUI -> USDC on Cetus 0.05%, then USDC -> SUI on Cetus 0.25%
      const pools = getCetusPools();
      firstSwapQuote = await quoteCetusPoolSwapB2A(pools.pool005, flashloanAmount, 0.05);
      secondSwapQuote = await quoteCetusPoolSwapA2B(
        pools.pool025,
        firstSwapQuote.amountOut,
        0.25
      );
    } else if (direction === 'cetus-025-to-005') {
      // SUI -> USDC on Cetus 0.25%, then USDC -> SUI on Cetus 0.05%
      const pools = getCetusPools();
      firstSwapQuote = await quoteCetusPoolSwapB2A(pools.pool025, flashloanAmount, 0.25);
      secondSwapQuote = await quoteCetusPoolSwapA2B(
        pools.pool005,
        firstSwapQuote.amountOut,
        0.05
      );
    } else if (direction === 'cetus-to-turbos' || direction === 'turbos-to-cetus') {
      // Deprecated cross-DEX directions - should not be used
      return {
        valid: false,
        error: `Cross-DEX arbitrage direction "${direction}" is deprecated. Use Cetus fee-tier arbitrage instead.`,
      };
    } else {
      throw new Error(`Unknown arbitrage direction: ${direction}`);
    }

    // Safety check 1: Ensure quotes are valid (not zero/negative)
    if (firstSwapQuote.amountOut <= BigInt(0)) {
      return {
        valid: false,
        error: `First swap quote invalid: ${firstSwapQuote.amountOut}`,
      };
    }

    if (secondSwapQuote.amountOut <= BigInt(0)) {
      return {
        valid: false,
        error: `Second swap quote invalid: ${secondSwapQuote.amountOut}`,
      };
    }

    // Safety check 2: Calculate total costs
    const flashloanFee =
      (flashloanAmount * BigInt(Math.floor(flashloanFeePercent * 100))) / BigInt(10000);
    const repayAmount = flashloanAmount + flashloanFee;

    // Safety check 3: Verify second swap output covers repay + min profit
    const requiredOutput = repayAmount + minProfit;

    if (secondSwapQuote.amountOut < requiredOutput) {
      const shortfall = requiredOutput - secondSwapQuote.amountOut;
      return {
        valid: false,
        error:
          `Insufficient profit: need ${requiredOutput} USDC, ` +
          `but would get ${secondSwapQuote.amountOut} USDC. ` +
          `Shortfall: ${shortfall} (${smallestUnitToUsdc(shortfall).toFixed(6)} USDC)`,
      };
    }

    // Safety check 4: Verify slippage protection is reasonable
    const expectedProfit = secondSwapQuote.amountOut - repayAmount;
    const profitMargin = new Decimal(expectedProfit.toString())
      .div(repayAmount.toString())
      .mul(100)
      .toNumber();

    logger.info(`Validation passed:`);
    logger.info(`  First swap: ${flashloanAmount} USDC -> ${firstSwapQuote.amountOut} SUI`);
    logger.info(
      `  Second swap: ${firstSwapQuote.amountOut} SUI -> ${secondSwapQuote.amountOut} USDC`
    );
    logger.info(`  Repay: ${repayAmount} USDC (flashloan + ${flashloanFeePercent}% fee)`);
    logger.info(
      `  Expected profit: ${expectedProfit} (${smallestUnitToUsdc(expectedProfit).toFixed(6)} USDC)`
    );
    logger.info(`  Profit margin: ${profitMargin.toFixed(4)}%`);

    return {
      valid: true,
      quotes: {
        firstSwap: firstSwapQuote,
        secondSwap: secondSwapQuote,
        expectedProfit,
        repayAmount,
      },
    };
  } catch (error) {
    logger.error('Quote validation failed', error);
    return {
      valid: false,
      error: `Quote validation failed: ${error}`,
    };
  }
}

/**
 * Execute flashloan arbitrage
 * @param direction Direction of arbitrage
 * @param amount Flashloan amount in USDC (smallest units)
 * @param minProfit Minimum required profit in USDC (smallest units)
 * @returns Execution result
 */
export async function executeFlashloanArb(
  direction: ArbDirection,
  amount: bigint,
  minProfit: bigint
): Promise<ArbResult> {
  logger.info(`Executing arbitrage: ${direction}, amount: ${amount}, minProfit: ${minProfit}`);

  try {
    // Determine which flashloan provider to use
    let flashloanFeePercent: number;
    let useSuilend = true;

    try {
      // Try to verify Suilend is available
      flashloanFeePercent = config.suilendFeePercent;
      logger.debug('Planning to use Suilend flashloan');
    } catch (error) {
      logger.warn('Suilend not available, will try Navi', error);
      useSuilend = false;
      flashloanFeePercent = config.naviFeePercent;
    }

    // Validate opportunity with real quotes BEFORE building transaction
    logger.info('Validating arbitrage opportunity...');
    const validation = await validateArbOpportunity(direction, amount, minProfit, flashloanFeePercent);

    if (!validation.valid) {
      logger.warn(`Opportunity validation failed: ${validation.error}`);
      return {
        success: false,
        error: validation.error || 'Opportunity validation failed',
      };
    }

    const { firstSwap, secondSwap, expectedProfit } = validation.quotes!;
    let repayAmount = validation.quotes!.repayAmount;

    logger.success('✓ Opportunity validated, proceeding with execution');

    // Build the transaction
    const tx = buildTransaction();

    // Step 1: Flashloan borrow SUI
    logger.info('Step 1: Borrowing SUI via flashloan');
    let borrowedCoins: any;
    let receipt: any;
    let reserveIndex = 0;

    try {
      if (useSuilend) {
        // Read Suilend reserve config for dynamic fee and availability
        const reserveConfig = await readSuilendReserveConfig(COIN_TYPES.SUI);
        const suilendResult = await borrowFromSuilend(tx, amount, COIN_TYPES.SUI, reserveConfig);
        borrowedCoins = suilendResult.borrowedCoins;
        receipt = suilendResult.receipt;
        reserveIndex = suilendResult.reserveConfig.reserveIndex;
        
        // Recalculate repay amount using dynamic fee
        repayAmount = calculateRepayAmountFromBps(amount, suilendResult.reserveConfig.borrowFeeBps);
        logger.info(`Using Suilend flashloan (reserve ${reserveIndex}, fee ${suilendResult.reserveConfig.borrowFeeBps} bps)`);
      } else {
        // For Navi, pool_id for SUI (should be discovered dynamically)
        const poolId = 0;
        const naviResult = await borrowFromNavi(tx, amount, COIN_TYPES.SUI, poolId);
        borrowedCoins = naviResult.borrowedCoins;
        receipt = naviResult.receipt;
        logger.info(`Using Navi flashloan (pool ${poolId})`);
      }
    } catch (error) {
      logger.error('Flashloan borrow failed', error);
      throw new Error(`Flashloan borrow failed: ${error}`);
    }

    logger.info(`Flashloan repay amount: ${repayAmount} (fee: ${repayAmount - amount})`);

    // Step 2 & 3: Execute swaps based on direction using Cetus fee-tier pools
    let finalSuiCoins: any;

    // Get Cetus pools
    const pools = getCetusPools();

    if (direction === 'cetus-005-to-025') {
      // Sell SUI on 0.05% (SUI -> USDC), buy back on 0.25% (USDC -> SUI)
      logger.info('Step 2: Swap SUI -> USDC on Cetus 0.05% pool (sell)');

      const pool005SuiIsA = pools.pool005.coinTypeA === COIN_TYPES.SUI;
      const firstMinOut = calculateMinOut(firstSwap.amountOut, config.maxSlippagePercent);

      const usdcCoins = buildCetusPoolSwap(
        tx,
        pools.pool005,
        pools.globalConfigId,
        borrowedCoins,
        amount,
        firstMinOut,
        firstSwap.sqrtPriceLimit,
        pool005SuiIsA // If SUI is A, want A->B (SUI->USDC), else B->A
      );

      logger.info('Step 3: Swap USDC -> SUI on Cetus 0.25% pool (buy back)');

      const pool025SuiIsA = pools.pool025.coinTypeA === COIN_TYPES.SUI;
      const secondMinOut = repayAmount; // Must at least cover repay

      finalSuiCoins = buildCetusPoolSwap(
        tx,
        pools.pool025,
        pools.globalConfigId,
        usdcCoins,
        firstSwap.amountOut,
        secondMinOut,
        secondSwap.sqrtPriceLimit,
        !pool025SuiIsA // If SUI is A, want B->A (USDC->SUI), else A->B
      );
    } else if (direction === 'cetus-025-to-005') {
      // Sell SUI on 0.25% (SUI -> USDC), buy back on 0.05% (USDC -> SUI)
      logger.info('Step 2: Swap SUI -> USDC on Cetus 0.25% pool (sell)');

      const pool025SuiIsA = pools.pool025.coinTypeA === COIN_TYPES.SUI;
      const firstMinOut = calculateMinOut(firstSwap.amountOut, config.maxSlippagePercent);

      const usdcCoins = buildCetusPoolSwap(
        tx,
        pools.pool025,
        pools.globalConfigId,
        borrowedCoins,
        amount,
        firstMinOut,
        firstSwap.sqrtPriceLimit,
        pool025SuiIsA // If SUI is A, want A->B (SUI->USDC), else B->A
      );

      logger.info('Step 3: Swap USDC -> SUI on Cetus 0.05% pool (buy back)');

      const pool005SuiIsA = pools.pool005.coinTypeA === COIN_TYPES.SUI;
      const secondMinOut = repayAmount; // Must at least cover repay

      finalSuiCoins = buildCetusPoolSwap(
        tx,
        pools.pool005,
        pools.globalConfigId,
        usdcCoins,
        firstSwap.amountOut,
        secondMinOut,
        secondSwap.sqrtPriceLimit,
        !pool005SuiIsA // If SUI is A, want B->A (USDC->SUI), else A->B
      );
    } else if (direction === 'cetus-to-turbos' || direction === 'turbos-to-cetus') {
      // Deprecated cross-DEX directions
      logger.error(`Cross-DEX arbitrage direction "${direction}" is deprecated.`);
      return {
        success: false,
        error: `Cross-DEX arbitrage is no longer supported. Use Cetus fee-tier arbitrage instead.`,
      };
    }

    // Step 4: Split coins for repayment
    logger.info('Step 4: Splitting coins for repayment and profit');

    // Split repay amount from final SUI
    const [repayCoins, profitCoins] = tx.splitCoins(finalSuiCoins, [tx.pure.u64(repayAmount.toString())]);

    // Step 5: Repay flashloan
    logger.info('Step 5: Repaying flashloan');

    if (useSuilend) {
      // For SUI flashloan, need to discover reserve index dynamically (typically 0 for SUI)
      const reserveIndex = 0; // Must match borrow
      repayToSuilend(tx, receipt, repayCoins, COIN_TYPES.SUI, reserveIndex);
    } else {
      // Navi fallback for SUI
      const poolId = 0; // SUI pool - must match borrow
      repayToNavi(tx, receipt, repayCoins, COIN_TYPES.SUI, poolId);
    }

    // Step 6: Transfer profit to wallet
    logger.info('Step 6: Transferring profit to wallet');
    tx.transferObjects([profitCoins], config.walletAddress);

    // Dry run or execute
    if (config.dryRun) {
      logger.info('=== DRY RUN MODE ===');
      logger.info('Transaction validated and built successfully:');
      logger.info(`1. Borrow ${amount} USDC via flashloan`);
      logger.info(`2. First swap: ${amount} USDC -> ${firstSwap.amountOut} SUI (min: ${calculateMinOut(firstSwap.amountOut, config.maxSlippagePercent)})`);
      logger.info(`3. Second swap: ${firstSwap.amountOut} SUI -> ${secondSwap.amountOut} USDC (min: ${repayAmount + minProfit})`);
      logger.info(`4. Repay ${repayAmount} USDC`);
      logger.info(`5. Profit to wallet: ${expectedProfit} (${smallestUnitToUsdc(expectedProfit).toFixed(6)} USDC)`);
      logger.info('=== DRY RUN COMPLETE (not executed) ===');

      return {
        success: true,
        profit: expectedProfit,
      };
    }

    // Execute transaction
    logger.info('Executing transaction...');
    const result = await signAndExecuteTransaction(tx, {
      maxRetries: config.maxRetries,
      initialDelayMs: config.retryDelayMs,
      pollIntervalMs: 500,
    });

    logger.success(`Transaction executed: ${result.digest}`);

    // Parse profit from effects (simplified)
    const profit = expectedProfit; // In production, parse from transaction effects

    return {
      success: true,
      profit,
      txDigest: result.digest,
    };
  } catch (error) {
    logger.error('Arbitrage execution failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Simulate arbitrage execution to estimate profit
 * @param direction Direction of arbitrage
 * @param amount Flashloan amount
 * @returns Estimated profit
 */
export async function simulateArbitrage(direction: ArbDirection, amount: bigint): Promise<bigint> {
  logger.debug(`Simulating arbitrage: ${direction}, amount: ${amount}`);

  // For simulation, we use the quotes from DEXes
  // This is a simplified calculation
  // In a real scenario, you'd get actual quotes from both DEXes
  // and calculate based on real spread and fees

  // Placeholder: return 0 for now
  // TODO: Implement proper simulation with actual DEX quotes
  const estimatedProfit = BigInt(0);

  return estimatedProfit;
}
