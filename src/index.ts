import { config, validateConfig, smallestUnitToUsdc, smallestUnitToSui } from './config';
import { logger } from './logger';
import { initializeRpcClient, initializeKeypair, getAllBalances } from './utils/sui';
import { runStartupVerification } from './verify';
import { resolvePoolAddresses, getCetusPools } from './resolve';
import { getCetusPriceByPool } from './cetusIntegration';
import { executeFlashloanArb, ArbDirection } from './executor';
import { COIN_TYPES } from './addresses';
import { initializeTelegramNotifier, TelegramNotifier } from './notify/telegram';

// State tracking
let lastExecutionTime = 0;
let pendingTransactions = 0;
let consecutiveSpreadCount = 0;
let lastSpreadDirection: ArbDirection | null = null;
let totalProfitUsdc = 0;
let totalExecutions = 0;
let successfulExecutions = 0;
let consecutiveFailures = 0; // Kill switch counter
let telegramNotifier: TelegramNotifier;

/**
 * Calculate spread percentage between two prices
 */
function calculateSpread(price1: number, price2: number): number {
  return (Math.abs(price1 - price2) / Math.min(price1, price2)) * 100;
}

/**
 * Determine arbitrage direction based on prices (DEPRECATED for cross-DEX)
 */
/*
function determineArbDirection(cetusPrice: number, turbosPrice: number): ArbDirection | null {
  const spread = calculateSpread(cetusPrice, turbosPrice);

  if (spread < config.minSpreadPercent) {
    return null; // Spread too small
  }

  if (cetusPrice < turbosPrice) {
    // Buy on Cetus (cheaper), sell on Turbos (more expensive)
    return 'cetus-to-turbos';
  } else {
    // Buy on Turbos (cheaper), sell on Cetus (more expensive)
    return 'turbos-to-cetus';
  }
}
*/

/**
 * Determine fee-tier arbitrage direction based on prices from two Cetus pools
 */
function determineFeeTierArbDirection(
  price005: number,
  price025: number
): ArbDirection | null {
  const spread = calculateSpread(price005, price025);

  if (spread < config.minSpreadPercent) {
    return null; // Spread too small
  }

  if (price005 < price025) {
    // Buy on 0.05% (cheaper), sell on 0.25% (more expensive)
    return 'cetus-005-to-025';
  } else {
    // Buy on 0.25% (cheaper), sell on 0.05% (more expensive)
    return 'cetus-025-to-005';
  }
}

/**
 * Check if we can execute based on rate limits
 */
function canExecute(): boolean {
  const now = Date.now();
  const timeSinceLastExecution = now - lastExecutionTime;

  // Check time-based rate limit
  if (timeSinceLastExecution < config.txIntervalMs) {
    logger.debug(`Rate limited: ${config.txIntervalMs - timeSinceLastExecution}ms until next tx`);
    return false;
  }

  // Check pending transaction limit
  if (pendingTransactions >= config.maxPendingTx) {
    logger.warn(`Too many pending transactions: ${pendingTransactions}`);
    return false;
  }

  return true;
}

/**
 * Fee-tier monitoring loop for CETUS_FEE_TIER_ARB mode
 */
async function feeTierMonitoringLoop() {
  try {
    // Fetch prices from both Cetus fee-tier pools
    logger.debug('Fetching prices from Cetus 0.05% and 0.25% pools...');

    const pools = getCetusPools();
    const [price005, price025] = await Promise.all([
      getCetusPriceByPool(pools.pool005),
      getCetusPriceByPool(pools.pool025),
    ]);

    logger.info(
      `Cetus 0.05%: ${price005.toFixed(6)} USDC/SUI | Cetus 0.25%: ${price025.toFixed(6)} USDC/SUI`
    );

    // Calculate spread
    const spread = calculateSpread(price005, price025);
    logger.info(`Fee-tier spread: ${spread.toFixed(4)}% (min: ${config.minSpreadPercent}%)`);

    // Determine arbitrage direction
    const direction = determineFeeTierArbDirection(price005, price025);

    if (!direction) {
      logger.debug('No profitable fee-tier arbitrage opportunity');
      consecutiveSpreadCount = 0;
      lastSpreadDirection = null;
      return;
    }

    logger.info(`Potential fee-tier arbitrage direction: ${direction}`);

    // Check for consecutive spread confirmation
    if (lastSpreadDirection === direction) {
      consecutiveSpreadCount++;
      logger.info(`Consecutive spread count: ${consecutiveSpreadCount}`);
    } else {
      // Direction changed or first detection - notify about new opportunity
      consecutiveSpreadCount = 1;
      lastSpreadDirection = direction;
      
      try {
        await telegramNotifier.notifyOpportunity(
          price005,
          price025,
          spread,
          direction,
          pools.pool005.poolId,
          pools.pool025.poolId
        );
      } catch (error) {
        logger.error('Failed to send Telegram opportunity notification', error);
      }
    }

    // Require 2 consecutive ticks with same direction
    if (consecutiveSpreadCount < config.consecutiveSpreadRequired) {
      logger.info('Waiting for confirmation (need 2 consecutive ticks)');
      return;
    }

    // Check rate limits
    if (!canExecute()) {
      logger.debug('Rate limited, skipping execution');
      return;
    }

    // Execute arbitrage
    logger.info(`=== EXECUTING FEE-TIER ARBITRAGE: ${direction} ===`);
    const flashloanAmount = BigInt(config.flashloanAmount);
    const minProfitUsd = config.minProfitUsd;

    pendingTransactions++;
    lastExecutionTime = Date.now();
    totalExecutions++;

    const result = await executeFlashloanArb(
      direction,
      flashloanAmount,
      minProfitUsd,
      // Notification callback: called after validation passes, before PTB building
      async (dir, amount, minProf, expectedProfit, isDryRun) => {
        try {
          await telegramNotifier.notifyExecutionStart(dir, amount, minProf, expectedProfit, isDryRun);
        } catch (error) {
          logger.error('Failed to send Telegram execution start notification', error);
        }
      }
    );

    pendingTransactions--;

    if (result.success) {
      successfulExecutions++;
      consecutiveFailures = 0; // Reset on success
      const profitUsdc = result.profit ? smallestUnitToUsdc(result.profit) : 0;
      totalProfitUsdc += profitUsdc;

      logger.success(`✓ Fee-tier arbitrage successful!`);
      logger.success(`  Profit: ${profitUsdc.toFixed(6)} USDC`);
      if (result.txDigest) {
        logger.success(`  TX: ${result.txDigest}`);
      }
      logger.info(
        `Total P&L: ${totalProfitUsdc.toFixed(6)} USDC (${successfulExecutions}/${totalExecutions} successful)`
      );

      // Log trade event as JSON
      logger.tradeEvent({
        timestamp: new Date().toISOString(),
        direction,
        size: flashloanAmount.toString(),
        minProfitUsd: minProfitUsd.toString(),
        provider: 'suilend',
        repayAmount: flashloanAmount.toString(),
        realizedProfit: result.profit?.toString(),
        txDigest: result.txDigest,
        status: 'success',
      });

      // Notify execution result
      try {
        await telegramNotifier.notifyExecutionResult(
          direction,
          true,
          result.profit,
          result.txDigest,
          undefined,
          config.dryRun
        );
      } catch (error) {
        logger.error('Failed to send Telegram execution result notification (success)', error);
      }

      // Reset consecutive count after successful execution
      consecutiveSpreadCount = 0;
      lastSpreadDirection = null;
    } else {
      consecutiveFailures++;
      logger.error(`✗ Fee-tier arbitrage failed: ${result.error}`);

      // Log failed trade event
      logger.tradeEvent({
        timestamp: new Date().toISOString(),
        direction,
        size: flashloanAmount.toString(),
        minProfitUsd: minProfitUsd.toString(),
        provider: 'suilend',
        repayAmount: flashloanAmount.toString(),
        status: 'failed',
        error: result.error,
      });

      // Notify execution result
      try {
        await telegramNotifier.notifyExecutionResult(
          direction,
          false,
          undefined,
          undefined,
          result.error
        );
      } catch (error) {
        logger.error('Failed to send Telegram execution result notification (failure)', error);
      }

      // Kill switch: Stop if too many consecutive failures
      if (consecutiveFailures >= config.maxConsecutiveFailures) {
        logger.error(
          `KILL SWITCH ACTIVATED: ${consecutiveFailures} consecutive failures. Shutting down.`
        );
        process.exit(1);
      }
    }
  } catch (error) {
    logger.error('Error in fee-tier monitoring loop', error);
  }
}

/**
 * Main monitoring loop iteration for CETUS_TURBOS mode (DEPRECATED - kept for reference)
 */
/*
async function monitoringLoop() {
  // This function has been deprecated. The bot now uses feeTierMonitoringLoop() exclusively.
  logger.warn('monitoringLoop() is deprecated. Use feeTierMonitoringLoop() instead.');
}
*/

/**
 * Determine arbitrage direction based on prices (DEPRECATED - kept for reference)
 */
/*
function determineArbDirection(cetusPrice: number, turbosPrice: number): ArbDirection | null {
  // This function has been deprecated for cross-DEX arbitrage.
  return null;
}
*/

/**
 * Main entry point
 */
async function main() {
  logger.info('=== Sui Flashloan Arbitrage Bot Starting ===');

  try {
    // Validate configuration
    logger.info('Validating configuration...');
    validateConfig();

    if (config.dryRun) {
      logger.warn('=== DRY RUN MODE ENABLED ===');
      logger.warn('Transactions will be simulated but not executed');
    }

    // Initialize Telegram notifier
    logger.info('Initializing Telegram notifier...');
    telegramNotifier = initializeTelegramNotifier();

    // Initialize Sui client with multi-RPC failover
    logger.info('Initializing Sui RPC client with failover...');
    const client = initializeRpcClient(
      config.rpcEndpoints.primary,
      config.rpcEndpoints.backup,
      config.rpcEndpoints.fallback
    );

    // Resolve pool addresses dynamically
    logger.info('Resolving pool addresses...');
    await resolvePoolAddresses(client);

    // Initialize keypair (skip if dry run)
    if (!config.dryRun) {
      logger.info('Initializing keypair...');
      initializeKeypair(config.privateKey);

      // Check wallet balances
      logger.info('Checking wallet balances...');
      const balances = await getAllBalances(config.walletAddress);

      logger.info('Wallet balances:');
      for (const [coinType, balance] of balances.entries()) {
        const shortType = coinType.split('::').pop() || coinType;
        logger.info(`  ${shortType}: ${balance}`);
      }

      const suiBalance = balances.get(COIN_TYPES.SUI) || BigInt(0);
      if (suiBalance < BigInt(100_000_000)) {
        // Less than 0.1 SUI
        logger.warn('Low SUI balance for gas fees!');
      }
    }

    // Run startup verification
    if (config.verifyOnChain) {
      logger.info('Running startup verification...');
      await runStartupVerification();
    } else {
      logger.warn('Skipping on-chain verification (VERIFY_ON_CHAIN=false)');
    }

    // Log configuration
    logger.info('Configuration:');
    logger.info(`  Strategy: Cetus fee-tier arbitrage`);
    logger.info(`  Flashloan asset: ${config.flashloanAsset}`);
    logger.info(`  Flashloan amount: ${config.flashloanAsset === 'SUI' ? smallestUnitToSui(BigInt(config.flashloanAmount)) + ' SUI' : smallestUnitToUsdc(BigInt(config.flashloanAmount)) + ' USDC'}`);
    logger.info(`  Min profit: ${config.minProfitUsd} USDC`);
    logger.info(`  Min spread: ${config.minSpreadPercent}%`);
    logger.info(`  Max slippage: ${config.maxSlippagePercent}%`);
    logger.info(`  Check interval: ${config.checkIntervalMs}ms`);

    // Start Cetus fee-tier monitoring loop
    logger.info(`Starting monitoring loop (Cetus Fee-Tier Arbitrage)...`);
    logger.success('=== Bot is now running ===');

    // Initial check
    await feeTierMonitoringLoop();

    // Set up interval
    setInterval(async () => {
      await feeTierMonitoringLoop();
    }, config.checkIntervalMs);

    // Keep process alive
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      logger.info(
        `Final stats: ${successfulExecutions}/${totalExecutions} successful, ${totalProfitUsdc.toFixed(6)} USDC profit`
      );
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      logger.info(
        `Final stats: ${successfulExecutions}/${totalExecutions} successful, ${totalProfitUsdc.toFixed(6)} USDC profit`
      );
      process.exit(0);
    });
  } catch (error) {
    logger.error('Fatal error during startup', error);
    process.exit(1);
  }
}

// Run main
main().catch((error) => {
  logger.error('Unhandled error in main', error);
  process.exit(1);
});
