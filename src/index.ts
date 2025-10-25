import { config, validateConfig, smallestUnitToUsdc, usdcToSmallestUnit } from './config';
import { logger } from './logger';
import { initializeRpcClient, initializeKeypair, getAllBalances } from './utils/sui';
import { runStartupVerification } from './verify';
import { getCetusPrice } from './cetus';
import { getTurbosPrice } from './turbos';
import { executeFlashloanArb, ArbDirection } from './executor';
import { COIN_TYPES } from './addresses';

// State tracking
let lastExecutionTime = 0;
let pendingTransactions = 0;
let consecutiveSpreadCount = 0;
let lastSpreadDirection: ArbDirection | null = null;
let totalProfitUsdc = 0;
let totalExecutions = 0;
let successfulExecutions = 0;

/**
 * Calculate spread percentage between two prices
 */
function calculateSpread(price1: number, price2: number): number {
  return (Math.abs(price1 - price2) / Math.min(price1, price2)) * 100;
}

/**
 * Determine arbitrage direction based on prices
 */
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
 * Main monitoring loop iteration
 */
async function monitoringLoop() {
  try {
    // Fetch prices from both DEXes
    logger.debug('Fetching prices from Cetus and Turbos...');

    const [cetusPrice, turbosPrice] = await Promise.all([getCetusPrice(), getTurbosPrice()]);

    logger.info(
      `Cetus: ${cetusPrice.toFixed(6)} USDC/SUI | Turbos: ${turbosPrice.toFixed(6)} USDC/SUI`
    );

    // Calculate spread
    const spread = calculateSpread(cetusPrice, turbosPrice);
    logger.info(`Spread: ${spread.toFixed(4)}% (min: ${config.minSpreadPercent}%)`);

    // Determine arbitrage direction
    const direction = determineArbDirection(cetusPrice, turbosPrice);

    if (!direction) {
      logger.debug('No profitable arbitrage opportunity');
      consecutiveSpreadCount = 0;
      lastSpreadDirection = null;
      return;
    }

    logger.info(`Potential arbitrage direction: ${direction}`);

    // Check for consecutive spread confirmation
    if (lastSpreadDirection === direction) {
      consecutiveSpreadCount++;
      logger.info(`Consecutive spread count: ${consecutiveSpreadCount}`);
    } else {
      consecutiveSpreadCount = 1;
      lastSpreadDirection = direction;
    }

    // Require 2 consecutive ticks with same direction
    if (consecutiveSpreadCount < 2) {
      logger.info('Waiting for confirmation (need 2 consecutive ticks)');
      return;
    }

    // Check rate limits
    if (!canExecute()) {
      logger.debug('Rate limited, skipping execution');
      return;
    }

    // Execute arbitrage
    logger.info(`=== EXECUTING ARBITRAGE: ${direction} ===`);
    const flashloanAmount = BigInt(config.flashloanAmount);
    const minProfit = usdcToSmallestUnit(config.minProfitUsdc);

    pendingTransactions++;
    lastExecutionTime = Date.now();
    totalExecutions++;

    const result = await executeFlashloanArb(direction, flashloanAmount, minProfit);

    pendingTransactions--;

    if (result.success) {
      successfulExecutions++;
      const profitUsdc = result.profit ? smallestUnitToUsdc(result.profit) : 0;
      totalProfitUsdc += profitUsdc;

      logger.success(`✓ Arbitrage successful!`);
      logger.success(`  Profit: ${profitUsdc.toFixed(6)} USDC`);
      if (result.txDigest) {
        logger.success(`  TX: ${result.txDigest}`);
      }
      logger.info(
        `Total P&L: ${totalProfitUsdc.toFixed(6)} USDC (${successfulExecutions}/${totalExecutions} successful)`
      );

      // Reset consecutive count after successful execution
      consecutiveSpreadCount = 0;
      lastSpreadDirection = null;
    } else {
      logger.error(`✗ Arbitrage failed: ${result.error}`);
    }
  } catch (error) {
    logger.error('Error in monitoring loop', error);
  }
}

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

    // Initialize Sui client
    logger.info('Initializing Sui RPC client...');
    initializeRpcClient(config.rpcUrl);

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
    logger.info(`  Flashloan amount: ${smallestUnitToUsdc(BigInt(config.flashloanAmount))} USDC`);
    logger.info(`  Min profit: ${config.minProfitUsdc} USDC`);
    logger.info(`  Min spread: ${config.minSpreadPercent}%`);
    logger.info(`  Max slippage: ${config.maxSlippagePercent}%`);
    logger.info(`  Check interval: ${config.checkIntervalMs}ms`);

    // Start monitoring loop
    logger.info('Starting monitoring loop...');
    logger.success('=== Bot is now running ===');

    // Initial check
    await monitoringLoop();

    // Set up interval
    setInterval(async () => {
      await monitoringLoop();
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
