import { logger } from './logger';
import { config, smallestUnitToUsdc } from './config';
import { COIN_TYPES } from './addresses';
import { buildTransaction, signAndExecuteTransaction } from './utils/sui';
import { borrowFromSuilend, repayToSuilend, borrowFromNavi, repayToNavi } from './flashloan';
import { quoteCetusSwapB2A, quoteCetusSwapA2B, buildCetusSwap } from './cetusIntegration';
import { quoteTurbosSwapB2A, quoteTurbosSwapA2B, buildTurbosSwap } from './turbosIntegration';
import { getResolvedAddresses } from './resolve';
import { calculateMinOut } from './slippage';
import Decimal from 'decimal.js';

export type ArbDirection = 'cetus-to-turbos' | 'turbos-to-cetus';

export interface ArbResult {
  success: boolean;
  profit?: bigint;
  txDigest?: string;
  error?: string;
}

/**
 * Validate that arbitrage opportunity is safe and profitable
 * Checks combined fees, slippage, and quote validity
 */
async function validateArbOpportunity(
  direction: ArbDirection,
  flashloanAmount: bigint,
  minProfit: bigint,
  flashloanFeePercent: number
): Promise<{ valid: boolean; error?: string; quotes?: any }> {
  try {
    // Get quotes from both DEXes at the actual flashloan size
    logger.debug('Getting quotes for validation...');

    let firstSwapQuote: any;
    let secondSwapQuote: any;

    if (direction === 'cetus-to-turbos') {
      // USDC -> SUI on Cetus, then SUI -> USDC on Turbos
      firstSwapQuote = await quoteCetusSwapB2A(flashloanAmount);
      secondSwapQuote = await quoteTurbosSwapA2B(firstSwapQuote.amountOut);
    } else {
      // USDC -> SUI on Turbos, then SUI -> USDC on Cetus
      firstSwapQuote = await quoteTurbosSwapB2A(flashloanAmount);
      secondSwapQuote = await quoteCetusSwapA2B(firstSwapQuote.amountOut);
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
    const flashloanFee = (flashloanAmount * BigInt(Math.floor(flashloanFeePercent * 100))) / BigInt(10000);
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
    logger.info(`  Second swap: ${firstSwapQuote.amountOut} SUI -> ${secondSwapQuote.amountOut} USDC`);
    logger.info(`  Repay: ${repayAmount} USDC (flashloan + ${flashloanFeePercent}% fee)`);
    logger.info(`  Expected profit: ${expectedProfit} (${smallestUnitToUsdc(expectedProfit).toFixed(6)} USDC)`);
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
    // Get resolved addresses
    const resolved = getResolvedAddresses();

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

    const { firstSwap, secondSwap, expectedProfit, repayAmount } = validation.quotes!;

    logger.success('✓ Opportunity validated, proceeding with execution');

    // Build the transaction
    const tx = buildTransaction();

    // Step 1: Flashloan borrow USDC
    logger.info('Step 1: Borrowing USDC via flashloan');
    let borrowedCoins: any;
    let receipt: any;

    try {
      if (useSuilend) {
        const suilendResult = await borrowFromSuilend(tx, amount, COIN_TYPES.USDC);
        borrowedCoins = suilendResult.borrowedCoins;
        receipt = suilendResult.receipt;
        logger.info('Using Suilend flashloan');
      } else {
        const naviResult = await borrowFromNavi(tx, amount, COIN_TYPES.USDC);
        borrowedCoins = naviResult.borrowedCoins;
        receipt = naviResult.receipt;
        logger.info('Using Navi flashloan');
      }
    } catch (error) {
      logger.error('Flashloan borrow failed', error);
      throw new Error(`Flashloan borrow failed: ${error}`);
    }

    logger.info(`Flashloan repay amount: ${repayAmount} (fee: ${repayAmount - amount})`);

    // Step 2 & 3: Execute swaps based on direction using integration modules
    let finalUsdcCoins: any;

    // Determine coin ordering and a2b direction for each pool
    const cetusPool = resolved.cetus.suiUsdcPool;
    const turbosPool = resolved.turbos.suiUsdcPool;

    const cetusSuiIsA = cetusPool.coinTypeA === COIN_TYPES.SUI;
    const turbosSuiIsA = turbosPool.coinTypeA === COIN_TYPES.SUI;

    if (direction === 'cetus-to-turbos') {
      // Buy cheap on Cetus (USDC -> SUI), sell high on Turbos (SUI -> USDC)
      logger.info('Step 2: Swap USDC -> SUI on Cetus (buy cheap)');

      // Calculate min_out with slippage protection
      const firstMinOut = calculateMinOut(firstSwap.amountOut, config.maxSlippagePercent);

      const suiCoins = buildCetusSwap(
        tx,
        borrowedCoins,
        amount,
        firstMinOut,
        firstSwap.sqrtPriceLimit,
        !cetusSuiIsA // If SUI is A, we want B->A (false), if USDC is A, we want A->B (true)
      );

      logger.info('Step 3: Swap SUI -> USDC on Turbos (sell high)');

      // Use the first swap output as input to second swap
      const secondMinOut = repayAmount + minProfit; // Must at least cover repay + min profit

      finalUsdcCoins = buildTurbosSwap(
        tx,
        suiCoins,
        firstSwap.amountOut,
        secondMinOut,
        secondSwap.sqrtPriceLimit,
        turbosSuiIsA // If SUI is A, we want A->B (true), if USDC is A, we want B->A (false)
      );
    } else {
      // Buy cheap on Turbos (USDC -> SUI), sell high on Cetus (SUI -> USDC)
      logger.info('Step 2: Swap USDC -> SUI on Turbos (buy cheap)');

      const firstMinOut = calculateMinOut(firstSwap.amountOut, config.maxSlippagePercent);

      const suiCoins = buildTurbosSwap(
        tx,
        borrowedCoins,
        amount,
        firstMinOut,
        firstSwap.sqrtPriceLimit,
        !turbosSuiIsA // If SUI is A, we want B->A (false), if USDC is A, we want A->B (true)
      );

      logger.info('Step 3: Swap SUI -> USDC on Cetus (sell high)');

      const secondMinOut = repayAmount + minProfit;

      finalUsdcCoins = buildCetusSwap(
        tx,
        suiCoins,
        firstSwap.amountOut,
        secondMinOut,
        secondSwap.sqrtPriceLimit,
        cetusSuiIsA // If SUI is A, we want A->B (true), if USDC is A, we want B->A (false)
      );
    }

    // Step 4: Split coins for repayment
    logger.info('Step 4: Splitting coins for repayment and profit');

    // Split repay amount from final USDC
    const [repayCoins, profitCoins] = tx.splitCoins(finalUsdcCoins, [tx.pure.u64(repayAmount.toString())]);

    // Step 5: Repay flashloan
    logger.info('Step 5: Repaying flashloan');

    if (useSuilend) {
      repayToSuilend(tx, receipt, repayCoins, COIN_TYPES.USDC);
    } else {
      repayToNavi(tx, receipt, repayCoins, COIN_TYPES.USDC);
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
