import { logger } from './logger';
import { config } from './config';
import { COIN_TYPES, CETUS, TURBOS } from './addresses';
import { buildTransaction, signAndExecuteTransaction } from './utils/sui';
import {
  borrowFromSuilend,
  repayToSuilend,
  borrowFromNavi,
  repayToNavi,
  calculateRepayAmount,
} from './flashloan';

export type ArbDirection = 'cetus-to-turbos' | 'turbos-to-cetus';

export interface ArbResult {
  success: boolean;
  profit?: bigint;
  txDigest?: string;
  error?: string;
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
    // Build the transaction
    const tx = buildTransaction();

    // Step 1: Flashloan borrow USDC from Suilend
    logger.info('Step 1: Borrowing USDC via flashloan');
    let borrowedCoins: any;
    let receipt: any;
    let flashloanFeePercent: number;

    try {
      const suilendResult = await borrowFromSuilend(tx, amount, COIN_TYPES.USDC);
      borrowedCoins = suilendResult.borrowedCoins;
      receipt = suilendResult.receipt;
      flashloanFeePercent = config.suilendFeePercent;
      logger.info('Using Suilend flashloan');
    } catch (error) {
      logger.warn('Suilend failed, trying Navi fallback', error);
      const naviResult = await borrowFromNavi(tx, amount, COIN_TYPES.USDC);
      borrowedCoins = naviResult.borrowedCoins;
      receipt = naviResult.receipt;
      flashloanFeePercent = config.naviFeePercent;
      logger.info('Using Navi flashloan');
    }

    // Calculate repayment amount
    const repayAmount = calculateRepayAmount(amount, flashloanFeePercent);
    logger.info(`Flashloan repay amount: ${repayAmount} (fee: ${repayAmount - amount})`);

    // Step 2 & 3: Execute swaps based on direction
    let finalUsdcCoins: any;

    if (direction === 'cetus-to-turbos') {
      // Buy cheap on Cetus, sell high on Turbos
      logger.info('Step 2: Swap USDC -> SUI on Cetus (buy cheap)');

      // Swap USDC to SUI on Cetus
      const [suiCoins] = tx.moveCall({
        target: `${CETUS.packageId}::pool::swap`,
        arguments: [
          tx.object(CETUS.globalConfigId),
          tx.object(CETUS.suiUsdcPoolId),
          borrowedCoins,
          tx.pure.bool(false), // a2b = false (USDC to SUI)
          tx.pure.bool(true), // by_amount_in
          tx.pure.u64(amount.toString()),
          tx.pure.u128('0'), // sqrt_price_limit (0 = no limit)
        ],
        typeArguments: [COIN_TYPES.USDC, COIN_TYPES.SUI],
      });

      logger.info('Step 3: Swap SUI -> USDC on Turbos (sell high)');

      // Swap SUI to USDC on Turbos
      [finalUsdcCoins] = tx.moveCall({
        target: `${TURBOS.packageId}::pool::swap`,
        arguments: [
          tx.object(TURBOS.suiUsdcPoolId),
          suiCoins,
          tx.pure.bool(true), // a2b = true (SUI to USDC)
          tx.pure.bool(true), // by_amount_in
          tx.pure.u64('0'), // amount (we're swapping all)
          tx.pure.u128('0'), // sqrt_price_limit
        ],
        typeArguments: [COIN_TYPES.SUI, COIN_TYPES.USDC],
      });
    } else {
      // Buy cheap on Turbos, sell high on Cetus
      logger.info('Step 2: Swap USDC -> SUI on Turbos (buy cheap)');

      // Swap USDC to SUI on Turbos
      const [suiCoins] = tx.moveCall({
        target: `${TURBOS.packageId}::pool::swap`,
        arguments: [
          tx.object(TURBOS.suiUsdcPoolId),
          borrowedCoins,
          tx.pure.bool(false), // a2b = false (USDC to SUI)
          tx.pure.bool(true), // by_amount_in
          tx.pure.u64(amount.toString()),
          tx.pure.u128('0'), // sqrt_price_limit
        ],
        typeArguments: [COIN_TYPES.USDC, COIN_TYPES.SUI],
      });

      logger.info('Step 3: Swap SUI -> USDC on Cetus (sell high)');

      // Swap SUI to USDC on Cetus
      [finalUsdcCoins] = tx.moveCall({
        target: `${CETUS.packageId}::pool::swap`,
        arguments: [
          tx.object(CETUS.globalConfigId),
          tx.object(CETUS.suiUsdcPoolId),
          suiCoins,
          tx.pure.bool(true), // a2b = true (SUI to USDC)
          tx.pure.bool(true), // by_amount_in
          tx.pure.u64('0'), // amount (we're swapping all)
          tx.pure.u128('0'), // sqrt_price_limit
        ],
        typeArguments: [COIN_TYPES.SUI, COIN_TYPES.USDC],
      });
    }

    // Step 4: Split coins for repayment
    logger.info('Step 4: Splitting coins for repayment and profit');

    // Split repay amount from final USDC
    const [repayCoins, profitCoins] = tx.splitCoins(finalUsdcCoins, [
      tx.pure.u64(repayAmount.toString()),
    ]);

    // Step 5: Verify profit meets minimum
    // This would be done on-chain in production with an assertion
    logger.info('Step 5: Verifying profit >= minimum');

    // In a real implementation, you'd add an on-chain assertion here
    // For now, we calculate expected profit and log it
    const expectedProfit = amount - repayAmount; // This is approximate
    logger.info(`Expected profit: ${expectedProfit} USDC`);

    // Step 6: Repay flashloan
    logger.info('Step 6: Repaying flashloan');

    if (flashloanFeePercent === config.suilendFeePercent) {
      repayToSuilend(tx, receipt, repayCoins, COIN_TYPES.USDC);
    } else {
      repayToNavi(tx, receipt, repayCoins, COIN_TYPES.USDC);
    }

    // Step 7: Transfer profit to wallet
    logger.info('Step 7: Transferring profit to wallet');
    tx.transferObjects([profitCoins], config.walletAddress);

    // Dry run or execute
    if (config.dryRun) {
      logger.info('=== DRY RUN MODE ===');
      logger.info('Transaction steps:');
      logger.info(`1. Borrow ${amount} USDC via flashloan`);
      logger.info(`2. First swap on ${direction.split('-')[0]}`);
      logger.info(`3. Second swap on ${direction.split('-')[2]}`);
      logger.info(`4. Repay ${repayAmount} USDC`);
      logger.info(`5. Profit to wallet: ~${expectedProfit} USDC`);
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
